const test = require('node:test');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { readFileSync } = require('node:fs');
const base = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
const client = require(join(base, 'lib/supabaseClient.js'));
const service = require(join(base, 'features/dashboard/services/automaticTaskDismissalService.js'));
const contract = require(join(base, 'features/dashboard/utils/automaticTaskContract.js'));
const owner = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const task = { key: `measurement_due:${other}`, kind: 'measurement_due', group: 'overdue',
  clientId: other, clientName: 'Danışan', sinceDate: '2026-08-01', requestId: null, overdueDays: 36, detail: 'Ölçüm bekleniyor' };

test('same occurrence remains deleted across elapsed days; a new measurement creates a visible task', () => {
  const hidden = [{ taskKey: task.key, taskRevision: contract.automaticTaskRevision(task) }];
  assert.deepEqual(contract.filterDismissedAutomaticTasks([{ ...task, overdueDays: 42, detail: 'Yeni metin' }], hidden), []);
  const next = { ...task, sinceDate: '2026-09-01' };
  assert.deepEqual(contract.filterDismissedAutomaticTasks([next], hidden), [next]);
  assert.deepEqual(contract.filterDismissedAutomaticTasks([], hidden), []);
});

test('new meal request for the same client is not hidden by a deleted request', () => {
  const first = { ...task, kind: 'meal_change_request', key: `meal_change_request:${owner}`, requestId: owner };
  const next = { ...first, key: `meal_change_request:${other}`, requestId: other };
  assert.deepEqual(contract.filterDismissedAutomaticTasks([first, next], [{ taskKey: first.key, taskRevision: contract.automaticTaskRevision(first) }]), [next]);
});

test('confirmed persistence is read again by another page load with owner isolation', async () => {
  client.__setUserId(owner);
  let saved;
  client.__setFromHandler((table) => {
    assert.equal(table, 'automatic_task_dismissals');
    const query = {
      upsert(payload, options) { saved = payload; assert.equal(options.onConflict, 'dietitian_id,task_key'); return this; },
      select() { return this; },
      eq(column, value) { assert.equal(column, 'dietitian_id'); assert.equal(value, owner); return this; },
      order() { return this; },
      range() { return Promise.resolve({ data: [saved], error: null }); },
      maybeSingle() { return Promise.resolve({ data: saved, error: null }); },
    };
    return query;
  });
  await service.dismissAutomaticTask(task, owner);
  assert.equal(saved.client_id, task.clientId);
  assert.deepEqual(contract.filterDismissedAutomaticTasks([task], await service.fetchAutomaticTaskDismissals(owner)), []);
});

test('database refusal, missing returned row and wrong owner never report successful deletion', async () => {
  client.__setUserId(owner);
  for (const response of [{ data: null, error: { code: '42501' } }, { data: null, error: null },
    { data: { dietitian_id: other, task_key: task.key, task_revision: contract.automaticTaskRevision(task) }, error: null }]) {
    client.__setFromHandler(() => ({ upsert() { return this; }, select() { return this; }, maybeSingle: async () => response }));
    await assert.rejects(service.dismissAutomaticTask(task, owner));
  }
});

test('logout and changed account prevent querying or writing former account preferences', async () => {
  client.__setFromHandler(() => { throw new Error('Query must not run'); });
  for (const id of [null, other]) {
    client.__setUserId(id);
    await assert.rejects(service.fetchAutomaticTaskDismissals(owner));
    await assert.rejects(service.dismissAutomaticTask(task, owner));
  }
});

test('read failures and foreign rows fail closed rather than inventing empty preferences', async () => {
  client.__setUserId(owner);
  for (const response of [{ data: null, error: { code: '42P01' } },
    { data: [{ dietitian_id: other, task_key: task.key, task_revision: 'x' }], error: null }]) {
    client.__setFromHandler(() => ({ select() { return this; }, eq() { return this; }, order() { return this; }, range: async () => response }));
    await assert.rejects(service.fetchAutomaticTaskDismissals(owner));
  }
});

test('preference loading paginates beyond the Supabase default row limit', async () => {
  client.__setUserId(owner);
  const offsets = [];
  client.__setFromHandler(() => ({ select() { return this; }, eq() { return this; }, order() { return this; },
    range: async (start, end) => {
      offsets.push([start, end]);
      return { data: Array.from({ length: start === 0 ? 500 : 1 }, (_, i) => ({ dietitian_id: owner, task_key: `task-${start + i}`, task_revision: 'x' })), error: null };
    } }));
  assert.equal((await service.fetchAutomaticTaskDismissals(owner)).length, 501);
  assert.deepEqual(offsets, [[0, 499], [500, 999]]);
});

test('dismissal migration is additive and wired into isolated CI databases', () => {
  const root = join(__dirname, '..');
  const name = '20261006202442_automatic_task_dismissals.sql';
  const sql = readFileSync(join(root, 'supabase/migrations', name), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /is_current_user_dietitian/);
  assert.match(sql, /dc\.status = 'active'/);
  assert.match(sql, /primary key \(dietitian_id, task_key\)/);
  assert.doesNotMatch(sql, /alter table public\.(?:daily_tasks|meal_plans|client_measurements)/);
  for (const path of ['scripts/addCurrentIsolatedMigrations.mjs', 'scripts/runDisposableSupabaseLocalReplay.mjs']) {
    assert.ok(readFileSync(join(root, path), 'utf8').includes(name));
  }
});
