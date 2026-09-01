'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm test`.');

const activityContract = require(path.join(buildDir, 'features', 'chat', 'utils', 'mealActivity.js'));
const migration = fs.readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', '20260814130000_meal_completion_visibility.sql'), 'utf8');

const activity = (mealId, overrides = {}) => ({
  id: activityContract.createMealActivityId(mealId),
  kind: 'meal_activity',
  relationId: '11111111-1111-4111-8111-111111111111',
  conversationId: '22222222-2222-4222-8222-222222222222',
  clientId: '33333333-3333-4333-8333-333333333333',
  dietitianId: '44444444-4444-4444-8444-444444444444',
  mealId,
  planId: '55555555-5555-4555-8555-555555555555',
  mealDate: '2026-08-14',
  mealType: 'breakfast',
  mealTitle: 'Kahvaltı tabağı',
  mealTime: '08:30',
  completedAt: '2026-08-14T05:42:00.000Z',
  createdAt: '2026-08-14T05:42:00.000Z',
  completionPhotoPath: null,
  mealPhotoPath: null,
  isHumanMessage: false,
  requiresRead: false,
  ...overrides,
});

test('one meal completion has one deterministic activity identity and no human semantics', () => {
  const mealId = '66666666-6666-4666-8666-666666666666';
  const item = activity(mealId);
  assert.equal(item.id, `meal_activity:${mealId}`);
  assert.equal(activityContract.isMealActivity(item), true);
  assert.equal(item.isHumanMessage, false);
  assert.equal(item.requiresRead, false);
});

test('photo updates replace the same activity instead of appending a second row', () => {
  const mealId = '77777777-7777-4777-8777-777777777777';
  const first = activity(mealId);
  const updated = activity(mealId, { mealPhotoPath: 'meal-plans/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444/88888888-8888-4888-8888-888888888888.jpg' });
  const merged = activityContract.mergeMealActivities([first], [updated]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, first.id);
  assert.equal(merged[0].mealPhotoPath, updated.mealPhotoPath);
});

test('completion photo wins over the meal snapshot without overwriting either provenance field', () => {
  const item = activity('88888888-8888-4888-8888-888888888888', {
    completionPhotoPath: '33333333-3333-4333-8333-333333333333/88888888-8888-4888-8888-888888888888/99999999-9999-4999-8999-999999999999.jpg',
    mealPhotoPath: 'recipes/44444444-4444-4444-8444-444444444444/image.jpg',
  });
  assert.equal(activityContract.isMealActivity(item), true);
  assert.equal(activityContract.getMealActivityPhotoPath(item), item.completionPhotoPath);
  assert.equal(item.mealPhotoPath, 'recipes/44444444-4444-4444-8444-444444444444/image.jpg');
});

test('activity ordering uses completed time and stable activity id tie-break', () => {
  const first = activity('99999999-9999-4999-8999-999999999999');
  const second = activity('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  const merged = activityContract.mergeMealActivities([second], [first]);
  assert.deepEqual(merged.map((item) => item.id), [first.id, second.id]);
});

test('completion timestamp migration changes only meal metadata and completion RPC', () => {
  assert.match(migration, /add column completed_at timestamptz/i);
  assert.match(migration, /set_my_meal_completion\(p_meal_id uuid, p_is_eaten boolean\)/i);
  assert.match(migration, /completed_at = case/i);
  assert.doesNotMatch(migration, /update\s+public\.meals\s+set\s+completed_at/i);
  assert.doesNotMatch(migration, /chat_messages/i);
  assert.doesNotMatch(migration, /notifications?/i);
});
