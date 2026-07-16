import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXIT,
  FIXTURE_TYPE,
  MANIFEST_PATH,
  PRODUCTION_ACK,
  applyMobileConfirmation,
  assertModeAllowed,
  deleteExplicitFixtures,
  evaluateEnvironment,
  evaluatePolicyGates,
  guardedNetworkAction,
  redact,
} from './production-meal-rpc-smoke-fixture.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = fs.readFileSync(path.join(root, 'scripts/production-meal-rpc-smoke-fixture.mjs'), 'utf8');
const fakePublishableKey = ['sb', 'publishable', 'example'].join('_');
const fakeAdminKey = ['sb', 'secret', 'example'].join('_');

function validSettings(overrides = {}) {
  return {
    productionUrl: 'https://production-ref.supabase.co',
    stagingUrl: 'https://staging-ref.supabase.co',
    publishableKey: fakePublishableKey,
    adminKey: fakeAdminKey,
    targetEnv: 'production',
    acknowledgment: PRODUCTION_ACK,
    ...overrides,
  };
}

function validManifest() {
  return {
    version: 2,
    fixtureType: FIXTURE_TYPE,
    runId: 'test-run',
    clients: { a: { userId: null }, b: { userId: null } },
    dietitian: { d: { userId: null } },
    ids: {
      users: [], profiles: [], clientProfiles: [], dietitianProfiles: [], dietitianClientConnections: [],
      plans: [], meals: [], mealA: null, mealB: null,
    },
    expected: {
      connectionClients: {}, connectionDietitians: {}, planOwners: {}, planDietitians: {},
      mealPlans: {}, mealTitles: {}, mealAState: false,
    },
    checks: { own: true, foreign: true, persistence: true, anonymous: true },
    mobile: {
      mobile_own_toggle_passed: false,
      mobile_persistence_passed: false,
      mobile_foreign_access_not_exposed: false,
    },
  };
}

const mobileAcks = {
  DIETBRIDGE_MOBILE_OWN_TOGGLE_ACK: 'PASS',
  DIETBRIDGE_MOBILE_PERSISTENCE_ACK: 'PASS',
  DIETBRIDGE_MOBILE_FOREIGN_NOT_EXPOSED_ACK: 'PASS',
};

test('GUARD-01: missing production acknowledgement blocks before any network action', async () => {
  let networkCalls = 0;
  const state = { ...validSettings({ acknowledgment: undefined }), ...evaluateEnvironment(validSettings({ acknowledgment: undefined })) };
  await assert.rejects(
    () => guardedNetworkAction(state, async () => { networkCalls += 1; }),
    (error) => error.exitCode === EXIT.ENVIRONMENT,
  );
  assert.equal(networkCalls, 0);
});

test('GUARD-02: staging target or publishable admin key is rejected', () => {
  assert.equal(evaluateEnvironment(validSettings({ productionUrl: 'https://staging-ref.supabase.co' })).environmentGuard, false);
  assert.equal(evaluateEnvironment(validSettings({ adminKey: fakePublishableKey })).environmentGuard, false);
  assert.equal(evaluateEnvironment(validSettings()).environmentGuard, true);
});

test('PREFLIGHT-01: preflight implementation contains no client creation or network call', () => {
  const start = source.indexOf('function preflight()');
  const end = source.indexOf('async function main()', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const body = source.slice(start, end);
  assert.equal(/createClient|createClients|\.from\(|\.rpc\(|\.auth\./.test(body), false);
  assert.equal((body.match(/console\.log\(/g) ?? []).length, 4);
  assert.ok(body.includes("console.log('network_call_executed=NO')"));
});

test('LOG-01: secrets, email, UUID and URL are redacted', () => {
  const fakeJwt = ['eyJhbGciOiJIUzI1NiJ9', 'abc', 'sig'].join('.');
  const raw = `https://production-ref.supabase.co ${fakeAdminKey} ${fakeJwt} user@example.invalid 11111111-1111-4111-8111-111111111111`;
  const output = redact(raw);
  for (const forbidden of ['production-ref', fakeAdminKey, 'eyJ', 'user@example.invalid', '11111111-1111']) {
    assert.equal(output.includes(forbidden), false);
  }
  assert.equal(/console\.log\([^\n]*(?:\.email|\.password|\.userId|\$\{MANIFEST_PATH\})/.test(source), false);
});

test('MANIFEST-01: production manifest is TEMP-only and separate from staging', () => {
  assert.equal(MANIFEST_PATH, path.join(os.tmpdir(), 'dietbridge-production-meal-rpc-smoke-manifest.json'));
  assert.equal(MANIFEST_PATH.includes('staging-mobile-meal-test-manifest'), false);
  assert.equal(MANIFEST_PATH.startsWith(root), false);
  assert.ok(source.includes(`export const FIXTURE_TYPE = '${FIXTURE_TYPE}'`));
});

test('ORDER-01: mode ordering fails closed while cleanup remains independent', () => {
  const manifest = { checks: { own: false, foreign: false, persistence: false, anonymous: false } };
  assert.throws(() => assertModeAllowed('foreign-check', manifest), (error) => error.exitCode === EXIT.ORDER);
  manifest.checks.own = true;
  assert.doesNotThrow(() => assertModeAllowed('foreign-check', manifest));
  assert.throws(() => assertModeAllowed('persistence-check', manifest), (error) => error.exitCode === EXIT.ORDER);
  assert.doesNotThrow(() => assertModeAllowed('cleanup', manifest));
});

test('CLEANUP-01: cleanup uses explicit IDs in dependency order', async () => {
  const calls = [];
  const admin = {
    from: (table) => ({
      delete: () => ({
        eq: async (column, id) => {
          calls.push({ table, column, id });
          return { error: null };
        },
      }),
    }),
    auth: { admin: { deleteUser: async (id) => { calls.push({ table: 'auth.users', id }); return { error: null }; } } },
  };
  const manifest = {
    ids: {
      meals: ['11111111-1111-4111-8111-111111111111'],
      plans: ['22222222-2222-4222-8222-222222222222'],
      dietitianClientConnections: ['44444444-4444-4444-8444-444444444444'],
      clientProfiles: ['33333333-3333-4333-8333-333333333333'],
      dietitianProfiles: ['55555555-5555-4555-8555-555555555555'],
      profiles: ['33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555'],
      users: ['33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555'],
    },
  };
  await deleteExplicitFixtures(admin, manifest, { verifyOwnership: async () => undefined });
  assert.deepEqual(calls, [
    { table: 'meals', column: 'id', id: manifest.ids.meals[0] },
    { table: 'meal_plans', column: 'id', id: manifest.ids.plans[0] },
    { table: 'dietitian_clients', column: 'id', id: manifest.ids.dietitianClientConnections[0] },
    { table: 'client_profiles', column: 'user_id', id: manifest.ids.users[0] },
    { table: 'dietitian_profiles', column: 'user_id', id: manifest.ids.users[1] },
    { table: 'profiles', column: 'id', id: manifest.ids.users[0] },
    { table: 'profiles', column: 'id', id: manifest.ids.users[1] },
    { table: 'auth.users', id: manifest.ids.users[0] },
    { table: 'auth.users', id: manifest.ids.users[1] },
  ]);
});

test('FIXTURE-01: setup creates one approved dietitian and two active client connections', () => {
  assert.ok(source.includes("await createFixtureUser(admin, manifest, manifest.dietitian.d, 'Dietitian D', 'dietitian')"));
  assert.ok(source.includes(".update({ verification_status: 'approved', verified_at: verifiedAt, rejection_reason: null })"));
  assert.equal(/\.update\([^)]*is_verified/s.test(source), false);
  assert.equal((source.match(/await createActiveConnection\(admin, manifest, '[ab]'/g) ?? []).length, 2);
  assert.ok(source.includes("status: 'active', accepted_at: acceptedAt"));
});

test('FIXTURE-02: both plans and relationships use the same disposable dietitian', () => {
  assert.ok(source.includes('const dietitianId = manifest.dietitian.d.userId;'));
  assert.ok(source.includes('.insert({ client_id: clientId, dietitian_id: dietitianId, plan_date: manifest.planDate, notes })'));
  assert.ok(source.includes('manifest.expected.connectionDietitians[connection.id] = dietitianId;'));
  assert.ok(source.includes('manifest.expected.planDietitians[plan.id] = dietitianId;'));
});

test('FIXTURE-03: foreign RPC remains client A against client B meal', () => {
  const start = source.indexOf('async function foreignCheck(settings)');
  const end = source.indexOf('async function persistenceCheck(settings)', start);
  const body = source.slice(start, end);
  assert.ok(body.includes('authenticatedClient(clients, manifest.clients.a)'));
  assert.ok(body.includes("p_meal_id: manifest.ids.mealB"));
  assert.ok(body.includes("rpc.error.code !== '42501'"));
});

test('SAFETY-01: no broad delete, policy mutation, migration history mutation or SQL execution exists', () => {
  assert.equal(/\.delete\(\)\s*\.\s*(?:neq|not|or|filter|match)\s*\(/i.test(source), false);
  assert.equal(/\b(?:drop|alter)\s+policy\b/i.test(source), false);
  assert.equal(/supabase_migrations|migration\s+repair|db\s+push/i.test(source), false);
  assert.equal(/\b(?:executeSql|query|db\.rpc)\b/i.test(source), false);
});

test('GATE-01: mobile confirmation requires all CLI checks and exact acknowledgements', () => {
  const incomplete = validManifest();
  incomplete.checks.anonymous = false;
  assert.throws(() => applyMobileConfirmation(incomplete, mobileAcks, () => undefined), (error) => error.exitCode === EXIT.ORDER);

  const missingAck = validManifest();
  const before = structuredClone(missingAck.mobile);
  assert.throws(
    () => applyMobileConfirmation(missingAck, { ...mobileAcks, DIETBRIDGE_MOBILE_PERSISTENCE_ACK: 'NO' }, () => undefined),
    (error) => error.exitCode === EXIT.SECURITY,
  );
  assert.deepEqual(missingAck.mobile, before);
});

test('GATE-02: mobile-confirm is networkless and marks all three manual results only after exact ACKs', () => {
  const manifest = validManifest();
  let writes = 0;
  applyMobileConfirmation(manifest, mobileAcks, () => { writes += 1; });
  assert.equal(writes, 1);
  assert.deepEqual(Object.values(manifest.mobile), [true, true, true]);

  const start = source.indexOf('function mobileConfirm()');
  const end = source.indexOf('async function setup(settings)', start);
  const body = source.slice(start, end);
  assert.equal(/createClient|createClients|\.from\(|\.rpc\(|\.auth\./.test(body), false);
  assert.equal((body.match(/console\.log\(/g) ?? []).length, 4);
  assert.ok(body.includes("console.log('mobile_confirmation=PASS')"));
  assert.ok(body.includes("console.log('mobile_foreign_access_not_exposed=YES')"));
  const mainStart = source.indexOf('async function main()');
  const mobileBranch = source.indexOf("if (command === 'mobile-confirm')", mainStart);
  const settingsLoad = source.indexOf('const settings = loadSettings();', mainStart);
  assert.ok(mobileBranch > mainStart && mobileBranch < settingsLoad);
});

test('GATE-03: policy removal opens only when CLI, mobile and live fixture state all pass', () => {
  const manifest = validManifest();
  assert.deepEqual(evaluatePolicyGates(manifest, true), {
    rpcSmokeTestsPassed: true,
    mobileProductionTestPassed: false,
    policyRemovalAllowed: false,
  });
  applyMobileConfirmation(manifest, mobileAcks, () => undefined);
  assert.equal(evaluatePolicyGates(manifest, false).policyRemovalAllowed, false);
  assert.equal(evaluatePolicyGates(manifest, true).policyRemovalAllowed, true);
});

test('GATE-04: CLI check implementations never mutate mobile confirmation fields', () => {
  for (const functionName of ['ownCheck', 'foreignCheck', 'persistenceCheck', 'anonymousCheck']) {
    const start = source.indexOf(`async function ${functionName}(`);
    const end = source.indexOf('\nasync function ', start + 1);
    const body = source.slice(start, end === -1 ? source.length : end);
    assert.equal(/manifest\.mobile|mobile_(?:own_toggle|persistence|foreign_access)/.test(body), false);
  }
});

test('STATUS-01: live ownership and mobile fixture state are verified before policy gating', () => {
  const start = source.indexOf('async function status(settings)');
  const end = source.indexOf('async function authenticatedClient', start);
  const body = source.slice(start, end);
  assert.ok(body.indexOf('await verifyFixtureOwnership(admin, manifest)') < body.indexOf('printGates(manifest, counts.mobileFixtureReady)'));
  for (const field of [
    'dietitian_auth_users_present_count',
    'dietitian_profiles_present_count',
    'active_connections_present_count',
    'meal_plans_with_expected_dietitian_count',
    'mobile_fixture_ready',
  ]) assert.ok(body.includes(field));
});
