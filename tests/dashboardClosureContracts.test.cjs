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
  'dashboardContract.js',
));
const dailyTaskContract = require(path.join(
  buildDir,
  'features',
  'dashboard',
  'utils',
  'dailyTaskContract.js',
));

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const appointment = (status) => ({ status });

const emptyTasks = (overrides = {}) => ({
  overdue: [],
  today: [],
  upcoming: [],
  completed: [],
  ...overrides,
});

test('dashboard focus formats every task and appointment count state naturally', () => {
  const cases = [
    [2, 3, 'Bugün 2 bekleyen göreviniz ve 3 randevunuz var.'],
    [1, 1, 'Bugün 1 bekleyen göreviniz ve 1 randevunuz var.'],
    [0, 3, 'Bugün bekleyen göreviniz yok, 3 randevunuz var.'],
    [2, 0, 'Bugün 2 bekleyen göreviniz var, randevunuz yok.'],
    [0, 0, 'Bugün bekleyen göreviniz veya randevunuz yok.'],
  ];

  for (const [todayTaskCount, todayAppointmentCount, expected] of cases) {
    assert.equal(
      contract.getDashboardFocusMessage({ todayTaskCount, todayAppointmentCount }),
      expected,
    );
  }
});

test('dashboard summary counts only today tasks and valid today appointments from supplied slices', () => {
  const summary = contract.summarizeDashboard({
    todayAppointments: [appointment('upcoming'), appointment('completed'), appointment('cancelled')],
    tasks: emptyTasks({ overdue: [{}], today: [{}, {}] }),
  });

  assert.deepEqual(summary, {
    todayAppointmentCount: 2,
    todayTaskCount: 2,
  });
});

test('dashboard focus task count reuses the canonical Bugün task grouping semantics', () => {
  const task = (id, overrides = {}) => ({
    id,
    title: 'Görev',
    dueDate: '2026-08-11',
    dueTime: null,
    priority: 'medium',
    status: 'pending',
    completedAt: null,
    ...overrides,
  });
  const groups = dailyTaskContract.groupDailyTasks([
    task('today-pending'),
    task('today-past-due-time', { dueTime: '08:59' }),
    task('today-completed', { status: 'completed', completedAt: '2026-08-11T08:00:00.000Z' }),
    task('future-pending', { dueDate: '2026-08-12' }),
    task('overdue-pending', { dueDate: '2026-08-10' }),
  ], new Date('2026-08-11T07:00:00.000Z'));

  assert.deepEqual(groups.today.map(({ id }) => id), ['today-pending']);
  assert.deepEqual(groups.completed.map(({ id }) => id), ['today-completed']);
  assert.deepEqual(groups.upcoming.map(({ id }) => id), ['future-pending']);
  assert.deepEqual(groups.overdue.map(({ id }) => id), ['overdue-pending', 'today-past-due-time']);
  assert.equal(contract.summarizeDashboard({
    todayAppointments: [],
    tasks: groups,
  }).todayTaskCount, groups.today.length);
});

test('dashboard page is real-data-only for the operational summary and has distinct recovery states', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  assert.match(source, /summarizeDashboard\(/);
  assert.match(source, /getDashboardFocusMessage\(/);
  assert.match(source, /fetchDietitianClients\(\)/);
  assert.match(source, /useAppointments\(\)/);
  assert.match(source, /useDailyTasks\(\)/);
  assert.match(source, /appointmentsLoading[\s\S]*appointmentsError[\s\S]*todaysAppointments\.length/);
  assert.match(source, /taskViewState\.status === 'loading'[\s\S]*taskViewState\.status === 'error'/);
  assert.match(source, /clientLoadError/);
  assert.doesNotMatch(source, /%82|2\.1 Lt|1850|Protein alımı hedefin üzerinde/iu);
});

test('dashboard removes duplicate summary cards while keeping the real appointments section', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  assert.doesNotMatch(source, /<p className="text-xs font-bold uppercase tracking-wide text-slate-400">Aktif danışan<\/p>/u);
  assert.doesNotMatch(source, /<p className="text-xs font-bold uppercase tracking-wide text-slate-400">Bugünkü randevu<\/p>/u);
  assert.doesNotMatch(source, /<p className="text-xs font-bold uppercase tracking-wide text-slate-400">Geciken görev<\/p>/u);
  assert.doesNotMatch(source, /<p className="text-xs font-bold uppercase tracking-wide text-slate-400">Bugünün görevi<\/p>/u);
  assert.doesNotMatch(source, /grid grid-cols-2 gap-3 lg:grid-cols-4/u);
  assert.match(source, />Bugünkü Randevular<\/h3>/u);
});

test('dashboard exposes one direct canonical task-create action in Daily Tasks', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  assert.doesNotMatch(source, /MoreHorizontal|isTaskMenuOpen|taskMenuButtonRef|Görev menüsünü aç/u);
  assert.doesNotMatch(source, />Görev ekle<\/button>/u);
  assert.match(source, /onClick=\{openCreateTaskModal\}[\s\S]*Yeni Görev Ekle/u);
  assert.match(source, /onSubmit=\{handleTaskSubmit\}/u);
  assert.match(source, /: await createTask\(taskDraft\)/u);
  assert.match(source, /onClick=\{\(\) => setIsAddTaskModalOpen\(false\)\}/u);
});

test('dashboard quick actions target existing operational routes', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  for (const route of ['/appointments', '/clients', '/meal-plans', '/messages']) {
    assert.match(source, new RegExp(`navigate\\('${route.replace('/', '\\\/')}'\\)`));
  }
});
