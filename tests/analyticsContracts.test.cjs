'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test:analytics`.');

const contract = require(path.join(buildDir, 'features', 'analytics', 'utils', 'analyticsContract.js'));
const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const DIETITIAN_ID = '22222222-2222-4222-8222-222222222222';
const ids = [
  '30000000-0000-4000-8000-000000000001',
  '30000000-0000-4000-8000-000000000002',
  '30000000-0000-4000-8000-000000000003',
  '30000000-0000-4000-8000-000000000004',
  '30000000-0000-4000-8000-000000000005',
  '30000000-0000-4000-8000-000000000006',
  '30000000-0000-4000-8000-000000000007',
];

const measurement = (id, date, overrides = {}) => ({
  id, clientId: CLIENT_ID, date, weight: null, waist: null, hip: null, arm: null,
  rightArm: null, leftArm: null, chest: null, thigh: null, calf: null,
  rightCalf: null, leftCalf: null, neck: null, ...overrides,
});

const meal = (id, type, isCompleted, overrides = {}) => ({
  id, type, isCompleted, hasCompletionValue: true, calories: null,
  protein: null, carbs: null, fat: null, ...overrides,
});

const source = () => ({
  clientId: CLIENT_ID,
  dietitianId: DIETITIAN_ID,
  range: { key: '7d', startDate: '2026-08-05', endDate: '2026-08-11' },
  profile: { clientId: CLIENT_ID, startWeight: 80, currentWeight: 79, targetWeight: 70, waterGoalMl: 2000 },
  measurements: [
    measurement(ids[0], '2026-08-05', { weight: 78, waist: 90 }),
    measurement(ids[1], '2026-08-11', { weight: 76.5, waist: 88, rightArm: 31 }),
  ],
  latestMeasurement: measurement(ids[1], '2026-08-11', { weight: 76.5, waist: 88 }),
  latestWeightMeasurement: measurement(ids[1], '2026-08-11', { weight: 76.5, waist: 88 }),
  dailyLogs: [
    { id: ids[2], clientId: CLIENT_ID, date: '2026-08-05', waterMl: 2000, hasInvalidWaterValue: false },
    { id: ids[3], clientId: CLIENT_ID, date: '2026-08-06', waterMl: 2500, hasInvalidWaterValue: false },
    { id: ids[4], clientId: CLIENT_ID, date: '2026-08-07', waterMl: null, hasInvalidWaterValue: false },
    { id: ids[5], clientId: CLIENT_ID, date: '2026-08-08', waterMl: 0, hasInvalidWaterValue: false },
  ],
  mealPlans: [
    {
      id: ids[5], clientId: CLIENT_ID, dietitianId: DIETITIAN_ID, date: '2026-08-05',
      meals: [
        meal(ids[0], 'breakfast', true, { calories: 500, protein: 30, carbs: 45, fat: 15 }),
        meal(ids[1], 'lunch', false, { calories: null, protein: 25, carbs: null, fat: 10 }),
      ],
    },
    {
      id: ids[6], clientId: CLIENT_ID, dietitianId: DIETITIAN_ID, date: '2026-08-11',
      meals: [
        meal(ids[2], 'breakfast', true, { calories: 600, protein: 35, carbs: 55, fat: 18 }),
        meal(ids[3], 'dinner', true),
        meal(ids[4], 'snack', false),
      ],
    },
  ],
});

test('analytics ranges use deterministic inclusive Istanbul civil dates', () => {
  const instant = new Date('2026-08-11T21:30:00.000Z'); // 2026-08-12 in Istanbul
  assert.deepEqual(contract.resolveAnalyticsDateRange('7d', instant), {
    key: '7d', startDate: '2026-08-06', endDate: '2026-08-12',
  });
  assert.deepEqual(contract.resolveAnalyticsDateRange('30d', instant), {
    key: '30d', startDate: '2026-07-14', endDate: '2026-08-12',
  });
  assert.deepEqual(contract.resolveAnalyticsDateRange('3m', instant), {
    key: '3m', startDate: '2026-05-13', endDate: '2026-08-12',
  });
  assert.deepEqual(contract.resolveAnalyticsDateRange('all', instant), {
    key: 'all', startDate: null, endDate: '2026-08-12',
  });
  assert.equal(contract.countAnalyticsRangeDays({ key: '7d', startDate: '2026-08-05', endDate: '2026-08-11' }), 7);
  assert.equal(contract.isAnalyticsDate('2026-02-29'), false);
  assert.equal(contract.isAnalyticsDate('2028-02-29'), true);
});

test('analytics aggregation computes weight, adherence, water and body trends from real rows', () => {
  const report = contract.aggregateClientAnalytics(source());
  assert.equal(report.kpis.currentWeight, 76.5);
  assert.equal(report.kpis.startWeight, 80);
  assert.equal(report.kpis.weightChange, -3.5);
  assert.equal(report.kpis.targetGap, 6.5);
  assert.equal(report.kpis.lastMeasurementDate, '2026-08-11');
  assert.deepEqual(report.weightTrend.map(({ date, value }) => [date, value]), [
    ['2026-08-05', 78], ['2026-08-11', 76.5],
  ]);
  assert.deepEqual(report.bodyMeasurementTrends.find(({ field }) => field === 'waist').points, [
    { date: '2026-08-05', value: 90 }, { date: '2026-08-11', value: 88 },
  ]);
  assert.equal(report.kpis.plannedMeals, 5);
  assert.equal(report.kpis.completedMeals, 3);
  assert.equal(report.kpis.mealAdherencePercentage, 60);
  assert.deepEqual(report.dailyAdherence.map(({ planned, completed }) => [planned, completed]), [[2, 1], [3, 2]]);
  assert.ok(Math.abs(report.dailyAdherence[1].percentage - (200 / 3)) < 1e-10);
  assert.equal(report.kpis.water.averageMl, 1500);
  assert.equal(report.kpis.water.latestMl, 0);
  assert.equal(report.kpis.water.trackedDays, 3);
  assert.ok(Math.abs(report.kpis.water.goalAchievementPercentage - (200 / 3)) < 1e-10);
  assert.deepEqual(report.waterTrend.map(({ value }) => value), [2000, 2500, 0]);
  assert.deepEqual(report.weeklyAdherence.map(({ periodStart, periodEnd }) => [periodStart, periodEnd]), [
    ['2026-08-05', '2026-08-09'],
    ['2026-08-10', '2026-08-11'],
  ]);
});

test('canonical weight KPIs use all-time valid endpoints independently of the selected trend range', () => {
  const canonical = source();
  canonical.profile = { ...canonical.profile, startWeight: null, currentWeight: 79 };
  canonical.earliestWeightMeasurement = measurement(ids[6], '2026-01-02', { weight: 82 });
  canonical.latestMeasurement = measurement(ids[5], '2026-08-11', { weight: 19, waist: 87 });
  canonical.latestWeightMeasurement = measurement(ids[4], '2026-08-10', { weight: 76.5, waist: 88 });
  const report = contract.aggregateClientAnalytics(canonical);
  assert.equal(report.kpis.startWeight, 82);
  assert.equal(report.kpis.currentWeight, 76.5);
  assert.equal(report.kpis.weightChange, -5.5);
  assert.equal(report.kpis.lastMeasurementDate, '2026-08-11');
  assert.ok(report.weightTrend.every(({ date }) => date >= canonical.range.startDate));
});

test('analytics null and coverage semantics never invent complete data', () => {
  const report = contract.aggregateClientAnalytics(source());
  assert.deepEqual(report.plannedNutrition.calories, {
    total: 1100, coveredMeals: 2, totalMeals: 5, isComplete: false,
  });
  assert.equal(report.plannedNutrition.protein.isComplete, false);
  assert.equal(report.dataQuality.incompleteCalorieMeals, 3);
  assert.equal(report.dataQuality.incompleteMacroMeals, 3);

  const empty = source();
  empty.profile = { ...empty.profile, startWeight: null, currentWeight: null, targetWeight: null, waterGoalMl: null };
  empty.measurements = [measurement(ids[0], '2026-08-11')];
  empty.latestMeasurement = empty.measurements[0];
  empty.latestWeightMeasurement = null;
  empty.dailyLogs = [{ id: ids[2], clientId: CLIENT_ID, date: '2026-08-11', waterMl: null, hasInvalidWaterValue: true }];
  empty.mealPlans = [];
  const emptyReport = contract.aggregateClientAnalytics(empty);
  assert.equal(emptyReport.kpis.currentWeight, null);
  assert.equal(emptyReport.kpis.weightChange, null);
  assert.equal(emptyReport.kpis.mealAdherencePercentage, null);
  assert.equal(emptyReport.kpis.water.averageMl, null);
  assert.equal(emptyReport.kpis.water.goalAchievementPercentage, null);
  assert.equal(emptyReport.plannedNutrition.calories.total, null);
  assert.equal(emptyReport.dataQuality.invalidWaterRows, 1);
});

test('analytics rejects huge finite metrics and never emits Infinity', () => {
  const extreme = source();
  extreme.dailyLogs = [
    { id: ids[2], clientId: CLIENT_ID, date: '2026-08-05', waterMl: 2000, hasInvalidWaterValue: false },
    { id: ids[3], clientId: CLIENT_ID, date: '2026-08-06', waterMl: Number.MAX_VALUE, hasInvalidWaterValue: false },
  ];
  extreme.mealPlans[0].meals[0] = meal(ids[0], 'breakfast', true, {
    calories: Number.MAX_VALUE,
    protein: Number.MAX_VALUE,
    carbs: 45,
    fat: 15,
  });
  const report = contract.aggregateClientAnalytics(extreme);
  assert.equal(report.kpis.water.averageMl, 2000);
  assert.equal(report.kpis.water.trackedDays, 1);
  assert.equal(report.dataQuality.invalidWaterRows, 1);
  assert.deepEqual(report.waterTrend.map(({ value }) => value), [2000]);
  assert.equal(report.plannedNutrition.calories.coveredMeals, 1);
  assert.equal(report.plannedNutrition.calories.total, 600);
  assert.equal(report.plannedNutrition.calories.isComplete, false);
  assert.equal(report.plannedNutrition.protein.isComplete, false);
  assert.equal(JSON.stringify(report).includes('Infinity'), false);
});

test('analytics service authenticates and verifies active ownership before source reads', () => {
  const service = read('features/analytics/services/analyticsService.ts');
  const authIndex = service.indexOf('await requireCurrentDietitianId()');
  const relationshipIndex = service.indexOf('await assertActiveRelationship(dietitianId, clientId)');
  const sourceReadIndex = service.indexOf('await Promise.all([');
  assert.ok(authIndex >= 0 && relationshipIndex > authIndex && sourceReadIndex > relationshipIndex);
  assert.match(service, /\.eq\('dietitian_id', dietitianId\)[\s\S]*?\.eq\('client_id', clientId\)[\s\S]*?\.eq\('status', 'active'\)/);
  assert.match(service, /from\('measurements'\)[\s\S]*?\.eq\('client_id', clientId\)[\s\S]*?\.lte\('measured_at', range\.endDate\)/);
  assert.match(service, /from\('daily_logs'\)[\s\S]*?\.eq\('client_id', clientId\)[\s\S]*?\.lte\('date', range\.endDate\)/);
  assert.match(service, /from\('meal_plans'\)[\s\S]*?\.eq\('client_id', clientId\)[\s\S]*?\.eq\('dietitian_id', dietitianId\)/);
  assert.match(service, /if \(range\.startDate !== null\) query = query\.gte/);
  assert.match(service, /resolveProfilePhotoUrl\(client\.avatar_url,[\s\S]*?allowPrivatePath: true/);
  assert.doesNotMatch(service, /\bCLIENTS\b|setTimeout|Math\.random/);
  assert.doesNotMatch(service, /\bmock\b|\bfallback\b/i);
});

test('analytics UI and hook expose distinct loading/error/empty states without direct queries or mock series', () => {
  const page = read('pages/Analytics.tsx');
  const hook = read('features/analytics/hooks/useAnalytics.ts');
  assert.match(page, /useAnalytics\(\)/);
  assert.match(page, /clientListStatus === 'loading'[\s\S]*clientListStatus === 'error'/);
  assert.match(page, /analyticsStatus === 'loading'[\s\S]*analyticsStatus === 'error'/);
  assert.match(page, /trackedDays[\s\S]*periodDays/);
  assert.match(page, /report\.weightTrend\.length === 0/);
  assert.match(page, /report\.waterTrend\.length === 0/);
  assert.match(page, /!hasMealData/);
  assert.match(page, /visibleBodyTrends[\s\S]*bodyMeasurementTrends\.filter/);
  assert.match(page, /visibleBodyTrends\.map[\s\S]*CompactBodyTrend/);
  assert.match(page, /CompactBodyTrend[\s\S]*const latest = points\[points\.length - 1\]/);
  assert.match(page, /Tüm ölçümleri göster[\s\S]*points\.map/);
  assert.match(page, /aria-label=\{`\$\{label\} geçmişi: \$\{points\.length\} gerçek kayıt`\}/);
  assert.doesNotMatch(page, /\bCLIENTS\b|setTimeout|Math\.random/u);
  assert.doesNotMatch(page, /from\(|supabase|Yapay Zeka|AI (?:özeti|yorumu)/iu);
  assert.match(hook, /clientRequestGeneration/);
  assert.match(hook, /analyticsRequestGeneration/);
  assert.match(hook, /setAnalyticsStatus\('loading'\)/);
  assert.match(hook, /setAnalyticsStatus\('error'\)/);
  assert.doesNotMatch(hook, /setTimeout|Math\.random|mock|fallback/i);
});

test('analytics runtime harness is loopback-only, compiles real service and owns exact cleanup', () => {
  const harness = read('scripts/runDisposableAnalyticsRuntimeHarness.mjs');
  for (const secret of [
    'SUPABASE_ACCESS_TOKEN', 'SUPABASE_TOKEN', 'SUPABASE_DB_PASSWORD',
    'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_URL', 'SUPABASE_ANON_KEY',
    'VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY',
  ]) assert.match(harness, new RegExp(`${secret}: _`));
  assert.match(harness, /127\\\.0\\\.0\\\.1\|localhost/);
  assert.match(harness, /analyticsService\.ts/);
  assert.match(harness, /service\.fetchClientAnalytics/);
  assert.match(harness, /PENDING_REJECTED_HAVE_NO_ACTIVE_RELATIONSHIP/);
  assert.match(harness, /PENDING_WITHOUT_RELATION/);
  assert.match(harness, /REJECTED_WITHOUT_RELATION/);
  assert.match(harness, /ACTOR_SOURCE_DATA_RESIDUE_ZERO/);
  assert.match(harness, /DISPOSABLE_MATERIALIZATION_FAILURE_TEMP_RESIDUE_ZERO/);
  assert.match(harness, /stop', '--project-id', projectId, '--no-backup/);
  for (const residue of [
    'TEMPORARY_MEALS_ZERO', 'TEMPORARY_MEAL_PLANS_ZERO', 'TEMPORARY_DAILY_LOGS_ZERO',
    'TEMPORARY_MEASUREMENTS_ZERO', 'TEMPORARY_RELATIONSHIPS_ZERO',
    'TEMPORARY_AUTH_USERS_ZERO', 'DISPOSABLE_DOCKER_RESIDUE_ZERO',
  ]) assert.match(harness, new RegExp(residue));
});
