'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migrationDirectory = path.join(root, 'supabase', 'migrations');
const realtimeMigrationName = '20261005120000_realtime_publication_core_tables.sql';
const weightMigrationName = '20261005120100_save_active_client_weight_canonical.sql';
const siblingMigrationName = '20260801090000_align_measurements_with_mobile.sql';
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const readMigration = (name) => fs.readFileSync(path.join(migrationDirectory, name), 'utf8');
const realtimeTables = ['meals', 'meal_plans', 'meal_change_requests', 'daily_logs', 'appointments'];

const functionBody = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, `${name} definition is present`);
  const bodyStart = source.indexOf('as $$', start);
  const end = source.indexOf('\n$$;', bodyStart);
  assert.ok(bodyStart > start && end > bodyStart, `${name} body is delimited`);
  return { header: source.slice(start, bodyStart), body: source.slice(bodyStart, end) };
};

const authorizationBlock = (body) => {
  const start = body.indexOf('  perform 1\n  from public.profiles as actor_profile');
  const end = body.indexOf('for share of actor_profile, dp, dc, client_profile;', start);
  assert.ok(start >= 0 && end > start, 'active relationship authorization block is present');
  return body.slice(start, end);
};

test('Faz 0 migrations are the forward-only canonical tail', () => {
  const files = fs.readdirSync(migrationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  assert.equal(files.at(-2), realtimeMigrationName);
  assert.equal(files.at(-1), weightMigrationName);
  for (const name of [realtimeMigrationName, weightMigrationName]) {
    const source = readMigration(name);
    assert.match(source, /^begin;\s*$/m);
    assert.match(source, /commit;\s*$/);
    assert.doesNotMatch(source, /supabase_migrations|db\s+push|storage\.objects|net\.http|vault\./i);
    assert.doesNotMatch(source, /\bdrop\s+(?:table|function|policy|publication)\b/i);
  }
});

test('Realtime publication migration is idempotent, RLS-gated and leaves replica identity alone', () => {
  const source = readMigration(realtimeMigrationName);
  for (const table of realtimeTables) {
    assert.equal(source.split(`'${table}'`).length - 1, 3, `${table} is listed in preflight, publication and postflight`);
  }
  assert.match(source, /Required publication supabase_realtime does not exist/);
  assert.match(source, /relrowsecurity is true/);
  assert.match(source, /p\.cmd in \('SELECT', 'ALL'\)/);
  assert.match(source, /p\.permissive = 'PERMISSIVE'/);
  assert.match(source, /if not exists \(\s*select 1\s*from pg_catalog\.pg_publication_tables[\s\S]*?\) then\s*execute format\(\s*'alter publication supabase_realtime add table public\.%I'/);
  assert.match(source, /Realtime publication postcondition failed for public\.%/);
  assert.doesNotMatch(source, /replica\s+identity\s+(?:full|default|nothing|using)/i);
  assert.doesNotMatch(source, /alter\s+publication\s+supabase_realtime\s+(?:drop|set)\b/i);
  for (const table of ['chat_messages', 'chat_conversations', 'chat_read_states', 'notifications', 'dietitian_clients']) {
    assert.doesNotMatch(source, new RegExp(`'${table}'`), `${table} publication membership is not touched`);
  }
});

test('save_active_client_weight keeps the Web signature and return shape', () => {
  const source = readMigration(weightMigrationName);
  const { header } = functionBody(source, 'save_active_client_weight');
  assert.match(header, /p_client_id uuid,\s*p_measured_at date,\s*p_weight numeric,\s*p_notes text default null\s*\)/);
  assert.match(header, /returns public\.measurements\s/);
  assert.match(header, /security definer/);
  assert.match(header, /set search_path = pg_catalog, public/);
  assert.match(header, /set "TimeZone" = 'Europe\/Istanbul'/);

  const clientService = read('features/clients/services/clientService.ts');
  const call = clientService.slice(
    clientService.indexOf("supabase.rpc('save_active_client_weight'"),
    clientService.indexOf('});', clientService.indexOf("supabase.rpc('save_active_client_weight'")),
  );
  for (const argument of ['p_client_id', 'p_measured_at', 'p_weight', 'p_notes']) {
    assert.match(call, new RegExp(`${argument}:`), `Web passes ${argument}`);
  }
  assert.equal((call.match(/\bp_[a-z_]+:/g) ?? []).length, 4, 'Web passes exactly four RPC arguments');
});

test('save_active_client_weight authorization matches the canonical body measurement sibling exactly', () => {
  const weight = functionBody(readMigration(weightMigrationName), 'save_active_client_weight').body;
  const sibling = functionBody(readMigration(siblingMigrationName), 'save_active_client_body_measurements_v2').body;
  assert.equal(authorizationBlock(weight), authorizationBlock(sibling));
  assert.match(weight, /Aktif danışan ilişkisi bulunamadı veya bu işlem için yetkiniz yok\.'\s*using errcode = '42501'/);
  assert.match(weight, /if v_actor_id is null then\s*raise exception 'Bu işlem için oturum açmalısınız\.'\s*using errcode = '42501'/);
});

test('save_active_client_weight uses the Europe/Istanbul date for today and future checks', () => {
  const { body } = functionBody(readMigration(weightMigrationName), 'save_active_client_weight');
  assert.match(body, /v_today date := \(pg_catalog\.now\(\) at time zone 'Europe\/Istanbul'\)::date;/);
  assert.match(body, /if p_measured_at > v_today then/);
  assert.match(body, /if p_measured_at = v_today then\s*update public\.client_profiles\s*set current_weight = p_weight/);
  assert.doesNotMatch(body, /current_date/i);
  assert.match(body, /on conflict \(client_id, measured_at\)\s*do update set\s*weight = excluded\.weight,\s*notes = coalesce\(excluded\.notes, existing\.notes\),\s*updated_at = pg_catalog\.now\(\)/);
  for (const column of ['waist', 'hip', 'right_arm', 'left_arm', 'chest', 'right_calf', 'left_calf', 'neck', 'thigh']) {
    assert.doesNotMatch(body, new RegExp(`\\b${column}\\b`), `weight RPC never writes ${column}`);
  }
});

test('save_active_client_weight grants, overload guard and postflight are explicit', () => {
  const source = readMigration(weightMigrationName);
  assert.match(source, /revoke all on function public\.save_active_client_weight\(uuid, date, numeric, text\)\s*from public, anon, authenticated;/);
  assert.match(source, /grant execute on function public\.save_active_client_weight\(uuid, date, numeric, text\)\s*to authenticated;/);
  assert.doesNotMatch(source, /grant [^;]*save_active_client_weight[^;]*to [^;]*\b(?:anon|public)\b/i);
  assert.match(source, /pg_get_function_identity_arguments\(p\.oid\)\s*<> 'p_client_id uuid, p_measured_at date, p_weight numeric, p_notes text'/);
  assert.match(source, /Unexpected save_active_client_weight overload\(s\) exist/);
  assert.match(source, /expected public\.measurements; migration stopped/);
  assert.match(source, /proconfig @> array\['search_path=pg_catalog, public', 'TimeZone=Europe\/Istanbul'\]::text\[\]/);
  assert.match(source, /notify pgrst, 'reload schema';/);
});

test('disposable replay helpers and the backend gate include the Faz 0 migrations', () => {
  for (const helper of [
    'scripts/runDisposableSupabaseLocalReplay.mjs',
    'scripts/addCurrentIsolatedMigrations.mjs',
    'scripts/runDisposableGroceryRuntimeHarness.mjs',
    'scripts/runCriticalE2E.mjs',
  ]) {
    const source = read(helper);
    assert.match(source, new RegExp(`'${realtimeMigrationName}'`), `${helper} includes realtime migration`);
    assert.match(source, new RegExp(`'${weightMigrationName}'`), `${helper} includes weight RPC migration`);
  }
  assert.match(read('scripts/runBackendQualityGate.mjs'), /'scripts\/runDisposableRealtimeWeightRuntimeHarness\.mjs'/);
  const harness = read('scripts/runDisposableRealtimeWeightRuntimeHarness.mjs');
  assert.match(harness, /addCurrentIsolatedMigrations/);
  assert.match(harness, /realtime_weight_contract\.sql/);
  assert.match(harness, /assertCiSafeEnvironment\(\{ SUPABASE_URL: local\.API_URL \}, \{ requireLoopback: true \}\)/);
  const sqlContract = read('supabase/tests/realtime_weight_contract.sql');
  assert.match(sqlContract, /^begin;$/m);
  assert.match(sqlContract, /^rollback;$/m);
  for (const label of [
    'REALTIME_FIVE_TABLES_PUBLISHED_WITH_RLS',
    'ACTIVE_DIETITIAN_SAVES_TODAY_WEIGHT',
    'ISTANBUL_TODAY_UPDATES_CURRENT_WEIGHT_AND_SINGLE_DAILY_ROW',
    'FOREIGN_DIETITIAN_REJECTED',
    'CLIENT_SELF_CALL_REJECTED',
    'ANON_REJECTED',
  ]) {
    assert.match(sqlContract, new RegExp(`\\\\echo PASS: ${label}$`, 'm'));
  }
});
