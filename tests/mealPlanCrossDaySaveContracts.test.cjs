const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migrationPath = path.join(
  root,
  'supabase',
  'migrations',
  '20260830141202_meal_plan_cross_day_identity_preservation.sql',
);
const migration = () => fs.readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');

test('weekly save authorizes selected-week IDs and updates placement without replacing identity', () => {
  const source = migration();
  assert.match(source, /^begin;\s*$/m);
  assert.match(source, /create or replace function public\.save_weekly_meal_plan\(\s*p_client_id uuid,\s*p_week_start date,\s*p_days jsonb\s*\)/i);
  assert.match(source, /security definer/i);
  assert.match(source, /set search_path = pg_catalog, public/i);
  assert.match(source, /auth\.uid\(\)/i);
  assert.match(source, /verification_status = 'approved'/i);
  assert.match(source, /is_verified is true/i);
  assert.match(source, /dc\.status = 'active'::public\.client_status/i);
  assert.match(source, /pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(source, /v_plan_ids uuid\[\]/i);
  assert.match(source, /existing_plan\.id = any\(v_plan_ids\)/i);
  assert.match(source, /existing_plan\.plan_date between p_week_start and p_week_start \+ 6/i);
  assert.doesNotMatch(source, /v_existing_plan_id\s*<>\s*v_plan_id/i);
  assert.match(source, /set plan_id = v_plan_id/i);
  assert.match(source, /v_final_meal_ids uuid\[\]/i);
  assert.match(source, /delete from public\.meals as m\s+using public\.meal_plans as mp/i);
  assert.match(source, /pg_catalog\.cardinality\(v_final_meal_ids\)/i);
  assert.doesNotMatch(source, /delete from public\.meals as m\s+where m\.plan_id = v_plan_id/i);
  assert.match(source, /grant execute on function public\.save_weekly_meal_plan\(uuid, date, jsonb\) to authenticated/i);
  assert.match(source, /revoke all on function public\.save_weekly_meal_plan\(uuid, date, jsonb\)\s+from public, anon, authenticated, service_role/i);
  assert.match(source, /notify pgrst, 'reload schema'/i);
});

test('existing client-owned meal state is not part of the editor update set', () => {
  const source = migration();
  const updateStart = source.indexOf('update public.meals\n        set plan_id = v_plan_id');
  const updateEnd = source.indexOf('\n        where id = v_meal_id;', updateStart);
  assert.ok(updateStart >= 0 && updateEnd > updateStart);
  const updateSet = source.slice(updateStart, updateEnd);
  assert.doesNotMatch(updateSet, /\bis_eaten\b/i);
  assert.doesNotMatch(updateSet, /\bcompleted_at\b/i);
  assert.doesNotMatch(updateSet, /\bcreated_at\b/i);
});

test('deferred push migration remains byte-for-byte unchanged', () => {
  const pushPath = path.join(root, 'supabase', 'migrations', '20260817120000_push_registry_outbox_backend.sql');
  const digest = createHash('sha256').update(fs.readFileSync(pushPath)).digest('hex');
  assert.equal(digest, '83cf92edb8ecc7eac6581ac839694f9192303add7e522416fc1cb9af6583a97b');
});
