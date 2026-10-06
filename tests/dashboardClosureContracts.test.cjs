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
  assert.match(source, /useAutomaticTasks\(\)/);
  assert.match(source, /useUnreadCounts\(\)/);
  assert.match(source, /appointmentsError \|\| taskViewState\.status === 'error'/);
  assert.match(source, /clientLoadError/);
  // Every KPI is computed from loaded rows; unavailable data renders "—", never a sample number.
  assert.match(source, /value=\{clientLoadError \? '—' : activeClients\.length\}/);
  assert.match(source, /value=\{appointmentsError \? '—' : weekAppointments\.length\}/);
  assert.match(source, /value=\{averageAdherence === null \? '—' : formatPercentageDisplay\(averageAdherence\)\}/);
  assert.match(source, /value=\{unreadState\.status === 'success' \? unreadState\.total : '—'\}/);
  assert.doesNotMatch(source, /%82|2\.1 Lt|1850|Protein alımı hedefin üzerinde|Kota|kontenjan|Katıl/iu);
});

test('dashboard keeps one KPI row and the real today schedule section', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  const schedule = read('features/dashboard/components/TodayScheduleCard.tsx');
  assert.equal((source.match(/<KpiTile/g) ?? []).length, 4);
  assert.equal((source.match(/<KpiGrid[ >]/g) ?? []).length, 1);
  assert.match(schedule, /title="Bugünün programı"/);
  assert.match(source, /<TodayScheduleCard/);
});

test('dashboard exposes one direct canonical task-create action in Daily Tasks', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  const panel = read('features/dashboard/components/DashboardTaskPanel.tsx');
  assert.doesNotMatch(source, /MoreHorizontal|isTaskMenuOpen|taskMenuButtonRef|Görev menüsünü aç/u);
  assert.equal((panel.match(/onClick=\{onCreate\}>Görev ekle</g) ?? []).length, 1);
  assert.match(source, /onCreate=\{openCreateTaskModal\}/u);
  assert.match(source, /onSubmit=\{\(event\) => void handleTaskSubmit\(event\)\}/u);
  assert.match(source, /: await createTask\(taskDraft\)/u);
  assert.match(source, /setIsAddTaskModalOpen\(false\)/u);
});

test('dashboard actions target existing operational routes', () => {
  const page = read('features/dashboard/pages/DashboardPage.tsx');
  const panel = read('features/dashboard/components/DashboardTaskPanel.tsx');
  const next = read('features/dashboard/components/NextAppointmentBanner.tsx');
  assert.match(page, /to="\/appointments\?new=1"/);
  assert.match(panel, /to=\{`\/meal-plans\?clientId=\$\{client\}`\}/);
  assert.match(panel, /to=\{`\/messages\?clientId=\$\{client\}`\}/);
  assert.match(panel, /to=\{`\/clients\/\$\{client\}`\}/);
  assert.match(next, /to=\{`\/clients\/\$\{encodeURIComponent\(appointment\.clientId\)\}`\}/);
  assert.doesNotMatch(next, /Katıl|video|meet\./i);
});
