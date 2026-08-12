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

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const client = (status) => ({ status });
const appointment = (status) => ({ status });

const emptyTasks = (overrides = {}) => ({
  overdue: [],
  today: [],
  upcoming: [],
  completed: [],
  ...overrides,
});

test('dashboard summary counts only actionable data from the supplied real-data slices', () => {
  const summary = contract.summarizeDashboard({
    clients: [client('Aktif'), client('Aktif'), client('Onay Bekliyor'), client('Pasif')],
    todayAppointments: [appointment('upcoming'), appointment('completed'), appointment('cancelled')],
    tasks: emptyTasks({ overdue: [{}], today: [{}, {}] }),
  });

  assert.deepEqual(summary, {
    activeClientCount: 2,
    pendingClientCount: 1,
    todayAppointmentCount: 2,
    overdueTaskCount: 1,
    todayTaskCount: 2,
  });
});

test('dashboard focus prioritizes overdue tasks, then today tasks, then appointments', () => {
  assert.equal(
    contract.getDashboardFocusMessage({ overdueTaskCount: 2, todayTaskCount: 1, todayAppointmentCount: 4 }),
    '2 geciken görevi önce ele alın.',
  );
  assert.equal(
    contract.getDashboardFocusMessage({ overdueTaskCount: 0, todayTaskCount: 2, todayAppointmentCount: 4 }),
    'Bugün için 2 bekleyen göreviniz var.',
  );
  assert.equal(
    contract.getDashboardFocusMessage({ overdueTaskCount: 0, todayTaskCount: 0, todayAppointmentCount: 1 }),
    'Bugün 1 randevunuz var.',
  );
  assert.equal(
    contract.getDashboardFocusMessage({ overdueTaskCount: 0, todayTaskCount: 0, todayAppointmentCount: 0 }),
    'Bugün için bekleyen görev veya randevu bulunmuyor.',
  );
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

test('dashboard quick actions target existing operational routes and task focus actions', () => {
  const source = read('features/dashboard/pages/DashboardPage.tsx');
  for (const route of ['/appointments', '/clients', '/meal-plans', '/messages']) {
    assert.match(source, new RegExp(`navigate\\('${route.replace('/', '\\\/')}'\\)`));
  }
  assert.match(source, /focusTasks\('overdue'\)/);
  assert.match(source, /focusTasks\('today'\)/);
  assert.match(source, /openCreateTaskModal\(\)/);
});
