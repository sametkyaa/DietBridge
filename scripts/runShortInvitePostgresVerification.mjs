// Focused, in-memory PostgreSQL verification. No Supabase URL, credentials or network.
// The surrounding Auth/relationship tables are minimal fixtures, not the full schema.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pgliteRoot = process.argv[2];
if (!pgliteRoot) throw new Error('Pass the directory of the separate @electric-sql/pglite verification installation.');
const { PGlite } = await import(pathToFileURL(join(pgliteRoot, 'dist/index.js')));
const { pgcrypto } = await import(pathToFileURL(join(pgliteRoot, 'dist/contrib/pgcrypto.js')));
const db = await PGlite.create({ extensions: { pgcrypto } });
const original = readFileSync(join(repo, 'supabase/migrations/20261005120859_dietitian_invite_codes.sql'), 'utf8');
const migration = readFileSync(join(repo, 'supabase/migrations/20261013121103_short_dietitian_invite_codes.sql'), 'utf8');
let checks = 0;
const pass = name => { checks++; console.log('PASS ' + name); };
const query = async (sql, args = []) => (await db.query(sql, args)).rows;
const actor = async (role, approved = true) => {
  const id = randomUUID();
  await query('insert into public.profiles values($1,$2,$3)', [id, role, 'Disposable fixture']);
  if (role === 'dietitian') await query('insert into public.dietitian_profiles values($1,$2,$3)', [id, approved ? 'approved' : 'pending', approved]);
  return id;
};
const asActor = async (id, sql, args = []) => {
  await query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
  await db.exec('set role authenticated');
  try { return await query(sql, args); } finally { await db.exec('reset role'); }
};
const rpc = async (id, name, code) => (await asActor(id, code === undefined
  ? `select to_jsonb(public.${name}()) as result`
  : `select to_jsonb(public.${name}($1)) as result`, code === undefined ? [] : [code]))[0].result;
const preview = (id, code) => rpc(id, 'preview_dietitian_invite_code', code);
const redeem = (id, code) => rpc(id, 'redeem_dietitian_invite_code', code);
try {
  await db.exec(`
    create role anon; create role authenticated;
    create schema auth; create schema private; create schema extensions;
    create extension pgcrypto with schema extensions;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
    $$;
    grant usage on schema auth to authenticated;
    create table public.profiles(id uuid primary key,role text not null,full_name text);
    create table public.dietitian_profiles(user_id uuid primary key references public.profiles,verification_status text,is_verified boolean);
    create table public.dietitian_clients(id uuid primary key default gen_random_uuid(),dietitian_id uuid references public.profiles,client_id uuid references public.profiles,status text,unique(dietitian_id,client_id));
    create unique index one_pending_or_active_dietitian_per_client on public.dietitian_clients(client_id) where status='active';
    create function public.is_current_user_dietitian() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
      select exists(select 1 from public.profiles p join public.dietitian_profiles dp on dp.user_id=p.id where p.id=auth.uid() and p.role='dietitian' and dp.is_verified and dp.verification_status='approved');
    $$;
    create function public.dietitian_effective_client_limit(uuid) returns integer language sql stable as $$ select 3; $$;
    create function public.dietitian_active_client_usage(p_id uuid) returns integer language sql stable as $$ select count(*)::integer from public.dietitian_clients where dietitian_id=p_id and status in ('pending','active'); $$;
    create function private.notify_dietitian_client_change() returns trigger language plpgsql as $$ begin return new; end; $$;
  `);
  const stop = original.indexOf('create or replace function public.leave_my_dietitian()');
  assert.ok(stop > 0);
  await db.exec(original.slice(0, stop) + '\ncommit;');
  await db.exec(`
    revoke all on function private.normalize_invite_code(text),private.generate_invite_code(),private.require_invite_actor(text),private.invite_rate_limited(uuid) from public,anon,authenticated;
    revoke all on function public.get_my_invite_code(),public.rotate_my_invite_code(),public.set_my_invite_code_open(boolean),public.preview_dietitian_invite_code(text),public.redeem_dietitian_invite_code(text) from public,anon;
    grant execute on function public.get_my_invite_code(),public.rotate_my_invite_code(),public.set_my_invite_code_open(boolean),public.preview_dietitian_invite_code(text),public.redeem_dietitian_invite_code(text) to authenticated;
  `);
  const d = await actor('dietitian'); const d2 = await actor('dietitian');
  const pendingDietitian = await actor('dietitian', false);
  const a = await actor('client'); const b = await actor('client');
  const before = await rpc(d, 'get_my_invite_code');
  await db.exec(migration);
  const first = await rpc(d, 'get_my_invite_code');
  for (const [key, value] of Object.entries(before)) assert.deepEqual(first[key], value, key);
  assert.match(first.short_code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  pass('migration adds a short alias without altering the existing code, timestamps or state');
  await db.exec(migration);
  assert.deepEqual(await rpc(d, 'get_my_invite_code'), first);
  pass('repeat migration and repeated reads preserve both codes');
  const second = await rpc(d2, 'get_my_invite_code');
  assert.match(second.short_code, /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/);
  assert.notEqual(second.short_code, first.short_code);
  pass('new rows receive a distinct short alias through the existing RPC');
  await assert.rejects(rpc(pendingDietitian, 'get_my_invite_code'));
  await assert.rejects(rpc(a, 'get_my_invite_code'));
  pass('unapproved dietitians and clients cannot manage invite codes');
  const grants = await query("select has_function_privilege('anon','public.preview_dietitian_invite_code(text)','execute') as anon_preview,has_function_privilege('anon','public.redeem_dietitian_invite_code(text)','execute') as anon_redeem,has_function_privilege('authenticated','private.generate_short_invite_code()','execute') as client_generator");
  assert.deepEqual(grants[0], {anon_preview:false,anon_redeem:false,client_generator:false});
  pass('anonymous resolution and direct private generator execution are denied');
  assert.equal((await asActor(a, 'select * from public.dietitian_invite_codes')).length, 0);
  assert.equal((await asActor(d, 'select * from public.dietitian_invite_codes')).length, 1);
  await assert.rejects(asActor(a, 'update public.dietitian_invite_codes set is_open=false'));
  pass('RLS hides every alias from clients and other dietitians and denies direct writes');
  for (const code of [first.code, first.short_code, first.short_code.toLowerCase(), first.normalized_short_code]) {
    const result = await preview(a, code);
    assert.equal(result.result, 'ready'); assert.equal(result.dietitian.id, d);
  }
  assert.equal((await query('select count(*)::integer as total from public.dietitian_clients'))[0].total, 0);
  pass('short, lowercase, ungrouped and old codes preview the same dietitian without creating a relationship');
  assert.equal(await redeem(a, first.short_code), 'connected');
  assert.equal(await redeem(a, first.code), 'already_connected');
  assert.equal(await redeem(a, second.short_code), 'has_other_dietitian');
  pass('short-code redemption shares legacy idempotence and single-dietitian protection');
  const rotated = await rpc(d, 'rotate_my_invite_code');
  assert.notEqual(rotated.code, first.code); assert.notEqual(rotated.short_code, first.short_code);
  assert.equal((await preview(b, first.code)).result, 'not_found');
  assert.equal((await preview(b, first.short_code)).result, 'not_found');
  assert.equal((await preview(b, rotated.short_code)).result, 'ready');
  assert.equal((await query('select status from public.dietitian_clients where client_id=$1',[a]))[0].status, 'active');
  pass('rotation invalidates both old codes while keeping the existing relationship');
  await asActor(d, 'select public.set_my_invite_code_open(false)');
  const paused = await actor('client');
  assert.equal((await preview(paused, rotated.short_code)).result, 'closed');
  assert.equal(await redeem(paused, rotated.code), 'closed');
  await asActor(d, 'select public.set_my_invite_code_open(true)');
  pass('pause/open applies equally to short and long codes');
  const rate = await actor('client');
  for (let i=0;i<5;i++) assert.equal(i%2 ? (await preview(rate,'INVALID')).result : await redeem(rate,'INVALID'), 'not_found');
  assert.equal((await preview(rate, rotated.short_code)).result,'rate_limited');
  assert.equal(await redeem(rate,rotated.code),'rate_limited');
  pass('short and legacy requests share the existing five-failed-attempt limit');
  const fill = await actor('client'); const final = await actor('client'); const full = await actor('client');
  assert.equal(await redeem(fill,rotated.short_code),'connected');
  assert.equal(await redeem(final,rotated.code),'connected');
  assert.equal(await redeem(full,rotated.short_code),'limit_reached');
  assert.equal((await query('select public.dietitian_active_client_usage($1) as used',[d]))[0].used,3);
  pass('short-code connection enforces the existing subscription capacity');
  const generator = (await query("select pg_get_functiondef('private.generate_short_invite_code()'::regprocedure) as definition"))[0].definition;
  const sample = await query('select private.generate_short_invite_code() as code from generate_series(1,1024)');
  assert.ok(sample.every(({code})=>/^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$/.test(code)));
  assert.equal(new Set(sample.map(({code})=>code)).size,1024);
  pass('pgcrypto generation produces correctly grouped eight-symbol codes');
  const unused = sample.find(({code})=>code!==rotated.short_code && code!==second.short_code).code;
  await db.exec('create sequence private.short_invite_collision_sequence');
  await db.exec(`create or replace function private.generate_short_invite_code() returns text language sql volatile set search_path=pg_catalog,private as $$ select case when nextval('private.short_invite_collision_sequence')=1 then '${second.short_code}' else '${unused}' end; $$;`);
  const collisionRotation = await rpc(d,'rotate_my_invite_code');
  assert.equal(collisionRotation.short_code,unused);
  assert.equal((await query('select last_value::integer from private.short_invite_collision_sequence'))[0].last_value,2);
  await db.exec(generator);
  pass('the database uniqueness constraint retries a deliberate collision during rotation');
  console.log(`SHORT_INVITE_POSTGRES_PASS checks=${checks}`);
} finally { await db.close(); }
