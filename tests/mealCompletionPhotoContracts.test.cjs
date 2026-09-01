'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const migrationPath = path.join(
  __dirname,
  '..',
  'supabase',
  'migrations',
  '20260831190352_meal_completion_photo_contract.sql',
);
const migration = () => fs.readFileSync(migrationPath, 'utf8');

test('completion photo migration is isolated from plan and recipe provenance', () => {
  const source = migration();
  assert.match(source, /^begin;\s*$/m);
  assert.match(source, /add column completion_photo_url text/i);
  assert.match(source, /meal-completion-photos/gi);
  assert.match(source, /private JPEG contract/i);
  assert.match(source, /completion_photo_url is null or is_eaten is true/i);
  assert.match(source, /create unique index meals_completion_photo_url_unique/i);
  assert.doesNotMatch(source, /set\s+photo_url\s*=/i);
  assert.doesNotMatch(source, /set\s+recipe_id\s*=/i);
  assert.doesNotMatch(source, /(?:insert|update|delete)\s+into?\s+public\.recipes/i);
  assert.doesNotMatch(source, /(?:insert|update|delete)\s+into?\s+public\.recipe/i);
  assert.match(source, /commit;\s*$/m);
});

test('completion RPCs preserve the legacy two-argument contract without overload ambiguity', () => {
  const source = migration();
  assert.match(source, /create or replace function public\.set_my_meal_completion\(\s*p_meal_id uuid,\s*p_is_eaten boolean\s*\)/i);
  assert.match(source, /create function public\.set_my_meal_completion_with_photo\(\s*p_meal_id uuid,\s*p_is_eaten boolean,\s*p_completion_photo_url text\s*\)/i);
  assert.match(source, /return private\.set_my_meal_completion_impl\(p_meal_id, p_is_eaten, null\)/i);
  assert.match(source, /grant execute on function public\.set_my_meal_completion\(uuid, boolean\) to authenticated/i);
  assert.match(source, /grant execute on function public\.set_my_meal_completion_with_photo\(uuid, boolean, text\) to authenticated/i);
  assert.match(source, /auth\.uid\(\)/i);
  assert.match(source, /mp\.client_id = v_user_id/i);
  assert.match(source, /dc\.status = 'active'::public\.client_status/i);
  assert.match(source, /p\.role = 'client'::public\.user_role/i);
  assert.match(source, /for update of m/i);
});

test('completion Storage contract is private, bounded, JPEG-only, and linked-read-only', () => {
  const source = migration();
  assert.match(source, /'meal-completion-photos',\s*'meal-completion-photos',\s*false,\s*4194304,\s*array\['image\/jpeg'\]/i);
  assert.match(source, /create policy meal_completion_photo_objects_insert_own_canonical/i);
  assert.match(source, /split_part\(name, '\/', 1\) = \(select auth\.uid\(\)\)::text/i);
  assert.match(source, /\(select public\.current_user_role\(\)\) = 'client'::public\.user_role/i);
  assert.match(source, /from public\.meals as m[\s\S]+dc\.status = 'active'::public\.client_status/i);
  assert.match(source, /v_object_mime is distinct from 'image\/jpeg'/i);
  assert.match(source, /v_object_size not between 1 and 4194304/i);
  assert.match(source, /create policy meal_completion_photo_objects_select_referenced_actor/i);
  assert.match(source, /to authenticated/i);
  assert.match(source, /m\.completion_photo_url = storage\.objects\.name/i);
  assert.match(source, /dc\.status = 'active'::public\.client_status/i);
  assert.doesNotMatch(source, /create policy[^\n]+for (?:update|delete)/i);
  assert.match(source, /has_function_privilege\('anon', 'public\.set_my_meal_completion_with_photo/i);
});

test('orphan cleanup is completion-namespace-only and worker-restricted', () => {
  const source = migration();
  assert.match(source, /create table public\.meal_completion_photo_cleanup_queue/i);
  assert.match(source, /reason in \('failed_save', 'replaced', 'meal_undone', 'meal_deleted'\)/i);
  assert.match(source, /object_path ~ '[^']*\\\.jpg\$'/i);
  assert.match(source, /create trigger trg_queue_replaced_meal_completion_photo/i);
  assert.match(source, /after update of completion_photo_url or delete/i);
  assert.match(source, /enqueue_my_unreferenced_meal_completion_photo_cleanup/i);
  assert.match(source, /auth\.jwt\(\) ->> 'role'\) is distinct from 'service_role'/i);
  assert.match(source, /grant execute on function public\.claim_meal_completion_photo_cleanup_batch\(integer\) to service_role/i);
  assert.match(source, /grant execute on function public\.complete_meal_completion_photo_cleanup\(uuid\) to service_role/i);
  assert.doesNotMatch(source, /meal-plans\//i);
  assert.doesNotMatch(source, /recipes\//i);
});
