'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const contract = require(path.join(
  buildDir,
  'features',
  'dashboard',
  'utils',
  'dailyTaskContract.js',
));

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const VALID_CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const VALID_DRAFT = {
  clientId: VALID_CLIENT_ID,
  title: ' Haftalık planı güncelle ',
  description: ' Danışanın yeni ölçümüne göre düzenle. ',
  dueDate: '2026-08-11',
  dueTime: '09:30:00',
  priority: 'high',
};

const createTask = (overrides = {}) => ({
  id: '22222222-2222-4222-8222-222222222222',
  dietitianId: '33333333-3333-4333-8333-333333333333',
  clientId: null,
  clientName: null,
  clientAvatar: null,
  title: 'Görev',
  description: null,
  dueDate: '2026-08-11',
  dueTime: null,
  priority: 'medium',
  status: 'pending',
  completedAt: null,
  createdAt: '2026-08-10T08:00:00.000Z',
  updatedAt: '2026-08-10T08:00:00.000Z',
  ...overrides,
});

test('daily task validation normalizes canonical draft fields', () => {
  const result = contract.validateDailyTaskDraft(VALID_DRAFT);
  assert.equal(result.success, true);
  assert.deepEqual(result.value, {
    clientId: VALID_CLIENT_ID,
    title: 'Haftalık planı güncelle',
    description: 'Danışanın yeni ölçümüne göre düzenle.',
    dueDate: '2026-08-11',
    dueTime: '09:30',
    priority: 'high',
  });

  const generalTask = contract.validateDailyTaskDraft({
    ...VALID_DRAFT,
    clientId: null,
    description: '   ',
    dueTime: null,
  });
  assert.equal(generalTask.success, true);
  assert.equal(generalTask.value.description, null);
  assert.equal(generalTask.value.dueTime, null);
});

test('daily task validation rejects malformed identity, text, civil date, time and priority', () => {
  const invalidDrafts = [
    { ...VALID_DRAFT, clientId: '1' },
    { ...VALID_DRAFT, title: '   ' },
    { ...VALID_DRAFT, title: 'x'.repeat(161) },
    { ...VALID_DRAFT, description: 'x'.repeat(2001) },
    { ...VALID_DRAFT, dueDate: '2026-02-30' },
    { ...VALID_DRAFT, dueTime: '24:00' },
    { ...VALID_DRAFT, priority: 'urgent' },
  ];

  for (const draft of invalidDrafts) {
    assert.equal(contract.validateDailyTaskDraft(draft).success, false);
  }
});

test('business date keys use Europe/Istanbul civil boundaries explicitly', () => {
  assert.equal(
    contract.getIstanbulDateKey(new Date('2026-08-10T21:00:00.000Z')),
    '2026-08-11',
  );
  assert.equal(
    contract.getIstanbulDateKey(new Date('2026-08-11T20:59:59.000Z')),
    '2026-08-11',
  );
  assert.equal(
    contract.getIstanbulDateKey(new Date('2026-08-11T21:00:00.000Z')),
    '2026-08-12',
  );
  assert.equal(contract.getIstanbulTimeKey(new Date('2026-08-11T06:05:00.000Z')), '09:05');
});

test('pending task classification uses both Istanbul date and current civil time', () => {
  const reference = new Date('2026-08-11T07:00:00.000Z');
  assert.equal(contract.getPendingDailyTaskGroup('2026-08-10', null, reference), 'overdue');
  assert.equal(contract.getPendingDailyTaskGroup('2026-08-11', '09:59', reference), 'overdue');
  assert.equal(contract.getPendingDailyTaskGroup('2026-08-11', '10:01', reference), 'today');
  assert.equal(contract.getPendingDailyTaskGroup('2026-08-11', null, reference), 'today');
  assert.equal(contract.getPendingDailyTaskGroup('2026-08-12', null, reference), 'upcoming');
});

test('daily tasks group into overdue, today and completed with deterministic ordering', () => {
  const tasks = [
    createTask({
      id: '00000000-0000-4000-8000-000000000004',
      dueDate: '2026-08-12',
      title: 'Gelecek görev',
    }),
    createTask({
      id: '00000000-0000-4000-8000-000000000003',
      dueDate: '2026-08-10',
      dueTime: '11:00',
      priority: 'low',
    }),
    createTask({
      id: '00000000-0000-4000-8000-000000000002',
      dueTime: null,
      priority: 'high',
    }),
    createTask({
      id: '00000000-0000-4000-8000-000000000001',
      dueTime: '09:00',
      priority: 'low',
    }),
    createTask({
      id: '00000000-0000-4000-8000-000000000006',
      status: 'completed',
      completedAt: '2026-08-11T09:00:00.000Z',
    }),
    createTask({
      id: '00000000-0000-4000-8000-000000000005',
      status: 'completed',
      completedAt: '2026-08-11T10:00:00.000Z',
    }),
  ];

  const groups = contract.groupDailyTasks(tasks, new Date('2026-08-11T07:00:00.000Z'));
  assert.deepEqual(groups.overdue.map((task) => task.id), [
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000001',
  ]);
  assert.deepEqual(groups.today.map((task) => task.id), [
    '00000000-0000-4000-8000-000000000002',
  ]);
  assert.deepEqual(groups.upcoming.map((task) => task.id), [
    '00000000-0000-4000-8000-000000000004',
  ]);
  assert.deepEqual(groups.completed.map((task) => task.id), [
    '00000000-0000-4000-8000-000000000005',
    '00000000-0000-4000-8000-000000000006',
  ]);
});

test('daily task service is fail-closed, owner-scoped and verifies canonical mutation rows', () => {
  const source = read('features/dashboard/services/dailyTaskService.ts');
  assert.doesNotMatch(source, /\bTASKS\b|Date\.now|localStorage|sessionStorage|mock/iu);
  assert.match(source, /supabase\.auth\.getUser\(\)/);
  assert.match(source, /\.from\('daily_tasks'\)/);
  assert.ok((source.match(/\.eq\('dietitian_id', dietitianId\)/g) || []).length >= 5);
  assert.match(source, /\.from\('dietitian_clients'\)[\s\S]*?\.eq\('status', 'active'\)[\s\S]*?\.maybeSingle\(\)/);
  assert.match(source, /\.insert\([\s\S]*?status: 'pending'[\s\S]*?completed_at: null/);
  assert.match(source, /\.update\(\{ status: expectedStatus \}\)[\s\S]*?\.select\(DAILY_TASK_SELECT\)[\s\S]*?\.maybeSingle\(\)/);
  assert.match(source, /\.delete\(\)[\s\S]*?\.select\('id, dietitian_id'\)[\s\S]*?\.maybeSingle\(\)/);
  assert.match(source, /deleted\?\.id !== id \|\| deleted\.dietitian_id !== dietitianId/);
  assert.match(source, /assertDraftPersisted\(task, validation\.value, DAILY_TASK_SAVE_ERROR\)/);
});

test('daily task hook protects stale reads, locks mutations synchronously and refreshes canonical state', () => {
  const source = read('features/dashboard/hooks/useDailyTasks.ts');
  assert.doesNotMatch(source, /\bTASKS\b|Date\.now|localStorage|sessionStorage|setTasks|\.\.\.prev/u);
  assert.match(source, /const requestId = \+\+requestVersion\.current/);
  assert.match(source, /requestId !== requestVersion\.current/);
  assert.match(source, /if \(!isAllowed \|\| pendingActionRef\.current !== null\) return \{ success: false \}/);
  assert.match(source, /pendingActionRef\.current = actionKey;[\s\S]*?await mutation\(\)/);
  assert.match(source, /await mutation\(\);\s*const refreshSucceeded = await refreshDailyTasks\(\);/);
  assert.match(source, /createDailyTask\(draft\)/);
  assert.match(source, /updateDailyTaskService\(id, draft\)/);
  assert.match(source, /setDailyTaskCompletion\(id, true\)/);
  assert.match(source, /setDailyTaskCompletion\(id, false\)/);
  assert.match(source, /deleteDailyTaskService\(id\)/);
  assert.match(source, /setInterval\(\(\) => setGroupingClock\(new Date\(\)\), 30_000\)/);
  assert.match(source, /groupDailyTasks\(tasks, groupingClock\)/);
});

test('daily task migration creates the complete fail-closed schema and RLS contract', () => {
  const source = read('supabase/migrations/20260811103909_create_persistent_dashboard_daily_tasks.sql');
  assert.match(source, /create table public\.daily_tasks/i);
  for (const field of [
    'dietitian_id', 'client_id', 'title', 'description', 'due_date', 'due_time',
    'priority', 'status', 'completed_at', 'created_at', 'updated_at',
  ]) assert.match(source, new RegExp(`\\b${field}\\b`, 'i'));
  assert.match(source, /priority in \('low', 'medium', 'high'\)/i);
  assert.match(source, /status in \('pending', 'completed'\)/i);
  assert.match(source, /status = 'pending' and completed_at is null/i);
  assert.match(source, /status = 'completed' and completed_at is not null/i);
  assert.match(source, /create function public\.enforce_daily_task_contract\(\)/i);
  assert.match(source, /new\.id is distinct from old\.id[\s\S]*new\.dietitian_id is distinct from old\.dietitian_id/i);
  assert.match(source, /dc\.status = 'active'::public\.client_status/i);
  assert.match(source, /alter table public\.daily_tasks enable row level security/i);
  assert.equal((source.match(/create policy /gi) || []).length, 4);
  assert.match(source, /dietitian_id = \(select auth\.uid\(\)\)[\s\S]*is_current_user_dietitian\(\)/i);
  assert.match(source, /revoke all privileges on table public\.daily_tasks from public, anon, authenticated/i);
  assert.doesNotMatch(source, /insert into public\.daily_tasks/i);
});

test('Dashboard uses persistent tasks with real client IDs and distinct operational states', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  assert.doesNotMatch(source, /\bTASKS\b|custom-\$\{Date\.now|newTaskForm|timeInfo/u);
  assert.match(source, /useDailyTasks\(\)/);
  assert.match(source, /await updateTask\(editingTask\.id, taskDraft\)/);
  assert.match(source, /await createTask\(taskDraft\)/);
  assert.match(source, /await deleteTask\(task\.id\)/);
  assert.match(source, /reopenTask\(task\.id\)/);
  assert.match(source, /completeTask\(task\.id\)/);
  assert.match(source, /taskViewState\.status === 'loading'[\s\S]*taskViewState\.status === 'error'[\s\S]*visibleTasks\.length === 0/);
  assert.match(source, /value=\{taskDraft\.clientId \|\| ''\}/);
  assert.match(source, /disabled=\{pendingTaskAction !== null\}/);
  assert.match(source, /getPendingDailyTaskGroup\(taskDraft\.dueDate, taskDraft\.dueTime\)/);
  assert.match(source, /editingTask\?\.status === 'completed'[\s\S]*?\? 'completed'/);
  assert.match(source, /taskDialogOpenerRef\.current = taskMenuButtonRef\.current/);
  assert.match(source, /taskTitleInputRef\.current\?\.focus\(\)/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key !== 'Tab'/);
  assert.match(source, /taskDialogOpenerRef\.current\?\.focus\(\)/);
});

test('Dashboard task details use persisted task content and keep task actions outside detail trigger', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  assert.match(source, /const \[selectedTaskId, setSelectedTaskId\] = useState<string \| null>\(null\)/);
  assert.match(source, /const selectedTask = selectedTaskId[\s\S]*dailyTasks\.find\(\(task\) => task\.id === selectedTaskId\)/);
  assert.match(source, /onClick=\{\(\) => openTaskDetails\(task\)\}/);
  assert.match(source, /id="daily-task-detail-title"[\s\S]*\{selectedTask\.title\}/);
  assert.match(source, /\{selectedTask\.description \|\| 'Açıklama eklenmemiş\.'\}/);
  assert.match(source, /selectedTask\.status === 'completed' \? 'Tamamlandı' : 'Bekliyor'/);
  assert.match(source, /formatTaskDueDate\(selectedTask\.dueDate\)/);
  assert.match(source, /aria-label="Görev ayrıntısını kapat"[\s\S]*onClick=\{closeTaskDetails\}/);
  assert.match(source, /if \(event\.key === 'Escape'\)[\s\S]*setSelectedTaskId\(null\)/);
  assert.match(source, /dailyTasks\.some\(\(task\) => task\.id === selectedTaskId\)/);
  assert.match(source, /onClick=\{\(\) => void \(task\.status === 'completed' \? reopenTask\(task\.id\) : completeTask\(task\.id\)\)\}/);
  assert.match(source, /onClick=\{\(\) => openEditTaskModal\(task\)\}/);
  assert.match(source, /onClick=\{\(\) => void handleDeleteTask\(task\)\}/);
});

test('Dashboard task identity uses the tenant-scoped client list, initials fallback and a general-task icon', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  assert.match(source, /const clientById = new Map<string, Client>\([\s\S]*?clients\.map\(\(client\): \[string, Client\] => \[client\.id, client\]\)/);
  assert.match(source, /clientById\.get\(task\.clientId\)\?\.profilePhotoUrl/);
  assert.match(source, /onError=\{\(\) => setImageFailed\(true\)\}/);
  assert.match(source, /getClientInitials\(name\)/);
  assert.match(source, /task\.clientId !== null/);
  assert.match(source, /<ListChecks className="h-5 w-5"/);
  assert.match(source, /<ListChecks className="h-6 w-6"/);
  const detailTriggerIndex = source.indexOf('onClick={() => openTaskDetails(task)}');
  assert.notEqual(detailTriggerIndex, -1);
  const detailTriggerStart = source.lastIndexOf('<button', detailTriggerIndex);
  const detailTriggerEnd = source.indexOf('</button>', detailTriggerIndex);
  assert.ok(detailTriggerStart >= 0 && detailTriggerEnd > detailTriggerStart);
  assert.doesNotMatch(source.slice(detailTriggerStart, detailTriggerEnd), /<div/);
  assert.doesNotMatch(source, /task\.clientAvatar[^\n]*src=/);
});

test('daily task runtime harness is loopback-only, compiles the real service and cleans all residue', () => {
  const source = read('scripts/runDisposableDailyTaskRuntimeHarness.mjs');
  assert.match(source, /SUPABASE_ACCESS_TOKEN: _accessToken/);
  assert.match(source, /SUPABASE_DB_PASSWORD: _databasePassword/);
  assert.match(source, /127\.0\.0\.1|localhost/);
  assert.match(source, /dailyTaskService\.ts/);
  assert.match(source, /createDailyTask/);
  assert.match(source, /updateDailyTask/);
  assert.match(source, /setDailyTaskCompletion/);
  assert.match(source, /deleteDailyTask/);
  assert.match(source, /stop', '--project-id', projectId, '--no-backup/);
  assert.match(source, /TEMPORARY_DAILY_TASKS_ZERO/);
  assert.match(source, /TEMPORARY_RELATIONSHIPS_ZERO/);
  assert.match(source, /TEMPORARY_AUTH_USERS_ZERO/);
  assert.match(source, /DISPOSABLE_DOCKER_RESIDUE_ZERO/);
});
