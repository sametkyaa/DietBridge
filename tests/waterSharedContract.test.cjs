'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test`.');

const readWeb = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');
const mobileRepoRoot = process.env.DIETBRIDGE_MOBILE_REPO
  ? path.resolve(process.env.DIETBRIDGE_MOBILE_REPO)
  : path.join(__dirname, '..', '..', 'DietBridge-Mobile-MVP10');
const readMobile = (relativePath) => fs.readFileSync(
  path.join(mobileRepoRoot, relativePath),
  'utf8',
);

const waterContract = require(path.join(buildDir, 'features', 'analytics', 'utils', 'waterContract.js'));
const analyticsContract = require(path.join(buildDir, 'features', 'analytics', 'utils', 'analyticsContract.js'));

test('canonical daily-log water values stay in liters for 1, 1.5, 0, null and missing', () => {
  for (const [raw, expected] of [
    [1, 1],
    [1.5, 1.5],
    [0, 0],
    [null, null],
    [undefined, null],
    ['', null],
  ]) {
    assert.equal(waterContract.parseDailyWaterLiters(raw), expected);
  }
  assert.equal(waterContract.isValidDailyWaterLiters(10), true);
  assert.equal(waterContract.isValidDailyWaterLiters(10.001), false);
});

test('analytics aggregation reports persisted liters without an implicit /1000 conversion', () => {
  const report = analyticsContract.aggregateClientAnalytics({
    clientId: '11111111-1111-4111-8111-111111111111',
    dietitianId: '22222222-2222-4222-8222-222222222222',
    range: { key: '7d', startDate: '2026-08-07', endDate: '2026-08-13' },
    profile: {
      clientId: '11111111-1111-4111-8111-111111111111',
      startWeight: null,
      currentWeight: null,
      targetWeight: null,
      waterGoalLiters: 2,
    },
    measurements: [],
    latestMeasurement: null,
    earliestWeightMeasurement: null,
    latestWeightMeasurement: null,
    dailyLogs: [
      { id: '30000000-0000-4000-8000-000000000001', clientId: '11111111-1111-4111-8111-111111111111', date: '2026-08-10', waterLiters: 1, hasInvalidWaterValue: false },
      { id: '30000000-0000-4000-8000-000000000002', clientId: '11111111-1111-4111-8111-111111111111', date: '2026-08-11', waterLiters: 1.5, hasInvalidWaterValue: false },
      { id: '30000000-0000-4000-8000-000000000003', clientId: '11111111-1111-4111-8111-111111111111', date: '2026-08-12', waterLiters: 0, hasInvalidWaterValue: false },
      { id: '30000000-0000-4000-8000-000000000004', clientId: '11111111-1111-4111-8111-111111111111', date: '2026-08-13', waterLiters: null, hasInvalidWaterValue: false },
    ],
    mealPlans: [],
  });

  assert.equal(report.kpis.water.averageLiters, 2.5 / 3);
  assert.equal(report.kpis.water.latestLiters, 0);
  assert.deepEqual(report.waterTrend.map(({ value }) => value), [1, 1.5, 0]);
  assert.equal(report.dataQuality.invalidWaterRows, 0);
});

test('Web and Mobile source paths preserve the same persisted water unit', () => {
  const analyticsService = readWeb('features/analytics/services/analyticsService.ts');
  const analyticsPage = readWeb('pages/Analytics.tsx');
  const clientDetails = readWeb('pages/ClientDetails.tsx');
  const mobileDashboard = readMobile('apps/mobile/src/features/clients/viewmodels/useDashboardViewModel.js');
  const mobileDailyLog = readMobile('apps/mobile/src/features/clients/services/dailyLogService.js');
  const mobileAnalytics = readMobile('apps/mobile/src/features/analytics/services/analyticsService.js');
  const mobileWaterCard = readMobile('apps/mobile/src/features/clients/components/dashboard/WaterTrackerCard.js');

  assert.match(analyticsService, /waterLiters: isValid \? parsed : null/);
  assert.doesNotMatch(analyticsService, /water_intake[\s\S]{0,220}\/\s*1000/);
  assert.doesNotMatch(clientDetails, /log\.water_intake\s*\/\s*1000/);
  assert.doesNotMatch(clientDetails, /recordedWaterValues\.reduce[\s\S]{0,180}\/\s*1000/);
  assert.match(analyticsPage, /points=\{report\.waterTrend\}/);
  assert.doesNotMatch(analyticsPage, /point\.value\s*\/\s*1000/);
  assert.match(
    mobileDashboard,
    /normalizePersistedWaterLiters\(\s*log\?\.\s*water_intake\s*\)/,
  );
  assert.match(mobileDashboard, /setWater\(\s*nextWater\s*\)/);
  assert.match(mobileDashboard, /addWaterLiters\(/);
  assert.match(mobileDashboard, /removeWaterLiters\(/);
  assert.match(
    mobileDashboard,
    /upsertWaterIntake\(\s*mutationDateKey\s*,\s*nextWater\s*\)/,
  );
  assert.match(
    mobileDashboard,
    /normalizePersistedWaterLiters\(\s*persistedWater\s*\)/,
  );
  assert.doesNotMatch(mobileDashboard, /water_intake\s*\/\s*1000/);
  assert.match(mobileDailyLog, /water_intake:\s*normalizedWater/);
  assert.match(
    mobileDailyLog,
    /normalizePersistedWaterLiters\(\s*data\?\.\s*water_intake\s*\)/,
  );
  assert.doesNotMatch(mobileDailyLog, /water_intake\s*\/\s*1000/);
  assert.match(
    mobileAnalytics,
    /normalizePersistedWaterLiters\(\s*log\.\s*water_intake\s*\)/,
  );
  assert.match(mobileAnalytics, /amount:\s*log\.amount/);
  assert.doesNotMatch(mobileAnalytics, /water_intake\s*\/\s*1000/);
  assert.match(mobileWaterCard, /water\.toFixed\(2\)/);
});

test('schema and date contract remain unchanged while water values stay nullable numeric liters', () => {
  const baseline = readWeb('supabase/migrations/20260713000001_production_public_baseline.sql');
  const analyticsContractSource = readWeb('features/analytics/utils/analyticsContract.ts');
  assert.match(baseline, /"water_intake"\s+(?:"numeric"|numeric)/);
  assert.match(analyticsContractSource, /ANALYTICS_TIME_ZONE = 'Europe\/Istanbul'/);
  assert.match(readWeb('docs/MVP10_SHARED_CONTRACT_INVENTORY.md'), /persisted `water_intake` is canonical liters/);
});
