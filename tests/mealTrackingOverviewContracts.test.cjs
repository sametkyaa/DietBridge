'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm test`.');

const contract = require(path.join(buildDir, 'features', 'meal-tracking', 'utils', 'mealTrackingContract.js'));
const service = require(path.join(buildDir, 'features', 'meal-tracking', 'services', 'mealTrackingService.js'));
const supabaseStub = require(path.join(buildDir, 'lib', 'supabaseClient.js'));

const repoRoot = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const IDS = {
  dietitian: '11111111-1111-4111-8111-111111111111',
  clientA: '22222222-2222-4222-8222-222222222222',
  clientB: '33333333-3333-4333-8333-333333333333',
  clientC: '44444444-4444-4444-8444-444444444444',
  clientOther: '55555555-5555-4555-8555-555555555555',
};

const PLAN_ID = '66666666-6666-4666-8666-666666666666';

const idFor = (index) => `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`;

const meal = (index, overrides = {}) => ({
  id: idFor(index),
  planId: PLAN_ID,
  date: '2026-08-24',
  type: 'breakfast',
  title: `Planlı öğün ${index}`,
  time: '08:00',
  sortOrder: index,
  isCompleted: false,
  completedAt: null,
  photoPath: null,
  ...overrides,
});

const day = (date, meals) => contract.summarizeMealTrackingDay(date, meals);

const client = (clientId = IDS.clientA) => ({
  clientId,
  displayName: 'Gerçek Danışan',
  avatar: 'https://example.test/avatar.png',
});

test('today summary maps only the actual breakfast and dinner records', () => {
  const today = '2026-08-24';
  const result = contract.summarizeMealTrackingOverview(
    client(),
    [day(today, [
      meal(1, { type: 'breakfast', title: 'Kahvaltı planı', sortOrder: 0 }),
      meal(2, { type: 'dinner', title: 'Akşam planı', time: '19:00', sortOrder: 1 }),
    ])],
    'today',
    today,
  );

  assert.equal(result.plannedCount, 2);
  assert.equal(result.completedCount, 0);
  assert.equal(result.percentage, 0);
  assert.deepEqual(result.mealSummary.map((entry) => entry.label), ['Kahvaltı', 'Akşam']);
  assert.equal(result.mealSummary.some((entry) => entry.label === 'Öğle'), false);
});

test('today summary preserves five real meals and distinguishes duplicate snacks by time', () => {
  const today = '2026-08-24';
  const result = contract.summarizeMealTrackingOverview(
    client(),
    [day(today, [
      meal(1, { type: 'breakfast', sortOrder: 0 }),
      meal(2, { type: 'snack', time: '10:30', sortOrder: 1 }),
      meal(3, { type: 'lunch', time: '13:00', sortOrder: 2 }),
      meal(4, { type: 'snack', time: '16:00', sortOrder: 3 }),
      meal(5, { type: 'dinner', time: '19:00', sortOrder: 4 }),
    ])],
    'today',
    today,
  );

  assert.equal(result.mealSummary.length, 5);
  assert.deepEqual(result.mealSummary.map((entry) => entry.label), [
    'Kahvaltı',
    'Ara Öğün · 10:30',
    'Öğle',
    'Ara Öğün · 16:00',
    'Akşam',
  ]);
});

test('active client with no plan remains visible without a fabricated percentage', () => {
  const result = contract.summarizeMealTrackingOverview(client(IDS.clientB), [], 'today', '2026-08-24');

  assert.equal(result.plannedCount, 0);
  assert.equal(result.completedCount, 0);
  assert.equal(result.percentage, null);
  assert.deepEqual(result.mealSummary, []);
  assert.equal(result.lastCompletedAt, null);
});

test('today percentage uses the real four-meal denominator', () => {
  const today = '2026-08-24';
  const result = contract.summarizeMealTrackingOverview(
    client(),
    [day(today, [
      meal(1, { isCompleted: true, completedAt: '2026-08-24T06:00:00.000Z' }),
      meal(2, { type: 'snack', isCompleted: true, completedAt: '2026-08-24T08:00:00.000Z', sortOrder: 1 }),
      meal(3, { type: 'lunch', isCompleted: true, completedAt: '2026-08-24T10:00:00.000Z', sortOrder: 2 }),
      meal(4, { type: 'dinner', sortOrder: 3 }),
    ])],
    'today',
    today,
  );

  assert.deepEqual(
    { completed: result.completedCount, planned: result.plannedCount, percentage: result.percentage },
    { completed: 3, planned: 4, percentage: 75 },
  );
});

test('seven-day summary uses 21/26 total and real per-type denominators', () => {
  const meals = [];
  let index = 1;
  const addMeals = (type, count, completedCount, sortOrder) => {
    for (let offset = 0; offset < count; offset += 1) {
      meals.push(meal(index, {
        type,
        sortOrder,
        time: `${String(8 + offset).padStart(2, '0')}:00`,
        isCompleted: offset < completedCount,
        completedAt: offset < completedCount ? `2026-08-${String(18 + offset).padStart(2, '0')}T08:00:00.000Z` : null,
        date: '2026-08-24',
      }));
      index += 1;
    }
  };

  addMeals('breakfast', 6, 5, 0);
  addMeals('snack', 11, 9, 1);
  addMeals('dinner', 9, 7, 3);

  const result = contract.summarizeMealTrackingOverview(
    client(),
    [day('2026-08-18', meals.slice(0, 4)), day('2026-08-24', meals.slice(4))],
    '7d',
    '2026-08-24',
  );

  assert.deepEqual(
    { completed: result.completedCount, planned: result.plannedCount, percentage: result.percentage },
    { completed: 21, planned: 26, percentage: 81 },
  );
  assert.deepEqual(result.mealSummary.map((entry) => [entry.label, entry.completedCount, entry.plannedCount]), [
    ['Kahvaltı', 5, 6],
    ['Ara Öğün', 9, 11],
    ['Akşam', 7, 9],
  ]);
  assert.equal(result.mealSummary.some((entry) => entry.label === 'Öğle'), false);
});

test('overview status contract distinguishes complete, partial and zero-completion aggregates', () => {
  assert.equal(contract.getMealTrackingOverviewTypeStatus(3, 3), 'complete');
  assert.equal(contract.getMealTrackingOverviewTypeStatus(2, 3), 'partial');
  assert.equal(contract.getMealTrackingOverviewTypeStatus(0, 3), 'unmarked');
  assert.equal(contract.getMealTrackingOverviewTypeStatus(0, 0), 'unmarked');

  const completed = meal(1, { isCompleted: true });
  const pending = meal(2);
  assert.equal(contract.getMealTrackingStatus(completed, '2026-08-24', '2026-08-24'), 'completed');
  assert.equal(contract.getMealTrackingStatus(pending, '2026-08-24', '2026-08-24'), 'pending');
  assert.equal(contract.getMealTrackingStatus(pending, '2026-08-23', '2026-08-24'), 'unmarked');
});

test('last completed timestamp uses Istanbul labels and ignores pending meals', () => {
  const result = contract.summarizeMealTrackingOverview(
    client(),
    [day('2026-08-24', [
      meal(1, { isCompleted: true, completedAt: '2026-08-24T06:00:00.000Z' }),
      meal(2, { type: 'dinner', isCompleted: true, completedAt: '2026-08-24T16:20:00.000Z', sortOrder: 1 }),
      meal(3, { type: 'snack', completedAt: '2026-08-24T19:00:00.000Z', sortOrder: 2 }),
    ])],
    'today',
    '2026-08-24',
  );

  assert.equal(result.lastCompletedAt, '2026-08-24T16:20:00.000Z');
  assert.equal(contract.formatMealTrackingLastCompletedAt(result.lastCompletedAt, '2026-08-24').startsWith('Bugün, '), true);
  assert.equal(contract.formatMealTrackingLastCompletedAt('2026-08-23T16:20:00.000Z', '2026-08-24').startsWith('Dün, '), true);
});

const relationRow = (clientId, name, status = 'active', dietitianId = IDS.dietitian) => ({
  dietitian_id: dietitianId,
  status,
  client: {
    id: clientId,
    full_name: name,
    avatar_url: null,
    email: `${clientId.slice(0, 8)}@example.test`,
    client_profiles: null,
    client_medical_conditions: null,
    client_medications: null,
  },
});

const planRow = (clientId, overrides = {}) => ({
  id: PLAN_ID,
  client_id: clientId,
  dietitian_id: IDS.dietitian,
  plan_date: '2026-08-24',
  meals: [{
    id: idFor(100),
    plan_id: PLAN_ID,
    type: 'breakfast',
    title: 'Gerçek kahvaltı',
    time: '08:00:00',
    sort_order: 0,
    is_eaten: true,
    completed_at: '2026-08-24T06:00:00.000Z',
    photo_url: null,
  }],
  ...overrides,
});

const installOverviewQueryStub = ({ relationships, plans }) => {
  const calls = [];
  supabaseStub.__setUserId(IDS.dietitian);
  supabaseStub.__setFromHandler((table) => {
    const filters = new Map();
    const query = {
      select: (value) => {
        calls.push({ table, operation: 'select', value });
        return query;
      },
      eq: (column, value) => {
        filters.set(column, value);
        calls.push({ table, operation: 'eq', column, value });
        return query;
      },
      in: (column, value) => {
        filters.set(column, value);
        calls.push({ table, operation: 'in', column, value });
        return query;
      },
      gte: (column, value) => {
        filters.set(`${column}.gte`, value);
        calls.push({ table, operation: 'gte', column, value });
        return query;
      },
      lte: (column, value) => {
        filters.set(`${column}.lte`, value);
        calls.push({ table, operation: 'lte', column, value });
        return query;
      },
      order: (column, options) => {
        calls.push({ table, operation: 'order', column, options });
        return query;
      },
      then: (resolve, reject) => {
        let rows = table === 'dietitian_clients' ? relationships : plans;
        if (table === 'dietitian_clients') {
          const allowedStatuses = filters.get('status');
          rows = rows.filter((row) => (
            row.dietitian_id === filters.get('dietitian_id')
            && Array.isArray(allowedStatuses)
            && allowedStatuses.includes(row.status)
          ));
        } else {
          rows = rows.filter((row) => (
            row.dietitian_id === filters.get('dietitian_id')
            && filters.get('client_id').includes(row.client_id)
            && row.plan_date >= filters.get('plan_date.gte')
            && row.plan_date <= filters.get('plan_date.lte')
          ));
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
      },
    };
    calls.push({ table, operation: 'from' });
    return query;
  });
  return calls;
};

test('bulk overview authenticates once and uses one relationship query plus one meal-plan query', async () => {
  const relationships = Array.from({ length: 50 }, (_, index) => (
    relationRow(
      `88888888-8888-4888-8888-${String(index + 1).padStart(12, '0')}`,
      `Danışan ${index + 1}`,
    )
  ));
  const plans = relationships.map((row, index) => planRow(row.client.id, {
    id: `99999999-9999-4999-8999-${String(index + 1).padStart(12, '0')}`,
    meals: [{
      id: idFor(200 + index),
      plan_id: `99999999-9999-4999-8999-${String(index + 1).padStart(12, '0')}`,
      type: 'breakfast',
      title: 'Gerçek kahvaltı',
      time: '08:00:00',
      sort_order: 0,
      is_eaten: index % 2 === 0,
      completed_at: index % 2 === 0 ? '2026-08-24T06:00:00.000Z' : null,
      photo_url: null,
    }],
  }));
  const calls = installOverviewQueryStub({ relationships, plans });

  const result = await service.fetchMealTrackingOverview('2026-08-24', '2026-08-24', 'today');

  assert.equal(result.length, 50);
  assert.equal(calls.filter((call) => call.operation === 'from' && call.table === 'dietitian_clients').length, 1);
  assert.equal(calls.filter((call) => call.operation === 'from' && call.table === 'meal_plans').length, 1);
  assert.equal(calls.filter((call) => call.operation === 'eq' && call.column === 'dietitian_id').length, 2);
  assert.equal(calls.filter((call) => call.operation === 'in' && call.column === 'client_id').length, 1);
  assert.equal(calls.filter((call) => call.operation === 'eq' && call.column === 'client_id').length, 0);
});

test('security filters keep pending, inactive and another dietitian rows out of the overview', async () => {
  const relationships = [
    relationRow(IDS.clientA, 'Aktif Danışan'),
    relationRow(IDS.clientB, 'Bekleyen Danışan', 'pending'),
    relationRow(IDS.clientC, 'Pasif Danışan', 'removed'),
    relationRow(IDS.clientOther, 'Başka Diyetisyen Danışanı', 'active', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  ];
  const plans = [
    planRow(IDS.clientA),
    planRow(IDS.clientB),
    planRow(IDS.clientOther, { dietitian_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }),
  ];
  const calls = installOverviewQueryStub({ relationships, plans });
  const result = await service.fetchMealTrackingOverview('2026-08-24', '2026-08-30', '7d');

  assert.deepEqual(result.map((row) => row.clientId), [IDS.clientA]);
  const relationStatusFilter = calls.find((call) => call.table === 'dietitian_clients' && call.operation === 'in' && call.column === 'status');
  assert.deepEqual(relationStatusFilter.value, ['active']);
  assert.equal(calls.some((call) => call.table === 'meal_plans' && call.operation === 'eq' && call.column === 'dietitian_id' && call.value === IDS.dietitian), true);
  assert.equal(calls.some((call) => call.table === 'meal_plans' && call.operation === 'in' && call.column === 'client_id' && call.value.length === 1 && call.value[0] === IDS.clientA), true);
});

test('overview and sidebar source chains preserve authorization, detail navigation and mobile destinations', () => {
  const overviewService = read('features/meal-tracking/services/mealTrackingService.ts');
  const clientService = read('features/clients/services/clientService.ts');
  const overviewPage = read('features/meal-tracking/pages/MealTrackingOverviewPage.tsx');
  const singleClientService = read('features/meal-tracking/services/mealTrackingService.ts');
  const protectedRoute = read('shared/components/ProtectedRoute.tsx');
  const app = read('App.tsx');
  const sidebar = read('shared/components/Sidebar.tsx');

  assert.match(overviewService, /fetchActiveDietitianClientListForUser\(dietitianId\)/);
  assert.match(overviewService, /\.eq\('dietitian_id', dietitianId\)/);
  assert.match(overviewService, /\.in\('client_id', clientIds\)/);
  assert.match(clientService, /\.eq\('dietitian_id', dietitianId\)/);
  assert.match(clientService, /\.in\('status', relationStatuses\)/);
  assert.match(singleClientService, /\.eq\('client_id', clientId\)[\s\S]*?\.eq\('status', 'active'\)/);
  assert.match(singleClientService, /code === 'FORBIDDEN'/);
  assert.match(protectedRoute, /blocked_client/);
  assert.doesNotMatch(overviewService, /Math\.random|\bCLIENTS\b|setTimeout/);
  assert.doesNotMatch(overviewPage, /Ahmet Yılmaz|Ayşe Kaya|Mehmet Demir|Zeynep Çelik|Can Öztürk|Elif Şahin/);
  assert.match(overviewPage, /fetchMealTrackingOverview\(range\.startDate, range\.endDate, filter\)/);
  assert.match(overviewPage, /toLocaleLowerCase\('tr-TR'\)/);
  assert.match(overviewPage, /aria-pressed=\{filter === value\}/);
  assert.match(overviewPage, /Tekrar dene/);
  assert.match(overviewPage, /Henüz aktif danışanınız bulunmuyor/);
  assert.match(overviewPage, /Aramanızla eşleşen aktif danışan bulunamadı/);
  assert.match(overviewPage, /\/clients\/\$\{client\.clientId\}\/meal-tracking/);
  assert.match(app, /<Route path="\/meal-tracking" element={<MealTrackingOverviewPage \/>} \/>/);
  assert.match(sidebar, /label: 'Öğün Takibi', path: '\/meal-tracking'/);
  assert.match(sidebar, /const mobileNavPaths = \['\/', '\/appointments', '\/clients', '\/meal-plans', '\/messages'\]/);
  assert.doesNotMatch(sidebar, /navItems\[4\]|navItems\[6\]/);
});
