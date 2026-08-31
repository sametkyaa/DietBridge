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
  '20260831071948_meal_plan_new_recipe_custom_snapshot_contract.sql',
);

const migration = () => fs.readFileSync(migrationPath, 'utf8').replace(/\r\n/g, '\n');

const mealUpdateSet = (source) => {
  const start = source.indexOf('update public.meals\n        set plan_id = v_plan_id');
  const end = source.indexOf('\n        where id = v_meal_id;', start);
  assert.ok(start >= 0 && end > start, 'existing-row update set must be present');
  return source.slice(start, end);
};

const mealInsert = (source) => {
  const start = source.indexOf('insert into public.meals (');
  const end = source.indexOf('\n        returning id into v_meal_id;', start);
  assert.ok(start >= 0 && end > start, 'new-row insert must be present');
  return source.slice(start, end);
};

test('snapshot_mode is optional and defaults new recipe placements to the master', () => {
  const source = migration();
  assert.match(source, /v_snapshot_mode text/i);
  assert.match(source, /v_snapshot_mode := null/i);
  assert.match(source, /snapshot_mode.*not in \('recipe_master', 'custom'\)/i);
  assert.match(source, /coalesce\(v_snapshot_mode, 'recipe_master'\) = 'custom'/i);
  assert.match(source, /v_title := v_recipe\.name/i);
  assert.match(source, /v_description := v_recipe\.description/i);
  assert.match(source, /v_calories := v_recipe\.calories/i);
  assert.match(source, /v_recipe_image_path := v_recipe\.image_path/i);
  assert.match(source, /v_photo_url := v_recipe_image_path/i);
});

test('custom mode is restricted to new recipe placements and uses canonical payload validation', () => {
  const source = migration();
  const recipeBranchStart = source.indexOf("if v_source = 'recipe' then");
  const recipeBranchEnd = source.indexOf("\n      else\n        if v_meal_id is null and v_snapshot_mode", recipeBranchStart);
  assert.ok(recipeBranchStart >= 0 && recipeBranchEnd > recipeBranchStart);
  const recipeBranch = source.slice(recipeBranchStart, recipeBranchEnd);
  assert.match(recipeBranch, /if v_meal_id is null then/i);
  assert.match(recipeBranch, /if coalesce\(v_snapshot_mode, 'recipe_master'\) = 'custom' then/i);
  assert.match(recipeBranch, /v_use_payload_snapshot := true/i);
  assert.match(source, /if v_use_payload_snapshot then\s+v_title := pg_catalog\.btrim\(v_meal ->> 'title'\)/i);
  assert.match(source, /Meal description exceeds the supported length/i);
  assert.match(source, /Meal calories must be between 0 and 100000 or null/i);
  assert.match(source, /Meal macros must contain exactly protein, carbs and fat/i);
  assert.match(source, /Meal macros must be finite, non-negative and within range/i);
  assert.match(source, /Meal photo_url must be a canonical object path or null/i);
});

test('custom recipe placement still requires authorized recipe ownership and immutable provenance', () => {
  const source = migration();
  assert.match(source, /from public\.recipes\s+where id = v_recipe_id\s+and dietitian_id = v_actor_id/i);
  assert.match(source, /Recipe is unavailable or does not belong to the current dietitian/i);
  assert.match(source, /source = 'recipe'/i);
  assert.match(source, /recipe_id\s+is distinct from v_existing_recipe_id/i);
  assert.match(source, /Recipe provenance changed; reload the weekly plan/i);
  assert.doesNotMatch(source, /\b(?:update|insert into|delete from)\s+public\.recipes\b/i);
});

test('snapshot_mode is input-only and cannot alter manual or existing-row editing paths', () => {
  const source = migration();
  const updateSet = mealUpdateSet(source);
  const insert = mealInsert(source);
  assert.doesNotMatch(updateSet, /snapshot_mode/i);
  assert.doesNotMatch(insert, /snapshot_mode/i);
  assert.match(source, /snapshot_mode is only valid for new recipe meals/i);
  assert.match(updateSet, /plan_id\s*=\s*v_plan_id/i);
  assert.doesNotMatch(updateSet, /\bsource\s*=/i);
  assert.doesNotMatch(updateSet, /\brecipe_id\s*=/i);
  assert.match(source, /Manual meals cannot include recipe_id/i);
});

test('existing snapshot, identity, security and photo contracts remain intact', () => {
  const source = migration();
  const updateSet = mealUpdateSet(source);
  assert.doesNotMatch(updateSet, /\bis_eaten\b/i);
  assert.doesNotMatch(updateSet, /\bcompleted_at\b/i);
  assert.doesNotMatch(updateSet, /\bcreated_at\b/i);
  assert.match(source, /v_seen_meal_ids uuid\[\]/i);
  assert.match(source, /v_final_meal_ids uuid\[\]/i);
  assert.match(source, /pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(source, /security definer/i);
  assert.match(source, /set search_path = pg_catalog, public/i);
  assert.match(source, /revoke all on function public\.save_weekly_meal_plan\(uuid, date, jsonb\)\s+from public, anon, authenticated, service_role/i);
  assert.match(source, /grant execute on function public\.save_weekly_meal_plan\(uuid, date, jsonb\) to authenticated/i);
  assert.match(source, /bucket_id = 'meal-photos'\s+and name = v_photo_url/i);
  assert.match(source, /v_recipe\.image_path/i);
  assert.match(source, /notify pgrst, 'reload schema'/i);
});

test('deferred push migration remains byte-for-byte unchanged', () => {
  const pushPath = path.join(root, 'supabase', 'migrations', '20260817120000_push_registry_outbox_backend.sql');
  const digest = createHash('sha256').update(fs.readFileSync(pushPath)).digest('hex');
  assert.equal(digest, '83cf92edb8ecc7eac6581ac839694f9192303add7e522416fc1cb9af6583a97b');
});
