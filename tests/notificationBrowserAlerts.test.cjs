const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const root = process.env.NOTIFICATION_UI_CONTRACT_BUILD_DIR;
const preferences = require(path.join(root, 'features/notifications/services/browserNotificationPreferences.js'));
const { createBrowserNotificationAlerts } = require(path.join(root, 'features/notifications/services/browserNotificationAlerts.js'));
const { createNotificationSound } = require(path.join(root, 'features/notifications/services/notificationSound.js'));
const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const id = '33333333-3333-4333-8333-333333333333';
const start = Date.parse('2026-10-14T14:00:00.000Z');
const row = (changes = {}) => ({ id, recipientId: user, category: 'chat_message', eventCount: 1,
  occurredAt: new Date(start).toISOString(), seenAt: null, readAt: null, ...changes });
const memory = () => {
  const items = new Map();
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
};
const lockManager = () => {
  let pending = Promise.resolve();
  return { request: (_name, callback) => {
    const next = pending.then(callback); pending = next.catch(() => undefined); return next;
  } };
};
const harness = (changes = {}) => {
  let time = start;
  const dependencies = { userId: user, storage: memory(), locks: lockManager(), hasFocus: () => true, now: () => time, ...changes };
  return { dependencies, controller: createBrowserNotificationAlerts(dependencies), advance: (ms) => { time += ms; } };
};

test('preferences default off, persist independently, and stay scoped to the account', () => {
  const storage = memory();
  assert.deepEqual(preferences.readBrowserNotificationPreferences(storage, user), { desktopEnabled: false, soundEnabled: false });
  preferences.writeBrowserNotificationPreferences(storage, user, { desktopEnabled: false, soundEnabled: true });
  assert.deepEqual(preferences.readBrowserNotificationPreferences(storage, user), { desktopEnabled: false, soundEnabled: true });
  assert.deepEqual(preferences.readBrowserNotificationPreferences(storage, other), { desktopEnabled: false, soundEnabled: false });
  assert.throws(() => preferences.writeBrowserNotificationPreferences(storage, 'invalid', {}));
  storage.setItem(preferences.browserNotificationPreferenceKey(user), '{malformed');
  assert.deepEqual(preferences.readBrowserNotificationPreferences(storage, user), { desktopEnabled: false, soundEnabled: false });
  storage.setItem(preferences.browserNotificationPreferenceKey(user), JSON.stringify({ version: 2, desktopEnabled: true, soundEnabled: true }));
  assert.deepEqual(preferences.readBrowserNotificationPreferences(storage, user), { desktopEnabled: false, soundEnabled: false });
});

test('failed preference persistence is reported instead of claiming success', () => {
  const storage = { setItem: () => { throw new Error('storage denied'); } };
  assert.throws(() => preferences.writeBrowserNotificationPreferences(storage, user, { desktopEnabled: true, soundEnabled: true }), /storage denied/);
});

test('replayed, seeded, historical, seen/read and foreign-account events never alert', async () => {
  const h = harness(); let played = 0;
  const receive = (value) => h.controller.receive(value, 'sound', () => true, () => { played++; return true; });
  h.controller.seed([row()]);
  assert.equal(await receive(row()), false);
  for (const changes of [{ recipientId: other }, { readAt: new Date(start).toISOString() }, { seenAt: new Date(start).toISOString() },
    { occurredAt: new Date(start - 61_000).toISOString() }, { occurredAt: new Date(start + 61_000).toISOString() }, { id: 'invalid' }]) {
    assert.equal(await receive(row(changes)), false);
  }
  h.advance(2000);
  const next = row({ eventCount: 2, occurredAt: new Date(start + 2000).toISOString() });
  assert.equal(await receive(next), true);
  assert.equal(await receive(next), false);
  assert.equal(await receive({ ...next, updatedAt: new Date(start + 2500).toISOString() }), false);
  assert.equal(played, 1);
});

test('aggregated new messages alert again while bursts are throttled', async () => {
  const h = harness(); let played = 0;
  const receive = (value) => h.controller.receive(value, 'sound', () => true, () => { played++; return true; });
  assert.equal(await receive(row()), true);
  h.advance(100);
  assert.equal(await receive(row({ eventCount: 2, occurredAt: new Date(start + 100).toISOString() })), false);
  h.advance(2000);
  assert.equal(await receive(row({ eventCount: 3, occurredAt: new Date(start + 2100).toISOString() })), true);
  assert.equal(played, 2);
});

test('two concurrent tabs share a claim; desktop and sound have independent preferences', async () => {
  const h = harness(); const second = createBrowserNotificationAlerts(h.dependencies); let played = 0;
  const show = () => { played++; return true; };
  const results = await Promise.all([h.controller.receive(row(), 'sound', () => true, show), second.receive(row(), 'sound', () => true, show)]);
  assert.deepEqual(results.sort(), [false, true]);
  assert.equal(played, 1);
  assert.equal(await second.receive(row(), 'desktop', () => true, show), true);
  assert.equal(played, 2);
});

test('account/permission/toggle changes are rechecked inside the lock before showing', async () => {
  let callback; let eligible = true;
  const h = harness({ locks: { request: (_name, fn) => new Promise((resolve) => { callback = () => resolve(fn()); }) } });
  let displayed = false;
  const pending = h.controller.receive(row(), 'desktop', () => eligible, () => { displayed = true; return true; });
  eligible = false; callback();
  assert.equal(await pending, false);
  assert.equal(displayed, false);
});

test('without Web Locks only a focused tab can alert and storage errors fail closed', async () => {
  const hidden = harness({ locks: undefined, hasFocus: () => false });
  assert.equal(await hidden.controller.receive(row(), 'sound', () => true, () => true), false);
  const broken = harness({ storage: { getItem: () => null, setItem: () => { throw new Error('storage denied'); } } });
  let displayed = false;
  await assert.rejects(broken.controller.receive(row(), 'desktop', () => true, () => { displayed = true; return true; }), /storage denied/);
  assert.equal(displayed, false);
});

test('disabled alerts never request a lock or replay after being enabled', async () => {
  let locks = 0;
  const h = harness({ locks: { request: (_name, fn) => { locks++; return Promise.resolve(fn()); } } });
  assert.equal(await h.controller.receive(row(), 'sound', () => false, () => true), false);
  assert.equal(await h.controller.receive(row(), 'sound', () => true, () => true), false);
  assert.equal(locks, 0);
});

test('an event that becomes stale while queued for the tab lock never alerts', async () => {
  let callback;
  const h = harness({ locks: { request: (_name, fn) => new Promise((resolve) => { callback = () => resolve(fn()); }) } });
  const pending = h.controller.receive(row(), 'sound', () => true, () => true);
  h.advance(61_000); callback();
  assert.equal(await pending, false);
});

test('audio requires unlock, schedules a bounded chime, and stops after disposal', async () => {
  const original = global.AudioContext; const frequencies = []; const stops = [];
  class FakeAudio {
    state = 'suspended'; currentTime = 10; destination = {};
    resume = async () => { this.state = 'running'; };
    close = async () => { this.state = 'closed'; };
    createOscillator = () => ({ frequency: { set value(value) { frequencies.push(value); } }, connect() {}, disconnect() {}, start() {}, stop(time) { stops.push(time); } });
    createGain = () => ({ gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, disconnect() {} });
  }
  global.AudioContext = FakeAudio;
  try {
    const sound = createNotificationSound();
    assert.equal(sound.play(), false);
    assert.equal(await sound.unlock(), true);
    assert.equal(sound.play(), true);
    assert.deepEqual(frequencies, [660, 880]);
    assert.ok(stops.every((time) => time >= 10 && time <= 10.4));
    sound.dispose();
    assert.equal(sound.play(), false);
    assert.equal(await sound.unlock(), false);
  } finally { global.AudioContext = original; }
});
