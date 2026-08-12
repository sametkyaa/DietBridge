'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

const inventory = read('docs/MVP10_SHARED_CONTRACT_INVENTORY.md');
const baseline = read('supabase/migrations/20260713000001_production_public_baseline.sql');
const completionRpc = read('supabase/migrations/20260713010400_meal_completion_rpc.sql');
const weeklyPlanRpc = read('supabase/migrations/20260724063211_persist_recipe_meal_snapshots.sql');
const measurementAlignment = read('supabase/migrations/20260801090000_align_measurements_with_mobile.sql');
const sharedHarness = read('scripts/runDisposableMvp10SharedContractHarness.mjs');

test('MVP-10 inventory records the canonical Web/Mobile repositories and closure flows', () => {
  for (const marker of [
    'DietBridge-Mobile-Chat-Final',
    'DietBridge-Mobile-MVP10',
    'A — meal plan roundtrip',
    'B — measurement',
    'C — daily tracking',
    'D — chat',
    'A → B isolation',
    'Europe/Istanbul',
    'Core/Plus/Scale',
    'MVP10_SHARED_CONTRACT_RUNTIME_PASS',
  ]) assert.ok(inventory.includes(marker), `inventory marker missing: ${marker}`);
});

test('MVP-10 runtime harness is loopback-only and covers A/B/C/D plus isolation', () => {
  for (const marker of [
    'FLOW_A_MEAL_PLAN_ROUNDTRIP',
    'FLOW_B_MEASUREMENT_ROUNDTRIP',
    'FLOW_C_DAILY_TRACKING_ROUNDTRIP',
    'FLOW_D_CHAT_ROUNDTRIP',
    'ACCOUNT_CACHE_TENANT_ISOLATION',
    'LOOPBACK_API_GUARD',
    'LOOPBACK_DB_GUARD',
    'MVP10_FIXTURE_ROWS_ZERO',
    'MVP10_AUTH_RESIDUE_ZERO',
  ]) assert.ok(sharedHarness.includes(marker), `runtime marker missing: ${marker}`);
  assert.match(sharedHarness, /cleanEnvironment/);
  assert.match(sharedHarness, /SUPABASE_SERVICE_ROLE_KEY: _serviceRole/);
});

test('Web and Mobile use the same meal enum and meal completion RPC', () => {
  assert.match(baseline, /CREATE TYPE "public"\."meal_type" AS ENUM \([\s\S]*'breakfast'[\s\S]*'lunch'[\s\S]*'dinner'[\s\S]*'snack'/i);
  assert.match(weeklyPlanRpc, /v_meal_type := \(v_meal ->> 'type'\)::public\.meal_type/);
  assert.match(completionRpc, /where m\.id = p_meal_id[\s\S]*mp\.client_id = v_user_id/);
  assert.match(inventory, /Same four types and fields; unknown source\/type fails closed/);
  assert.match(inventory, /completion uses `set_my_meal_completion`/);
});

test('measurement actor and range contracts are preserved across clients', () => {
  assert.match(measurementAlignment, /right_arm > 0 and right_arm <= 500/);
  assert.match(measurementAlignment, /save_active_client_body_measurements_v2/);
  assert.match(inventory, /Client-owned direct upsert is scoped to `client_id=auth\.uid\(\)`/);
  assert.match(inventory, /Mobile does not call the dietitian-only RPC/);
});

test('date, nullability, and cache-isolation safeguards are source-locked', () => {
  assert.match(inventory, /Numeric null remains null/);
  assert.match(read('features/analytics/utils/analyticsContract.ts'), /ANALYTICS_TIME_ZONE = 'Europe\/Istanbul'/);
  assert.match(inventory, /Mobile date helpers use `Europe\/Istanbul`/);
  assert.match(inventory, /binds `userId` into `MealsProvider`/);
  assert.match(inventory, /ignores stale meal-plan results from the prior generation/);
});

test('Mobile does not invent appointment or subscription UI contracts', () => {
  const mobileFeatures = fs.readdirSync(path.join(repoRoot, '..', 'DietBridge-Mobile-MVP10', 'apps/mobile/src/features'));
  assert.equal(mobileFeatures.includes('appointments'), false);
  assert.equal(mobileFeatures.includes('subscriptions'), false);
  assert.match(inventory, /no current appointment UI or service surface/i);
  assert.match(inventory, /No subscription UI\/state is exposed/i);
});
