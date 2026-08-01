'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) {
  throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test`.');
}

const measurementContract = require(path.join(
  buildDir,
  'features/clients/utils/measurementContract.js',
));
const clientServiceSource = fs.readFileSync(
  path.join(__dirname, '..', 'features', 'clients', 'services', 'clientService.ts'),
  'utf8',
);
const clientDetailsSource = fs.readFileSync(
  path.join(__dirname, '..', 'pages', 'ClientDetails.tsx'),
  'utf8',
);
const migrationSource = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase',
    'migrations',
    '20260801090000_align_measurements_with_mobile.sql',
  ),
  'utf8',
);

const canonicalFields = [
  'waist',
  'hip',
  'right_arm',
  'left_arm',
  'chest',
  'right_calf',
  'left_calf',
  'neck',
];

const canonicalLabels = [
  ['waist', 'Bel çevresi (cm)'],
  ['hip', 'Kalça çevresi (cm)'],
  ['right_arm', 'Sağ kol çevresi (cm)'],
  ['left_arm', 'Sol kol çevresi (cm)'],
  ['chest', 'Göğüs çevresi (cm)'],
  ['right_calf', 'Sağ baldır çevresi (cm)'],
  ['left_calf', 'Sol baldır çevresi (cm)'],
  ['neck', 'Boyun çevresi (cm)'],
];

test('measurement contract: canonical side-specific fields are present in Web types, payload and UI', () => {
  for (const field of canonicalFields) {
    assert.match(clientServiceSource, new RegExp(`\\b${field}\\b`));
    assert.match(clientDetailsSource, new RegExp(`key: '${field}'`));
  }
  for (const [field, label] of canonicalLabels) {
    assert.ok(
      clientDetailsSource.includes(`key: '${field}', label: '${label}'`),
      `Missing canonical UI label for ${field}`,
    );
  }
  assert.match(clientServiceSource, /save_active_client_body_measurements_v2/);
  assert.match(clientServiceSource, /p_right_arm: input\.right_arm/);
  assert.match(clientServiceSource, /p_left_arm: input\.left_arm/);
  assert.match(clientServiceSource, /p_right_calf: input\.right_calf/);
  assert.match(clientServiceSource, /p_left_calf: input\.left_calf/);
});

test('measurement contract: right and left fields remain separate', () => {
  assert.match(clientDetailsSource, /right_arm.*Sağ kol çevresi/s);
  assert.match(clientDetailsSource, /left_arm.*Sol kol çevresi/s);
  assert.match(clientDetailsSource, /right_calf.*Sağ baldır çevresi/s);
  assert.match(clientDetailsSource, /left_calf.*Sol baldır çevresi/s);
  assert.doesNotMatch(clientServiceSource, /p_right_arm:\s*input\.left_arm/);
  assert.doesNotMatch(clientServiceSource, /p_left_arm:\s*input\.right_arm/);
  assert.doesNotMatch(clientServiceSource, /p_right_calf:\s*input\.left_calf/);
  assert.doesNotMatch(clientServiceSource, /p_left_calf:\s*input\.right_calf/);
});

test('measurement contract: empty, decimal, zero and negative values follow mobile validation', () => {
  assert.deepEqual(measurementContract.parseMeasurementInput(''), { value: null, error: null });
  assert.deepEqual(measurementContract.parseMeasurementInput('72,5'), { value: 72.5, error: null });
  assert.deepEqual(measurementContract.parseMeasurementInput('72.5'), { value: 72.5, error: null });
  assert.deepEqual(measurementContract.parseMeasurementInput('0'), { value: null, error: 'out_of_range' });
  assert.deepEqual(measurementContract.parseMeasurementInput('-1'), { value: null, error: 'invalid' });
  assert.deepEqual(measurementContract.parseMeasurementInput('500.1'), { value: null, error: 'out_of_range' });
});

test('measurement contract: legacy arm/calf values are fallback-only and never copied to both sides', () => {
  assert.match(clientDetailsSource, /label: 'Kol — eski kayıt'/);
  assert.match(clientDetailsSource, /value: measurement\.arm/);
  assert.match(clientDetailsSource, /label: 'Baldır — eski kayıt'/);
  assert.match(clientDetailsSource, /value: measurement\.calf/);
  assert.match(clientDetailsSource, /!hasSideSpecificArm/);
  assert.match(clientDetailsSource, /!hasSideSpecificCalf/);
  assert.doesNotMatch(clientServiceSource, /right_arm:\s*input\.arm/);
  assert.doesNotMatch(clientServiceSource, /left_arm:\s*input\.arm/);
  assert.doesNotMatch(clientServiceSource, /right_calf:\s*input\.calf/);
  assert.doesNotMatch(clientServiceSource, /left_calf:\s*input\.calf/);
});

test('measurement contract: migration adds nullable side-specific numeric columns and a protected RPC', () => {
  for (const column of ['right_arm', 'left_arm', 'right_calf', 'left_calf']) {
    assert.match(migrationSource, new RegExp(`add column if not exists ${column} numeric\\(5,2\\)`));
    assert.match(migrationSource, new RegExp(`\\b${column}\\b is null or \\(${column} > 0`));
  }
  assert.match(migrationSource, /save_active_client_body_measurements_v2/);
  assert.match(migrationSource, /security definer/);
  assert.match(migrationSource, /set search_path = pg_catalog, public/);
  assert.match(migrationSource, /auth\.uid\(\)/);
  assert.match(migrationSource, /dc\.status = 'active'::public\.client_status/);
  assert.match(migrationSource, /revoke all on function public\.save_active_client_body_measurements_v2[\s\S]*from public, anon/);
  assert.match(migrationSource, /grant execute on function public\.save_active_client_body_measurements_v2/);
  assert.doesNotMatch(migrationSource, /update public\.measurements[\s\S]*arm\s*=\s*right_arm/);
});

test('measurement contract: date-only values stay date-only in Web forms and queries', () => {
  assert.match(clientServiceSource, /measured_at/);
  assert.match(clientDetailsSource, /todayIsoDate/);
  assert.match(clientDetailsSource, /new Date\(`\$\{measurement\.measured_at\}T00:00:00`\)/);
  assert.doesNotMatch(clientDetailsSource, /new Date\(measurement\.measured_at\)/);
});
