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
  '20260830185101_meal_plan_snapshot_edit_contract.sql',
);
const migration = () => fs.readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');

const existingUpdateSet = (source) => {
  const match = source.match(/update public\.meals\s+set plan_id = v_plan_id([\s\S]*?)where id = v_meal_id;/i);
  assert.ok(match, 'existing-row update set must be present');
  return match[0];
};

test('new recipe placement remains server-authoritative while existing snapshots use payload fields', () => {
  const source = migration();
  assert.match(source, /if v_source = 'recipe' then\s+if v_meal_id is null then/i);
  assert.match(source, /from public\.recipes\s+where id = v_recipe_id\s+and dietitian_id = v_actor_id/i);
  assert.match(source, /v_title := v_recipe\.name/i);
  assert.match(source, /v_photo_url := v_recipe\.image_path/i);
  assert.match(source, /else\s+if v_existing_recipe_id is null then[\s\S]*?v_use_payload_snapshot := true/i);
  assert.match(source, /if v_use_payload_snapshot then\s+v_title := pg_catalog\.btrim\(v_meal ->> 'title'\)/i);
});

test('existing source and recipe provenance are fail-closed and immutable', () => {
  const source = migration();
  assert.match(source, /select m\.source, m\.recipe_id, m\.photo_url/i);
  assert.match(source, /v_source is distinct from v_existing_source/i);
  assert.match(source, /v_recipe_id is distinct from v_existing_recipe_id/i);
  assert.match(source, /Recipe provenance changed; reload the weekly plan/i);
  const updateSet = existingUpdateSet(source);
  assert.doesNotMatch(updateSet, /\bsource\s*=/i);
  assert.doesNotMatch(updateSet, /\brecipe_id\s*=/i);
});

test('existing snapshot validation preserves canonical manual limits and photo contracts', () => {
  const source = migration();
  assert.match(source, /Meal description exceeds the supported length/i);
  assert.match(source, /Meal calories must be between 0 and 100000 or null/i);
  assert.match(source, /Meal macros must contain exactly protein, carbs and fat/i);
  assert.match(source, /bucket_id = 'meal-photos'\s+and name = v_photo_url/i);
  assert.match(source, /v_source = 'recipe'[\s\S]*?v_photo_url is not distinct from v_existing_photo_url/i);
  assert.doesNotMatch(source, /\b(?:update|insert into|delete from)\s+public\.recipes\b/i);
});

test('identity, completion metadata and canonical function security remain unchanged', () => {
  const source = migration();
  const updateSet = existingUpdateSet(source);
  assert.match(updateSet, /\bplan_id\s*=\s*v_plan_id/i);
  assert.doesNotMatch(updateSet, /\bis_eaten\b/i);
  assert.doesNotMatch(updateSet, /\bcompleted_at\b/i);
  assert.doesNotMatch(updateSet, /\bcreated_at\b/i);
  assert.match(source, /security definer/i);
  assert.match(source, /set search_path = pg_catalog, public/i);
  assert.match(source, /revoke all on function public\.save_weekly_meal_plan\(uuid, date, jsonb\)\s+from public, anon, authenticated, service_role/i);
  assert.match(source, /grant execute on function public\.save_weekly_meal_plan\(uuid, date, jsonb\) to authenticated/i);
});

test('deferred push migration remains byte-for-byte unchanged', () => {
  const pushPath = path.join(root, 'supabase', 'migrations', '20260817120000_push_registry_outbox_backend.sql');
  const digest = createHash('sha256').update(fs.readFileSync(pushPath)).digest('hex');
  assert.equal(digest, '83cf92edb8ecc7eac6581ac839694f9192303add7e522416fc1cb9af6583a97b');
});
