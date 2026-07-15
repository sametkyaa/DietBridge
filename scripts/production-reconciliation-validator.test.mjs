import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) =>
  fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const md5 = (value) => crypto.createHash('md5').update(value).digest('hex');

const mainPath = 'supabase/reconciliation/production_pre_policy_removal_reconciliation.sql';
const preflightPath = 'supabase/verification/production_pre_policy_removal_reconciliation_preflight.sql';
const postflightPath = 'supabase/verification/production_pre_policy_removal_reconciliation_postflight.sql';
const main = read(mainPath);
const preflight = read(preflightPath);
const postflight = read(postflightPath);

function extractDollarBody(text, marker) {
  const start = text.toLowerCase().indexOf(marker.toLowerCase());
  assert.notEqual(start, -1, `Function marker not found: ${marker}`);
  const asIndex = text.toLowerCase().indexOf('as ', start);
  assert.notEqual(asIndex, -1, `AS clause not found: ${marker}`);
  const opening = /\$[a-z_]*\$/i.exec(text.slice(asIndex));
  assert.ok(opening, `Dollar quote not found: ${marker}`);
  const openingIndex = asIndex + opening.index;
  const bodyStart = openingIndex + opening[0].length;
  const bodyEnd = text.indexOf(opening[0], bodyStart);
  assert.notEqual(bodyEnd, -1, `Closing dollar quote not found: ${marker}`);
  return text.slice(bodyStart, bodyEnd);
}

test('canonical Group A/B function bodies remain byte-for-byte unchanged', () => {
  const contracts = [
    {
      migration: 'supabase/migrations/20260713010200_auth_onboarding_hardening.sql',
      migrationMarker: 'create or replace function public.handle_new_user()',
      reconciliationMarker: 'CREATE OR REPLACE FUNCTION public.handle_new_user()',
      expectedHash: '65164cc6aed446272beabf721d44bd93',
    },
    {
      migration: 'supabase/migrations/20260713010400_meal_completion_rpc.sql',
      migrationMarker: 'create function public.set_my_meal_completion',
      reconciliationMarker: 'CREATE OR REPLACE FUNCTION public.set_my_meal_completion',
      expectedHash: '29ef449f3d82fbf463bbea6370eecf0f',
    },
    {
      migration: 'supabase/migrations/20260713010100_verification_consistency.sql',
      migrationMarker: 'create function public.sync_dietitian_verification_fields()',
      reconciliationMarker: 'CREATE FUNCTION public.sync_dietitian_verification_fields()',
      expectedHash: '62139839251ae664d44b4f325a1737c3',
    },
  ];

  for (const contract of contracts) {
    const migrationBody = extractDollarBody(read(contract.migration), contract.migrationMarker);
    const reconciliationBody = extractDollarBody(main, contract.reconciliationMarker);
    assert.equal(reconciliationBody, migrationBody);
    assert.equal(md5(migrationBody), contract.expectedHash);
  }
});

test('semantic marker sets evaluate against every canonical Group A/B body', () => {
  const handleBody = extractDollarBody(
    read('supabase/migrations/20260713010200_auth_onboarding_hardening.sql'),
    'create or replace function public.handle_new_user()',
  ).toLowerCase();
  for (const marker of [
    "new.raw_user_meta_data ->> 'account_type'",
    "new.raw_user_meta_data ->> 'role'",
    "v_account_type = 'client'",
    "v_account_type = 'dietitian'",
    "errcode = '22023'",
    'insert into public.profiles',
    'insert into public.client_profiles',
    'insert into public.dietitian_profiles',
    "values (new.id, false, 'pending', null, null)",
    'on conflict (id) do nothing',
    'on conflict (user_id) do nothing',
    'return new',
  ]) {
    assert.ok(handleBody.includes(marker), `handle_new_user marker missing: ${marker}`);
  }

  const mealBody = extractDollarBody(
    read('supabase/migrations/20260713010400_meal_completion_rpc.sql'),
    'create function public.set_my_meal_completion',
  ).toLowerCase();
  for (const marker of [
    'v_user_id uuid := auth.uid()',
    'update public.meals as m',
    'set is_eaten = p_is_eaten',
    'from public.meal_plans as mp',
    'mp.id = m.plan_id',
    'mp.client_id = v_user_id',
    'v_updated_count <> 1',
    'return true',
  ]) {
    assert.ok(mealBody.includes(marker), `meal completion marker missing: ${marker}`);
  }
  assert.equal(mealBody.match(/\bset\b/g)?.length, 1);

  const syncBody = extractDollarBody(
    read('supabase/migrations/20260713010100_verification_consistency.sql'),
    'create function public.sync_dietitian_verification_fields()',
  ).toLowerCase();
  for (const marker of [
    "new.verification_status not in ('pending', 'approved', 'rejected')",
    'new.verified_at is distinct from old.verified_at',
    'new.rejection_reason is distinct from old.rejection_reason',
    "new.is_verified := (new.verification_status = 'approved')",
    'return new',
  ]) {
    assert.ok(syncBody.includes(marker), `verification sync marker missing: ${marker}`);
  }
  assert.equal(syncBody.includes('approved_at'), false);
});

test('Group C allowlist hashes use the same pg_proc source-byte model as the baseline', () => {
  const baseline = read('supabase/migrations/20260713000001_production_public_baseline.sql');
  const contracts = [
    ['function "public"."protect_profile_system_fields"', 'd23346619753f0334ad8e518a6cf7628'],
    ['function "public"."save_my_current_weight"', 'f7caf0c59ea4ea12d8b5558799564ada'],
    ['function "public"."set_profiles_updated_at"', '9b1889f56258bf9d6554213c05019c76'],
  ];

  for (const [marker, expectedHash] of contracts) {
    assert.equal(md5(extractDollarBody(baseline, marker)), expectedHash);
  }
});

test('Group A/B postconditions use semantic contracts instead of hardcoded body hashes', () => {
  const postconditions = main.slice(main.indexOf('-- Catalog postconditions.'));
  for (const brittleHash of [
    '65164cc6aed446272beabf721d44bd93',
    '29ef449f3d82fbf463bbea6370eecf0f',
    '62139839251ae664d44b4f325a1737c3',
  ]) {
    assert.equal(postconditions.includes(brittleHash), false);
  }

  for (const marker of [
    "new.raw_user_meta_data ->> ''account_type''",
    "errcode = ''22023''",
    'insert into public.client_profiles',
    'set is_eaten = p_is_eaten',
    'mp.client_id = v_user_id',
    "new.is_verified := (new.verification_status = ''approved'')",
    'body_contract_matches',
  ]) {
    assert.ok(postconditions.includes(marker), `Semantic marker missing: ${marker}`);
  }
});

test('postflight uses the same semantic body contracts as reconciliation postconditions', () => {
  for (const brittleHash of [
    '65164cc6aed446272beabf721d44bd93',
    '29ef449f3d82fbf463bbea6370eecf0f',
    '62139839251ae664d44b4f325a1737c3',
  ]) {
    assert.equal(postflight.includes(brittleHash), false);
  }

  for (const marker of [
    "new.raw_user_meta_data ->> ''account_type''",
    "errcode = ''22023''",
    'insert into public.client_profiles',
    'set is_eaten = p_is_eaten',
    'mp.client_id = v_user_id',
    "new.is_verified := (new.verification_status = ''approved'')",
    'body_contract_matches',
    'search_path_matches',
  ]) {
    assert.ok(postflight.includes(marker), `Postflight semantic marker missing: ${marker}`);
  }
});

test('all validators inspect the exact search_path array entry and reject duplicate config', () => {
  for (const [name, sql] of [
    ['main', main],
    ['preflight', preflight],
    ['postflight', postflight],
  ]) {
    assert.equal(sql.includes('array_to_string(p.proconfig'), false, `${name} still flattens proconfig`);
    assert.ok(sql.includes("'search_path=pg_catalog, public' = ANY"), `${name} lacks exact array entry check`);
    assert.ok(sql.includes("config.value LIKE 'search_path=%'"), `${name} lacks duplicate search_path check`);
    assert.ok(sql.includes('cardinality(coalesce('), `${name} allows extra function config entries`);
  }
});

test('diagnostics name every safe invariant without exposing function bodies', () => {
  const postconditions = main.slice(main.indexOf('-- Catalog postconditions.'));
  for (const invariant of [
    'signature_present',
    'security_matches',
    'result_type_matches',
    'owner_matches',
    'body_contract_matches',
    'search_path_matches',
    'authenticated_execute_matches',
    'service_role_execute_matches',
    'anon_execute_matches',
    'public_execute_matches',
  ]) {
    assert.ok(postconditions.includes(`${invariant}=%s`), `Diagnostic missing: ${invariant}`);
  }
  assert.equal(postconditions.includes('p.prosrc=%'), false);
});

test('reconciliation retains policy, history and user-data safety boundaries', () => {
  const protectedPolicies = [
    'Clients can update own meal completion',
    'Users can select own meal plans',
    'Dietitians can view own meal plans',
    'Users can select own meal rows',
    'Dietitians can update own meal rows',
  ];
  for (const policyName of protectedPolicies) {
    const escaped = policyName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.equal(new RegExp(`\\b(?:drop|alter)\\s+policy\\b[^;]*${escaped}`, 'i').test(main), false);
  }

  assert.equal(
    /\b(?:insert\s+into|update|delete\s+from|truncate)\s+(?:table\s+)?supabase_migrations\./i.test(main),
    false,
  );
  const withoutFunctionBodies = main.replace(/\$function\$[\s\S]*?\$function\$/gi, '$function$$function$');
  const withoutStringLiterals = withoutFunctionBodies.replace(/'(?:''|[^'])*'/g, "''");
  assert.equal(
    /\bupdate\s+public\.(?:profiles|client_profiles|dietitian_profiles|dietitian_clients|meal_plans|meals|appointments|chat_messages|measurements|daily_logs)\b/i.test(withoutStringLiterals),
    false,
  );
});
