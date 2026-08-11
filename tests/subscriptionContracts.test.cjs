'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const stub = require(path.join(buildDir, 'lib', 'supabaseClient.js'));
const service = require(path.join(
  buildDir,
  'features',
  'subscriptions',
  'services',
  'subscriptionService.js',
));

const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
const MIGRATION = read(
  'supabase/migrations/20260812090000_mvp7_subscription_plans_and_client_limits.sql',
);

// --- Service mapping contract ---------------------------------------------

test('subscription mapper normalizes an authoritative RPC row', () => {
  const overview = service.mapSubscriptionOverviewRow({
    plan_id: 'pro',
    plan_name: 'Pro',
    subscription_status: 'active',
    plan_limit: 50,
    effective_limit: 50,
    active_count: 8,
    pending_count: 2,
    used: 10,
    remaining: 40,
    limit_reached: false,
  });
  assert.equal(overview.planId, 'pro');
  assert.equal(overview.planName, 'Pro');
  assert.equal(overview.effectiveLimit, 50);
  assert.equal(overview.used, 10);
  assert.equal(overview.remaining, 40);
  assert.equal(overview.limitReached, false);
});

test('subscription mapper is fail-closed for a fabricated over-limit row', () => {
  const overview = service.mapSubscriptionOverviewRow({
    plan_id: 'free',
    plan_name: 'Ücretsiz',
    subscription_status: 'active',
    plan_limit: 10,
    effective_limit: 10,
    active_count: 10,
    pending_count: 0,
    used: 10,
    remaining: 0,
    limit_reached: true,
  });
  assert.equal(overview.remaining, 0);
  assert.equal(overview.limitReached, true);
});

test('subscription mapper clamps negatives and non-finite values', () => {
  const overview = service.mapSubscriptionOverviewRow({
    plan_id: 'free',
    plan_name: 'Ücretsiz',
    subscription_status: 'active',
    plan_limit: 10,
    effective_limit: 10,
    active_count: -5,
    pending_count: Number.NaN,
    used: null,
    remaining: -3,
    limit_reached: null,
  });
  assert.equal(overview.activeCount, 0);
  assert.equal(overview.pendingCount, 0);
  assert.equal(overview.used, 0);
  assert.equal(overview.remaining, 0);
  // derived: used(0) >= effectiveLimit(10) is false
  assert.equal(overview.limitReached, false);
});

test('fetchSubscriptionOverview fails closed on RPC error', async () => {
  stub.__setRpcHandler(async () => ({ data: null, error: { message: 'boom' } }));
  const result = await service.fetchSubscriptionOverview();
  assert.equal(result.status, 'error');
});

test('fetchSubscriptionOverview reads the first row of a table-returning RPC', async () => {
  stub.__setRpcHandler(async (name) => {
    assert.equal(name, 'get_dietitian_subscription_overview');
    return {
      data: [{
        plan_id: 'premium',
        plan_name: 'Premium',
        subscription_status: 'trialing',
        plan_limit: 200,
        effective_limit: 200,
        active_count: 1,
        pending_count: 0,
        used: 1,
        remaining: 199,
        limit_reached: false,
      }],
      error: null,
    };
  });
  const result = await service.fetchSubscriptionOverview();
  assert.equal(result.status, 'success');
  assert.equal(result.overview.planId, 'premium');
  assert.equal(result.overview.remaining, 199);
});

test('fetchSubscriptionOverview fails closed on empty payload', async () => {
  stub.__setRpcHandler(async () => ({ data: [], error: null }));
  const result = await service.fetchSubscriptionOverview();
  assert.equal(result.status, 'error');
});

// --- SQL enforcement contract ---------------------------------------------

test('migration defines the canonical plan catalog with authoritative limits', () => {
  assert.match(MIGRATION, /create table if not exists public\.subscription_plans/);
  assert.match(MIGRATION, /\('free',\s*'Ucretsiz',\s*10/);
  assert.match(MIGRATION, /\('pro',\s*'Pro',\s*50/);
  assert.match(MIGRATION, /\('premium',\s*'Premium',\s*200/);
});

test('migration enforces client capacity with a fail-closed trigger', () => {
  assert.match(MIGRATION, /create trigger trg_enforce_dietitian_client_capacity/);
  assert.match(MIGRATION, /before insert or update on public\.dietitian_clients/);
  assert.match(MIGRATION, /if v_usage >= v_limit then/);
  assert.match(MIGRATION, /Danisan limitine ulasildi/);
});

test('effective-limit helper fails closed for inactive or unknown plan state', () => {
  // Not entitled subscription status returns 0.
  assert.match(MIGRATION, /v_status not in \('active', 'trialing'\)[\s\S]*?return 0;/);
  // Unknown/inactive plan returns 0.
  assert.match(MIGRATION, /v_plan_active is distinct from true or v_limit is null[\s\S]*?return 0;/);
});

test('capacity enforcement is serialized with a per-dietitian advisory lock', () => {
  assert.match(MIGRATION, /pg_advisory_xact_lock\(\s*pg_catalog\.hashtext\('dietitian_client_capacity:'/);
});

test('RPC returns a friendly limit_reached signal before inserting', () => {
  assert.match(MIGRATION, /return 'limit_reached';/);
  assert.match(MIGRATION, /request_client_connection_by_email/);
});

test('subscription tables are fail-closed for anon and browser writes', () => {
  assert.match(MIGRATION, /revoke all on table public\.dietitian_subscriptions from public, anon;/);
  assert.match(MIGRATION, /grant select on table public\.dietitian_subscriptions to authenticated;/);
  // No authenticated INSERT/UPDATE/DELETE grant on subscriptions.
  assert.doesNotMatch(
    MIGRATION,
    /grant (insert|update|delete)[\s\S]*?on table public\.dietitian_subscriptions to authenticated/i,
  );
});

test('overview RPC is restricted to authenticated dietitians only', () => {
  assert.match(MIGRATION, /revoke all on function public\.get_dietitian_subscription_overview\(\) from public, anon;/);
  assert.match(MIGRATION, /grant execute on function public\.get_dietitian_subscription_overview\(\) to authenticated;/);
  assert.match(MIGRATION, /if v_dietitian_id is null or not public\.is_current_user_dietitian\(\) then/);
});

test('client service surfaces the limit_reached status to the UI', () => {
  const clientService = read('features/clients/services/clientService.ts');
  assert.match(clientService, /'limit_reached'/);
  const clientsPage = read('features/clients/pages/ClientsPage.tsx');
  assert.match(clientsPage, /case 'limit_reached':/);
});

test('mock billing UI has been replaced by the real subscription panel', () => {
  const settings = read('features/settings/pages/SettingsPage.tsx');
  assert.match(settings, /<SubscriptionPanel \/>/);
  assert.doesNotMatch(settings, /Pro Plan/);
  assert.doesNotMatch(settings, /4242/);
});
