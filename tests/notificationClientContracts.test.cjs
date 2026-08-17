const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.NOTIFICATION_CLIENT_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('NOTIFICATION_CLIENT_CONTRACT_BUILD_DIR is required.');

const supabaseClient = require(path.join(buildDir, 'lib', 'supabaseClient.js'));
const service = require(path.join(buildDir, 'features', 'notifications', 'services', 'notificationService.js'));
const state = require(path.join(buildDir, 'features', 'notifications', 'state', 'notificationState.js'));
const repoRoot = path.join(__dirname, '..');

const ids = {
  recipient: '11111111-1111-4111-8111-111111111111',
  actor: '22222222-2222-4222-8222-222222222222',
  notificationA: '33333333-3333-4333-8333-333333333333',
  notificationB: '44444444-4444-4444-8444-444444444444',
  notificationC: '55555555-5555-4555-8555-555555555555',
  conversation: '66666666-6666-4666-8666-666666666666',
  appointment: '77777777-7777-4777-8777-777777777777',
  relation: '88888888-8888-4888-8888-888888888888',
};

const timestamps = {
  older: '2026-08-15T10:00:00.000Z',
  newer: '2026-08-15T11:00:00.000Z',
};

const chatRow = (overrides = {}) => ({
  id: ids.notificationA,
  recipient_id: ids.recipient,
  category: 'chat_message',
  event_type: 'new_message',
  aggregation_key: `chat:${ids.conversation}`,
  actor_id: ids.actor,
  actor_display_name: 'Diyetisyen A',
  conversation_id: ids.conversation,
  appointment_id: null,
  dietitian_client_id: null,
  summary_key: 'chat_new_message',
  appointment_title_snapshot: null,
  appointment_date: null,
  appointment_time: null,
  appointment_status: null,
  relationship_from_status: null,
  relationship_to_status: null,
  event_count: 1,
  occurred_at: timestamps.newer,
  seen_at: null,
  read_at: null,
  created_at: timestamps.older,
  updated_at: timestamps.newer,
  ...overrides,
});

const appointmentRow = (overrides = {}) => chatRow({
  id: ids.notificationB,
  category: 'appointment',
  event_type: 'created',
  aggregation_key: `appointment:${ids.appointment}`,
  conversation_id: null,
  appointment_id: ids.appointment,
  summary_key: 'appointment_created',
  appointment_title_snapshot: 'İlk görüşme',
  appointment_date: '2026-08-16',
  appointment_time: '12:30:00',
  appointment_status: 'upcoming',
  occurred_at: timestamps.older,
  ...overrides,
});

const reminderRow = (eventType, overrides = {}) => appointmentRow({
  event_type: eventType,
  aggregation_key: `appointment_reminder:${ids.appointment}:2026-08-16:12:30:${eventType === 'reminder_24h' ? '24h' : '1h'}`,
  summary_key: eventType === 'reminder_24h' ? 'appointment_reminder_24h' : 'appointment_reminder_1h',
  ...overrides,
});

const relationshipRow = (overrides = {}) => chatRow({
  id: ids.notificationC,
  category: 'relationship',
  event_type: 'accepted',
  aggregation_key: `relationship:${ids.relation}`,
  conversation_id: null,
  dietitian_client_id: ids.relation,
  summary_key: 'relationship_accepted',
  relationship_from_status: 'pending',
  relationship_to_status: 'active',
  ...overrides,
});

const makeBuilder = (result, calls) => {
  const builder = {
    select: (columns, options) => { calls.push({ method: 'select', columns, options }); return builder; },
    eq: (column, value) => { calls.push({ method: 'eq', column, value }); return builder; },
    is: (column, value) => { calls.push({ method: 'is', column, value }); return builder; },
    or: (value) => { calls.push({ method: 'or', value }); return builder; },
    order: (column, options) => { calls.push({ method: 'order', column, options }); return builder; },
    limit: (value) => { calls.push({ method: 'limit', value }); return builder; },
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test.beforeEach(() => {
  supabaseClient.__reset();
  supabaseClient.__setAuth({ id: ids.recipient });
});

test('maps valid chat, appointment, and relationship rows into the typed client model', () => {
  const chat = service.normalizeNotificationRow(chatRow());
  const appointment = service.normalizeNotificationRow(appointmentRow());
  const relationship = service.normalizeNotificationRow(relationshipRow());

  assert.equal(chat.category, 'chat_message');
  assert.equal(chat.conversationId, ids.conversation);
  assert.equal(appointment.appointmentId, ids.appointment);
  assert.equal(appointment.appointmentTime, '12:30');
  assert.equal(relationship.dietitianClientId, ids.relation);
  assert.equal(relationship.relationshipToStatus, 'active');
});

test('accepts bounded appointment reminder events and their exact summary keys', () => {
  const reminder24h = service.normalizeNotificationRow(reminderRow('reminder_24h'));
  const reminder1h = service.normalizeNotificationRow(reminderRow('reminder_1h'));

  assert.equal(reminder24h.eventType, 'reminder_24h');
  assert.equal(reminder24h.summaryKey, 'appointment_reminder_24h');
  assert.equal(reminder1h.eventType, 'reminder_1h');
  assert.equal(reminder1h.summaryKey, 'appointment_reminder_1h');
});

test('rejects unknown or malformed notification contracts instead of silently reinterpreting them', () => {
  assert.throws(
    () => service.normalizeNotificationRow(chatRow({ category: 'future_category' })),
    (error) => error.code === 'MALFORMED',
  );
  assert.throws(
    () => service.normalizeNotificationRow(chatRow({ event_type: 'future_event' })),
    (error) => error.code === 'MALFORMED',
  );
  assert.throws(
    () => service.normalizeNotificationRow(appointmentRow({ appointment_date: '16/08/2026' })),
    (error) => error.code === 'MALFORMED',
  );
  assert.throws(
    () => service.normalizeNotificationRow(reminderRow('reminder_24h', { summary_key: 'appointment_created' })),
    (error) => error.code === 'MALFORMED',
  );
  assert.throws(
    () => service.normalizeNotificationRow(reminderRow('reminder_90m', { summary_key: 'appointment_reminder_90m' })),
    (error) => error.code === 'MALFORMED',
  );
});

test('fails closed without an authenticated user and does not query arbitrary recipient ids', async () => {
  let fromCalled = false;
  supabaseClient.__setAuth({ id: null });
  supabaseClient.__setFromHandler(() => { fromCalled = true; throw new Error('from must not run'); });

  await assert.rejects(
    () => service.listNotifications({ pageSize: 20 }),
    (error) => error.code === 'UNAUTHENTICATED',
  );
  assert.equal(fromCalled, false);
});

test('lists newest notifications with bounded keyset pagination and unread filtering', async () => {
  const calls = [];
  supabaseClient.__setFromHandler((table) => {
    assert.equal(table, 'notifications');
    return makeBuilder({ data: [chatRow(), appointmentRow(), relationshipRow()], error: null }, calls);
  });

  const firstPage = await service.listNotifications({ pageSize: 2 });
  assert.equal(firstPage.notifications.length, 2);
  assert.equal(firstPage.hasMore, true);
  assert.deepEqual(firstPage.nextCursor, {
    occurredAt: new Date(timestamps.older).toISOString(),
    id: ids.notificationB,
  });
  assert.deepEqual(calls.filter((call) => call.method === 'eq')[0], {
    method: 'eq', column: 'recipient_id', value: ids.recipient,
  });
  assert.deepEqual(calls.filter((call) => call.method === 'order').map((call) => [call.column, call.options.ascending]), [
    ['occurred_at', false],
    ['id', false],
  ]);
  assert.equal(calls.find((call) => call.method === 'limit').value, 3);

  calls.length = 0;
  supabaseClient.__setFromHandler(() => makeBuilder({ data: [appointmentRow({ id: ids.notificationB })], error: null }, calls));
  await service.listNotifications({
    cursor: firstPage.nextCursor,
    pageSize: 20,
    unreadOnly: true,
  });
  assert.equal(calls.some((call) => call.method === 'is' && call.column === 'read_at' && call.value === null), true);
  assert.match(calls.find((call) => call.method === 'or').value, /occurred_at\.lt\./);
  assert.match(calls.find((call) => call.method === 'or').value, /id\.lt\./);
});

test('unseen count uses exact head count and seen_at null, separate from chat unread state', async () => {
  const calls = [];
  supabaseClient.__setFromHandler(() => makeBuilder({ data: null, count: 4, error: null }, calls));
  assert.equal(await service.getNotificationUnseenCount(), 4);
  assert.deepEqual(calls.find((call) => call.method === 'select'), {
    method: 'select', columns: 'id', options: { count: 'exact', head: true },
  });
  assert.equal(calls.some((call) => call.method === 'is' && call.column === 'seen_at' && call.value === null), true);
  assert.equal(calls.some((call) => call.method === 'is' && call.column === 'read_at'), false);
});

test('query failures remain explicit and are not converted into a valid empty result', async () => {
  supabaseClient.__setFromHandler(() => makeBuilder({ data: null, error: { code: 'PGRST205', message: 'relation notifications does not exist' } }, []));
  await assert.rejects(
    () => service.listNotifications(),
    (error) => error.code === 'FETCH',
  );
});

test('seen/read mutations use only canonical RPCs and batch input stays bounded', async () => {
  const calls = [];
  let fromCalled = false;
  supabaseClient.__setFromHandler(() => { fromCalled = true; throw new Error('direct table access is not allowed in mutation tests'); });
  supabaseClient.__setRpcHandler(async (name, args) => {
    calls.push({ name, args });
    if (name === 'mark_notifications_seen') return { data: 2, error: null };
    if (name === 'mark_notification_read') return { data: appointmentRow({ seen_at: timestamps.newer, read_at: timestamps.newer }), error: null };
    return { data: chatRow({ seen_at: timestamps.newer }), error: null };
  });

  const seen = await service.markNotificationSeen(ids.notificationA);
  const read = await service.markNotificationRead(ids.notificationB);
  const batch = await service.markNotificationsSeen([ids.notificationA, ids.notificationB]);
  assert.equal(seen.seenAt, new Date(timestamps.newer).toISOString());
  assert.equal(read.seenAt !== null && read.readAt !== null, true);
  assert.equal(batch, 2);
  assert.deepEqual(calls.map((call) => call.name), [
    'mark_notification_seen',
    'mark_notification_read',
    'mark_notifications_seen',
  ]);
  assert.equal(fromCalled, false);

  const before = calls.length;
  await assert.rejects(
    () => service.markNotificationsSeen(Array.from({ length: 101 }, (_, index) => `${String(index + 1).padStart(8, '0')}-1111-4111-8111-111111111111`)),
    (error) => error.code === 'VALIDATION',
  );
  assert.equal(calls.length, before);
});

test('mark all read uses one dedicated RPC without recipient input or an ID loop', async () => {
  const calls = [];
  let fromCalled = false;
  supabaseClient.__setFromHandler(() => { fromCalled = true; throw new Error('direct table access is not allowed in mark-all tests'); });
  supabaseClient.__setRpcHandler(async (name, args) => {
    calls.push({ name, args });
    return { data: 2, error: null };
  });

  assert.equal(await service.markAllNotificationsRead(), 2);
  assert.deepEqual(calls, [{ name: 'mark_all_notifications_read', args: undefined }]);
  assert.equal(fromCalled, false);

  const serviceSource = fs.readFileSync(path.join(repoRoot, 'features', 'notifications', 'services', 'notificationService.ts'), 'utf8');
  const markAllStart = serviceSource.indexOf('export const markAllNotificationsRead');
  const markAllBlock = serviceSource.slice(markAllStart, serviceSource.indexOf('\n};', markAllStart) + 3);
  assert.doesNotMatch(markAllBlock, /markNotification(Read|Seen)|markNotificationsSeen|notificationIds|\.from\(/);

  supabaseClient.__setRpcHandler(async () => ({ data: null, error: { code: 'PGRST500', message: 'mark-all failed' } }));
  await assert.rejects(
    () => service.markAllNotificationsRead(),
    (error) => error.code === 'RPC' && error.userMessage === 'Tüm bildirimler okundu olarak işaretlenemedi.',
  );
});

test('Realtime uses the authenticated user channel, INSERT/UPDATE only, and idempotent cleanup', async () => {
  let channelRecord;
  supabaseClient.__setChannelHandler((name) => {
    const record = { name, registrations: [], statusCallback: null };
    const channel = {
      on: (event, config, callback) => {
        record.registrations.push({ event, config, callback });
        return channel;
      },
      subscribe: (callback) => { record.statusCallback = callback; return channel; },
    };
    record.channel = channel;
    channelRecord = record;
    return channel;
  });
  const changes = [];
  const statuses = [];
  const subscription = service.subscribeToNotifications({
    onChange: (change) => changes.push(change),
    onStatus: (status) => statuses.push(status),
  });
  await flush();

  assert.equal(channelRecord.name, `notifications:${ids.recipient}`);
  assert.deepEqual(channelRecord.registrations.map((registration) => registration.event), ['postgres_changes', 'postgres_changes']);
  assert.deepEqual(channelRecord.registrations.map((registration) => registration.config.event), ['INSERT', 'UPDATE']);
  assert.equal(channelRecord.registrations.every((registration) => registration.config.table === 'notifications'), true);
  assert.equal(channelRecord.registrations.every((registration) => registration.config.filter === `recipient_id=eq.${ids.recipient}`), true);
  channelRecord.statusCallback('SUBSCRIBED');
  channelRecord.registrations[0].callback({ new: { id: ids.notificationA } });
  channelRecord.registrations[1].callback({ new: { id: ids.notificationA } });
  assert.deepEqual(statuses, ['connected']);
  assert.deepEqual(changes, [
    { event: 'INSERT', notificationId: ids.notificationA },
    { event: 'UPDATE', notificationId: ids.notificationA },
  ]);

  await subscription.unsubscribe();
  await subscription.unsubscribe();
  assert.equal(supabaseClient.__getRemovedChannels().length, 1);
});

test('state merge replaces by id, preserves equal-timestamp ordering, and re-arm resets read state', () => {
  const current = [service.normalizeNotificationRow(chatRow({ id: ids.notificationA, occurred_at: timestamps.older, seen_at: timestamps.newer, read_at: timestamps.newer }))];
  const replacement = service.normalizeNotificationRow(chatRow({ id: ids.notificationA, occurred_at: timestamps.newer, seen_at: null, read_at: null, event_count: 2 }));
  const second = service.normalizeNotificationRow(appointmentRow({ id: ids.notificationB, occurred_at: timestamps.newer }));
  const merged = state.mergeNotificationPage(current, {
    notifications: [replacement, second],
    nextCursor: { occurredAt: timestamps.older, id: ids.notificationA },
    hasMore: true,
  });

  assert.equal(merged.notifications.length, 2);
  assert.deepEqual(merged.notifications.map((notification) => notification.id), [ids.notificationB, ids.notificationA]);
  assert.equal(merged.notifications.find((notification) => notification.id === ids.notificationA).readAt, null);
  assert.equal(state.replaceNotificationById(current, second).length, 1);
  assert.equal(state.removeNotificationById(merged.notifications, ids.notificationA).length, 1);
});

test('session generation guard invalidates stale async results on user change', () => {
  const guard = state.createNotificationSessionGuard();
  const first = guard.begin(ids.recipient);
  const second = guard.begin(ids.actor);
  assert.equal(guard.isCurrent(first), false);
  assert.equal(guard.isCurrent(second), true);
  guard.invalidate();
  assert.equal(guard.isCurrent(second), false);
});

test('hook is data/state/realtime only and keeps Supabase access behind the service boundary', () => {
  const hook = fs.readFileSync(path.join(repoRoot, 'features', 'notifications', 'hooks', 'useNotifications.ts'), 'utf8');
  assert.match(hook, /subscribeToNotifications/);
  assert.match(hook, /visibilitychange/);
  assert.match(hook, /addEventListener\('focus'/);
  assert.match(hook, /subscription\.unsubscribe\(\)/);
  assert.match(hook, /isCurrentToken/);
  assert.match(hook, /mergeNotificationPage/);
  assert.match(hook, /markAllRead/);
  assert.match(hook, /markAllNotificationsRead/);
  const markAllStart = hook.indexOf('const markAllRead = useCallback');
  const markAllBlock = hook.slice(markAllStart, hook.indexOf('\n  }, [', markAllStart));
  assert.match(markAllBlock, /await markAllNotificationsRead\(\)/);
  assert.match(markAllBlock, /return await refresh\(\)/);
  assert.doesNotMatch(markAllBlock, /setUnseenCount\(0\)/);
  assert.doesNotMatch(hook, /\.from\(['"]notifications['"]\)/);
  assert.doesNotMatch(hook, /notification.*(Bell|Drawer|Card)/i);
});
