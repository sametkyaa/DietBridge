#!/usr/bin/env node
// Exercises real PostgreSQL RPC/trigger bodies in an isolated, networkless
// container with synthetic fixtures. No remote connection or production data.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const name = `dietbridge-weight-date-${randomUUID()}`;
const migrationPath = 'supabase/migrations/20261011103029_mobile_weight_istanbul_date.sql';
const baseline = readFileSync(join(root, 'supabase/baseline_drafts/dietbridge_production_public_baseline.sql'), 'utf8');
assertCiSafeEnvironment();
const docker = (args, input) => execFileSync('docker', args, {
  input, encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
});
const sql = (input) => docker(['exec', '-i', name, 'psql', '-X', '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], input);
const originalDefinition = (fn) => {
  const start = baseline.indexOf(`CREATE OR REPLACE FUNCTION "public"."${fn}"`);
  const end = baseline.indexOf('\n$$;', start);
  assert(start >= 0 && end > start, `Missing original definition: ${fn}`);
  return baseline.slice(start, end + 4);
};
const fixture = `
create role authenticated; create role anon;
create schema auth;
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create table public.client_profiles (user_id uuid primary key, current_weight numeric);
create table public.measurements (
  id uuid primary key default gen_random_uuid(), client_id uuid not null,
  measured_at date not null, weight numeric, waist numeric, hip numeric,
  notes text, updated_at timestamptz default now(), unique(client_id,measured_at)
);
create table public.test_write_context (zone text not null);
create function public.capture_weight_zone() returns trigger language plpgsql as $$
begin insert into public.test_write_context values (current_setting('TimeZone')); return new; end $$;
create trigger capture_weight_zone before insert on public.measurements
for each row execute function public.capture_weight_zone();
${originalDefinition('save_my_current_weight')}
${originalDefinition('sync_client_weight_to_measurements')}
alter function public.save_my_current_weight(numeric) set search_path = pg_catalog, public;
alter function public.sync_client_weight_to_measurements() set search_path = pg_catalog, public;
revoke all on function public.save_my_current_weight(numeric) from public, anon;
grant execute on function public.save_my_current_weight(numeric) to authenticated;
create trigger weight_sync after insert or update of current_weight on public.client_profiles
for each row execute function public.sync_client_weight_to_measurements();
`;
let started = false;
try {
  docker(['run', '-d', '--name', name, '--network', 'none',
    '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', 'postgres:17-alpine']);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try { docker(['exec', name, 'pg_isready', '-U', 'postgres']); ready = true; break; } catch { /* startup only */ }
    await new Promise((done) => setTimeout(done, 500));
  }
  assert(ready, 'Disposable PostgreSQL did not start.');
  sql(fixture);
  const before = sql(`select md5(prosrc),proacl::text,prosecdef from pg_proc
    where oid in ('public.save_my_current_weight(numeric)'::regprocedure,
      'public.sync_client_weight_to_measurements()'::regprocedure) order by oid;`);
  // Negative control: existing bodies write under UTC before the fix.
  sql(`set timezone='UTC'; insert into public.client_profiles values ('00000000-0000-4000-8000-000000000001',70);`);
  assert.equal(sql('select distinct zone from public.test_write_context;').trim(), 'UTC');
  const migration = readFileSync(join(root, migrationPath), 'utf8');
  sql(migration);
  sql(migration); // Re-applying changes neither schema nor data.
  const client = '00000000-0000-4000-8000-000000000001';
  sql(`set timezone='UTC';
    truncate public.test_write_context;
    insert into public.measurements(client_id,measured_at,weight,waist,hip,notes)
    values ('${client}',(now() at time zone 'Europe/Istanbul')::date,70,81,94,'preserve')
    on conflict(client_id,measured_at) do update set waist=81,hip=94,notes='preserve';
    truncate public.test_write_context;
    set request.jwt.claim.sub='${client}';
    set role authenticated;
    select public.save_my_current_weight(72);
    reset role;`);
  assert.equal(sql('select distinct zone from public.test_write_context;').trim(), 'Europe/Istanbul');
  assert.equal(sql(`select weight || '|' || waist || '|' || hip || '|' || notes
    from public.measurements where client_id='${client}'
    and measured_at=(now() at time zone 'Europe/Istanbul')::date;`).trim(), '72|81|94|preserve');
  assert.equal(sql(`select count(*) from public.measurements where client_id='${client}'
    and measured_at=(now() at time zone 'Europe/Istanbul')::date;`).trim(), '1');
  sql(`set timezone='UTC'; truncate public.test_write_context;
    update public.client_profiles set current_weight=73 where user_id='${client}';`);
  assert.equal(sql('select distinct zone from public.test_write_context;').trim(), 'Europe/Istanbul');
  for (const [instant, expected] of [
    ['2026-10-10 23:59:00+03', '2026-10-10'],
    ['2026-10-11 00:00:00+03', '2026-10-11'],
    ['2026-10-11 02:59:00+03', '2026-10-11'],
    ['2026-10-11 03:00:00+03', '2026-10-11'],
  ]) {
    // Use the timezone actually observed inside the unmodified RPC/trigger.
    assert.equal(sql(`select ('${instant}'::timestamptz at time zone zone)::date
      from public.test_write_context limit 1;`).trim(), expected);
  }
  for (const body of [
    "set request.jwt.claim.sub=''; select public.save_my_current_weight(72);",
    "set request.jwt.claim.sub='00000000-0000-4000-8000-000000000001'; select public.save_my_current_weight(19);",
    "set request.jwt.claim.sub='00000000-0000-4000-8000-000000000099'; select public.save_my_current_weight(72);",
    'set role anon; select public.save_my_current_weight(72);',
  ]) assert.throws(() => sql(body));
  assert.equal(sql("select extract(timezone from now());").trim(), '0');
  assert.equal(sql(`select md5(prosrc),proacl::text,prosecdef from pg_proc
    where oid in ('public.save_my_current_weight(numeric)'::regprocedure,
      'public.sync_client_weight_to_measurements()'::regprocedure) order by oid;`), before);
  assert.equal(sql(`select bool_and(proconfig @> array['search_path=pg_catalog, public','TimeZone=Europe/Istanbul'])
    from pg_proc where oid in ('public.save_my_current_weight(numeric)'::regprocedure,
    'public.sync_client_weight_to_measurements()'::regprocedure);`).trim(), 't');
  console.log('MOBILE_WEIGHT_DATE_RUNTIME_PASS: negative control, RPC, trigger, daily upsert, fields, midnight boundaries, auth, validation, idempotency');
} finally {
  if (started) docker(['rm', '-f', name]);
}
