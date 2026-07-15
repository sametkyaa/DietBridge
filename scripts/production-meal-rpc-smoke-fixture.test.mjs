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
  assertModeAllowed,
  deleteExplicitFixtures,
  evaluateEnvironment,
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
      clientProfiles: ['33333333-3333-4333-8333-333333333333'],
      profiles: ['33333333-3333-4333-8333-333333333333'],
      users: ['33333333-3333-4333-8333-333333333333'],
    },
  };
  await deleteExplicitFixtures(admin, manifest, { verifyOwnership: async () => undefined });
  assert.deepEqual(calls, [
    { table: 'meals', column: 'id', id: manifest.ids.meals[0] },
    { table: 'meal_plans', column: 'id', id: manifest.ids.plans[0] },
    { table: 'client_profiles', column: 'user_id', id: manifest.ids.users[0] },
    { table: 'profiles', column: 'id', id: manifest.ids.users[0] },
    { table: 'auth.users', id: manifest.ids.users[0] },
  ]);
});

test('SAFETY-01: no broad delete, policy mutation, migration history mutation or SQL execution exists', () => {
  assert.equal(/\.delete\(\)\s*\.\s*(?:neq|not|or|filter|match)\s*\(/i.test(source), false);
  assert.equal(/\b(?:drop|alter)\s+policy\b/i.test(source), false);
  assert.equal(/supabase_migrations|migration\s+repair|db\s+push/i.test(source), false);
  assert.equal(/\b(?:executeSql|query|db\.rpc)\b/i.test(source), false);
});

test('GATE-01: CLI cannot complete the mobile gate or allow policy removal', () => {
  assert.ok(source.includes('mobile_own_toggle_passed: false'));
  assert.ok(source.includes('mobile_persistence_passed: false'));
  assert.ok(source.includes('mobile_foreign_access_not_exposed: false'));
  assert.equal(/mobile_(?:own_toggle_passed|persistence_passed|foreign_access_not_exposed)\s*=\s*true/.test(source), false);
  assert.equal(source.includes("console.log('POLICY_REMOVAL_ALLOWED=YES')"), false);
  assert.ok(source.includes("console.log('POLICY_REMOVAL_ALLOWED=NO')"));
});
