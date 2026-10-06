'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test:meal-plan`.');

const list = require(path.join(buildDir, 'features', 'clients', 'utils', 'clientListContract.js'));
const profile = require(path.join(buildDir, 'features', 'clients', 'utils', 'clientProfileContract.js'));
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

const TODAY = '2026-10-06';

test('attention is raised only by real low adherence or an overdue recorded measurement', () => {
  const active = (compliance) => ({ status: 'Aktif', compliance });
  assert.deepEqual(list.getClientAttentionReasons(active(30), { lastMeasuredAt: '2026-10-01', nextAppointment: null }, TODAY), ['low_adherence']);
  assert.deepEqual(list.getClientAttentionReasons(active(50), { lastMeasuredAt: '2026-09-05', nextAppointment: null }, TODAY), ['measurement_overdue']);
  assert.deepEqual(list.getClientAttentionReasons(active(50), { lastMeasuredAt: '2026-09-06', nextAppointment: null }, TODAY), []);
  // Missing data never flags a client on its own.
  assert.deepEqual(list.getClientAttentionReasons(active(null), { lastMeasuredAt: null, nextAppointment: null }, TODAY), []);
  assert.deepEqual(list.getClientAttentionReasons(active(null), undefined, TODAY), []);
  // Pending relationships are never "Dikkat".
  assert.deepEqual(list.getClientAttentionReasons({ status: 'Onay Bekliyor', compliance: 0 }, undefined, TODAY), []);
});

test('next appointment skips past slots of today and keeps the earliest per client', () => {
  const rows = [
    { client_id: 'a', date: TODAY, time: '09:00:00', title: 'Geçti' },
    { client_id: 'a', date: '2026-10-08', time: '10:00:00', title: 'Kontrol' },
    { client_id: 'a', date: TODAY, time: '15:30:00', title: 'Bugün' },
    { client_id: 'b', date: '2026-10-07', time: '08:00', title: 'Ölçüm' },
    { client_id: 'c', date: 'bozuk', time: '08:00', title: 'x' },
  ];
  const next = list.pickNextAppointments(rows, TODAY, '12:00');
  assert.deepEqual(next.get('a'), { date: TODAY, time: '15:30', title: 'Bugün' });
  assert.deepEqual(next.get('b'), { date: '2026-10-07', time: '08:00', title: 'Ölçüm' });
  assert.equal(next.has('c'), false);
  assert.equal(list.formatNextAppointment(next.get('a'), TODAY), 'Bugün 15:30');
  assert.equal(list.formatNextAppointment(next.get('b'), TODAY), 'Yarın 08:00');
  assert.equal(list.formatNextAppointment(null, TODAY), null);
});

test('latest measurement and age labels use Istanbul date keys', () => {
  const latest = list.pickLatestMeasurements([
    { client_id: 'a', measured_at: '2026-09-01' },
    { client_id: 'a', measured_at: '2026-10-04' },
    { client_id: 'b', measured_at: 'nope' },
  ]);
  assert.equal(latest.get('a'), '2026-10-04');
  assert.equal(latest.has('b'), false);
  assert.equal(list.formatMeasurementAge(TODAY, TODAY), 'Bugün');
  assert.equal(list.formatMeasurementAge('2026-10-05', TODAY), 'Dün');
  assert.equal(list.formatMeasurementAge('2026-10-01', TODAY), '5 gün önce');
  assert.equal(list.formatMeasurementAge('2026-09-01', TODAY), '5 hafta önce');
  assert.equal(list.formatMeasurementAge('2026-06-01', TODAY), '4 ay önce');
  assert.equal(list.formatMeasurementAge(null, TODAY), null);
});

test('pagination clamps the page and reports the visible range', () => {
  const items = Array.from({ length: 23 }, (_, index) => index);
  assert.deepEqual(list.paginate(items, 3, 10), { page: 3, pageCount: 3, start: 21, end: 23, items: [20, 21, 22] });
  assert.equal(list.paginate(items, 9, 10).page, 3);
  assert.deepEqual(list.paginate([], 1, 10), { page: 1, pageCount: 1, start: 0, end: 0, items: [] });
});

test('profile helpers compute BMI and per-field measurement differences without inventing values', () => {
  assert.equal(profile.parseWeightLabel('68.4 kg'), 68.4);
  assert.equal(profile.parseWeightLabel('68,4'), 68.4);
  assert.equal(profile.parseWeightLabel('-'), null);
  assert.equal(profile.calculateBmi(68.4, 168), 24.2);
  assert.equal(profile.calculateBmi(68.4, undefined), null);
  const delta = profile.latestMeasurementDelta([
    { measured_at: '2026-09-08', weight: 70.1, waist: 79, hip: null },
    { measured_at: '2026-10-04', weight: 68.4, waist: 76, hip: null },
    { measured_at: '2026-09-22', weight: 69.2, waist: 77, hip: 101 },
  ], 'waist');
  assert.deepEqual(delta, { value: 76, measuredAt: '2026-10-04', diff: -1 });
  const hip = profile.latestMeasurementDelta([{ measured_at: '2026-09-22', weight: null, waist: null, hip: 101 }], 'hip');
  assert.deepEqual(hip, { value: 101, measuredAt: '2026-09-22', diff: null });
  assert.equal(profile.latestMeasurementDelta([], 'waist'), null);
  assert.equal(profile.formatSignedDecimal(-1.25), '−1,3');
  assert.equal(profile.formatSignedDecimal(0), '±0');
  assert.equal(profile.dietWeekNumber('2026-08-23', TODAY), 7);
  assert.equal(profile.dietWeekNumber(null, TODAY), null);
});

test('client list and profile stay on real data and keep the safety contracts', () => {
  const page = read('features/clients/pages/ClientsPage.tsx');
  const insights = read('features/clients/services/clientListInsightsService.ts');
  const details = read('pages/ClientDetails.tsx');
  const profileService = read('features/clients/services/clientProfileService.ts');
  const invite = read('features/clients/components/InviteCodePanel.tsx');
  const health = read('features/clients/components/profile/ClientHealthCard.tsx');
  assert.match(page, /fetchClientListInsights\(activeIds\)/);
  assert.match(page, /value: 'attention', label: 'Dikkat'/);
  assert.match(page, /inviteMode === 'invite_code' \? <InviteCodePanel/);
  assert.match(page, /label="Danışanın kayıtlı e-posta adresi"/);
  assert.match(insights, /\.eq\('dietitian_id', user\.id\)/);
  assert.match(insights, /\.eq\('status', 'upcoming'\)/);
  // The fake calorie card is gone; calorie targets come from the dietitian-owned table.
  assert.doesNotMatch(details, /Kalori Alımı/);
  assert.doesNotMatch(details, /window\.confirm|alert\(/);
  assert.match(details, /<ConfirmDialog/);
  assert.match(details, /ClientNutritionTargetCard/);
  assert.match(details, /ClientChangeRequestsCard/);
  for (const table of ['meal_plans', 'appointments', 'dietitian_notes']) {
    assert.match(profileService, new RegExp(`from\\('${table}'\\)[\\s\\S]{0,200}\\.eq\\('dietitian_id', dietitianId\\)`));
  }
  // Health facts are read-only in the web panel.
  assert.doesNotMatch(health, /<input|<Input|onChange|update\(/);
  // Rotation needs an explicit in-dialog confirmation; production mode is driven only by the env flag.
  assert.doesNotMatch(invite, /window\.confirm/);
  assert.match(invite, /Evet, kodu yenile/);
  assert.match(page, /resolveClientInviteMode\(import\.meta\.env\.VITE_CLIENT_INVITE_MODE\)/);
});
