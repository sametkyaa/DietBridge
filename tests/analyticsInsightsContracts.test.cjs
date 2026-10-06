'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test:analytics`.');

const contract = require(path.join(buildDir, 'features', 'analytics', 'utils', 'analyticsContract.js'));
const insights = require(path.join(buildDir, 'features', 'analytics', 'utils', 'analyticsInsights.js'));
const format = require(path.join(buildDir, 'features', 'analytics', 'utils', 'analyticsFormat.js'));
const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const CLIENT_ID = '11111111-1111-4111-8111-111111111111';
const DIETITIAN_ID = '22222222-2222-4222-8222-222222222222';
let seq = 0;
const id = () => `40000000-0000-4000-8000-${String(++seq).padStart(12, '0')}`;
const meal = (type, isCompleted, overrides = {}) => ({
  id: id(), type, isCompleted, hasCompletionValue: true, calories: null, protein: null, carbs: null, fat: null, ...overrides,
});
const plan = (date, meals) => ({ id: id(), clientId: CLIENT_ID, dietitianId: DIETITIAN_ID, date, meals });

const source = (range, mealPlans, overrides = {}) => ({
  clientId: CLIENT_ID,
  dietitianId: DIETITIAN_ID,
  range,
  profile: { clientId: CLIENT_ID, startWeight: 80, currentWeight: 78, targetWeight: 70, waterGoalLiters: 2 },
  measurements: [],
  latestMeasurement: null,
  earliestWeightMeasurement: null,
  latestWeightMeasurement: null,
  dailyLogs: [],
  mealPlans,
  ...overrides,
});

const RANGE = { key: '7d', startDate: '2026-10-01', endDate: '2026-10-07' };

test('meal × day matrix counts real planned meals and keeps the last day open', () => {
  const matrix = contract.buildMealDayMatrix([
    plan('2026-10-05', [meal('breakfast', true), meal('snack', false), meal('snack', true)]),
    plan('2026-10-06', [meal('breakfast', false)]),
    plan('2026-10-07', [meal('breakfast', false)]),
    plan('2026-09-20', [meal('dinner', true)]),
  ], RANGE);
  assert.equal(matrix.dates.length, 7);
  assert.deepEqual(matrix.rows.map((row) => row.type), ['breakfast', 'snack']);
  const breakfast = matrix.rows[0].cells;
  assert.equal(breakfast.find((cell) => cell.date === '2026-10-05').state, 'done');
  assert.equal(breakfast.find((cell) => cell.date === '2026-10-06').state, 'missed');
  assert.equal(breakfast.find((cell) => cell.date === '2026-10-07').state, 'open');
  assert.equal(breakfast.find((cell) => cell.date === '2026-10-01').state, 'none');
  assert.equal(matrix.rows[1].cells.find((cell) => cell.date === '2026-10-05').state, 'partial');
  assert.equal(matrix.planned, 5);
  assert.equal(matrix.completed, 2);
  // Out-of-range plans never leak into the grid.
  assert.equal(matrix.rows.some((row) => row.type === 'dinner'), false);
  const long = contract.buildMealDayMatrix([], { key: 'all', startDate: null, endDate: '2026-10-07' });
  assert.equal(long.dates.length, contract.MEAL_DAY_MATRIX_DAYS);
  assert.equal(long.dates[0], '2026-09-24');
});

test('previous period anchor resolves to the same-length window right before', () => {
  const now = insights.getPreviousPeriodNow(RANGE);
  const previous = contract.resolveAnalyticsDateRange('7d', now);
  assert.deepEqual(previous, { key: '7d', startDate: '2026-09-24', endDate: '2026-09-30' });
  assert.equal(insights.getPreviousPeriodNow({ key: 'all', startDate: null, endDate: '2026-10-07' }), null);
});

test('comparison and insights only use values that exist', () => {
  const current = contract.aggregateClientAnalytics(source(RANGE, [
    plan('2026-10-02', [meal('breakfast', true), meal('lunch', true), meal('snack', false)]),
    plan('2026-10-03', [meal('breakfast', true), meal('lunch', true), meal('snack', false)]),
    plan('2026-10-04', [meal('breakfast', true), meal('lunch', true), meal('snack', false)]),
  ]));
  const previous = contract.aggregateClientAnalytics(source({ key: '7d', startDate: '2026-09-24', endDate: '2026-09-30' }, [
    plan('2026-09-25', [meal('breakfast', true), meal('lunch', false)]),
    plan('2026-09-26', [meal('breakfast', false), meal('lunch', false)]),
  ]));
  const comparison = insights.compareAnalyticsReports(current, previous);
  assert.equal(Math.round(comparison.adherence.delta), 42);
  assert.equal(comparison.water.delta, null);
  const list = insights.deriveAnalyticsInsights(current, comparison);
  const keys = list.map((item) => item.key);
  assert.ok(keys.includes('adherence-change'));
  assert.match(list.find((item) => item.key === 'adherence-change').text, /42 puan arttı/);
  assert.ok(keys.includes('weakest-meal-type'));
  assert.match(list.find((item) => item.key === 'weakest-meal-type').text, /Ara öğün türünde: %0 \(0\/3\)/);
  assert.ok(keys.includes('calorie-gaps'));
  // No water goal days, no weight trend, no measurement → no invented insight about them.
  assert.equal(keys.includes('water-goal'), false);
  assert.equal(keys.includes('weight-direction'), false);
  assert.equal(keys.includes('measurement-stale'), false);
  assert.deepEqual(insights.deriveAnalyticsInsights(contract.aggregateClientAnalytics(source(RANGE, [])), null), []);
});

test('XLSX export uses the same formatted values as the screen', () => {
  const report = contract.aggregateClientAnalytics(source(RANGE, [
    plan('2026-10-05', [meal('breakfast', true, { calories: 300 }), meal('lunch', false, { calories: 500 })]),
  ]));
  const sheets = insights.buildAnalyticsExportSheets('Elif Yıldız', report, null, []);
  assert.deepEqual(sheets.map((sheet) => sheet.name), ['Özet', 'Günlük uyum', 'Haftalık uyum', 'Öğün türü', 'Öğün x gün', 'Ölçümler', 'Su']);
  const summary = sheets[0].rows;
  const adherenceRow = summary.find((row) => row[0] === 'Öğün uyumu');
  assert.equal(adherenceRow[1], format.formatPercentage(report.kpis.mealAdherencePercentage));
  assert.equal(adherenceRow[1], '%50');
  assert.deepEqual(summary.find((row) => row[0] === 'Tamamlanan / planlanan öğün'), ['Tamamlanan / planlanan öğün', '1 / 2', null, null]);
  assert.deepEqual(sheets[1].rows[1], [format.formatPeriodLabel(report.dailyAdherence[0]), 1, 2, '%50']);
  assert.equal(format.formatPointDelta(6.4), '+6 puan');
  assert.equal(format.formatPointDelta(-2.6), '−3 puan');
});

test('Analytics page wires comparison, insights, matrix and export through shared formatters', () => {
  const page = read('pages/Analytics.tsx');
  const hook = read('features/analytics/hooks/useAnalytics.ts');
  assert.match(page, /from '\.\.\/features\/analytics\/utils\/analyticsFormat'/);
  assert.doesNotMatch(page, /const formatPercentage = /);
  assert.match(page, /<MealDayMatrixCard matrix=\{report\.mealDayMatrix\} \/>/);
  assert.match(page, /<InsightsCard insights=\{insights\}/);
  assert.match(page, /buildAnalyticsExportSheets\(clientName, report, comparison, insights\)/);
  assert.match(hook, /getPreviousPeriodNow\(nextReport\.range\)/);
  assert.match(hook, /\.catch\(\(\) => undefined\)/);
});
