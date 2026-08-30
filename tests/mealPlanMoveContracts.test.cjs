'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test` or `npm run test:core`.');

const move = require(path.join(buildDir, 'features/meal-plans/utils/mealPlanMove.js'));
const payload = require(path.join(buildDir, 'features/meal-plans/utils/mealPlanPayload.js'));
const planService = require(path.join(buildDir, 'features/meal-plans/services/mealPlanService.js'));
const supabaseStub = require(path.join(buildDir, 'lib/supabaseClient.js'));
const mealPlansSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'MealPlans.tsx'), 'utf8');

supabaseStub.__setUserId('22222222-2222-4222-8222-222222222222');

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const WEEK_DATES = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
const ROWS = [
  { id: 'breakfast', name: 'Kahvaltı', time: '08:00' },
  { id: 'lunch', name: 'Öğle', time: '12:30' },
  { id: 'dinner', name: 'Akşam', time: '19:00' },
];

const content = (overrides = {}) => ({
  id: 'editor-snapshot',
  mealId: '99999999-9999-4999-8999-999999999999',
  name: 'Snapshot öğünü',
  image: 'recipes/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444.webp',
  imagePreview: 'blob:editor-preview',
  pendingPhoto: { name: 'pending.webp' },
  calories: 320,
  description: 'Editor snapshot',
  macros: { protein: 18, carbs: 22, fat: 9 },
  source: 'recipe',
  recipeId: '33333333-3333-4333-8333-333333333333',
  isEaten: false,
  ...overrides,
});

const clonePlan = (entries) => entries.reduce((plan, [day, rowId, value]) => ({
  ...plan,
  [day]: { ...(plan[day] ?? {}), [rowId]: value },
}), {});

const buildPayload = (weeklyPlan, overrides = {}) => payload.buildWeeklyMealPlanPayload({
  days: DAYS,
  weekDates: WEEK_DATES,
  meals: ROWS,
  weeklyPlan,
  planNotes: Object.fromEntries(DAYS.map((day) => [day, null])),
  mapMealTypeToDb: planService.mapMealTypeToDb,
  normalizeMealTime: planService.normalizeMealTime,
  normalizeCanonicalMealMacros: planService.normalizeCanonicalMealMacros,
  resolvePhotoUrl: () => null,
  ...overrides,
});

test('empty target moves the exact manual snapshot and preserves unrelated references', () => {
  const manual = content({
    id: 'manual-snapshot',
    mealId: undefined,
    source: 'manual',
    recipeId: null,
    pendingPhoto: { name: 'manual.jpg' },
  });
  const unrelated = content({ id: 'unrelated' });
  const currentPlan = clonePlan([
    ['Cuma', 'breakfast', manual],
    ['Pazar', 'dinner', unrelated],
  ]);
  const result = move.moveMealPlanContent(
    currentPlan,
    { day: 'Cuma', mealId: 'breakfast' },
    { day: 'Çarşamba', mealId: 'lunch' },
  );

  assert.equal(result.status, 'moved');
  assert.equal(result.nextPlan.Cuma.breakfast, undefined);
  assert.strictEqual(result.nextPlan.Çarşamba.lunch, manual);
  assert.strictEqual(result.nextPlan.Pazar, currentPlan.Pazar);
  assert.notStrictEqual(result.nextPlan.Cuma, currentPlan.Cuma);
  assert.equal(manual.pendingPhoto.name, 'manual.jpg');
  assert.equal(manual.imagePreview, 'blob:editor-preview');
});

test('occupied uncompleted target swaps both snapshots without regenerating identity', () => {
  const source = content({ id: 'source', mealId: '11111111-1111-4111-8111-111111111111' });
  const target = content({ id: 'target', mealId: '22222222-2222-4222-8222-222222222222', name: 'Target' });
  const currentPlan = clonePlan([
    ['Pazartesi', 'breakfast', source],
    ['Cuma', 'dinner', target],
  ]);
  const result = move.moveMealPlanContent(
    currentPlan,
    { day: 'Pazartesi', mealId: 'breakfast' },
    { day: 'Cuma', mealId: 'dinner' },
  );

  assert.equal(result.status, 'swapped');
  assert.strictEqual(result.nextPlan.Pazartesi.breakfast, target);
  assert.strictEqual(result.nextPlan.Cuma.dinner, source);
  assert.equal(result.nextPlan.Pazartesi.breakfast.mealId, '22222222-2222-4222-8222-222222222222');
  assert.equal(result.nextPlan.Cuma.dinner.mealId, '11111111-1111-4111-8111-111111111111');
  assert.strictEqual(currentPlan.Pazartesi.breakfast, source);
  assert.strictEqual(currentPlan.Cuma.dinner, target);
});

test('same cell and missing source are safe no-ops', () => {
  const currentPlan = clonePlan([['Pazartesi', 'breakfast', content()]]);
  const sameCell = move.moveMealPlanContent(
    currentPlan,
    { day: 'Pazartesi', mealId: 'breakfast' },
    { day: 'Pazartesi', mealId: 'breakfast' },
  );
  const missing = move.moveMealPlanContent(
    currentPlan,
    { day: 'Cuma', mealId: 'breakfast' },
    { day: 'Çarşamba', mealId: 'lunch' },
  );

  assert.equal(sameCell.status, 'noop');
  assert.strictEqual(sameCell.nextPlan, currentPlan);
  assert.equal(missing.status, 'noop');
  assert.equal(missing.reason, 'SOURCE_NOT_FOUND');
  assert.strictEqual(missing.nextPlan, currentPlan);
});

test('completed source and completed target are blocked without changing state', () => {
  const completedSource = content({ isEaten: true });
  const uncompletedSource = content({ id: 'source', isEaten: false });
  const completedTarget = content({ id: 'completed-target', isEaten: true });
  const sourcePlan = clonePlan([['Pazartesi', 'breakfast', completedSource]]);
  const sourceResult = move.moveMealPlanContent(
    sourcePlan,
    { day: 'Pazartesi', mealId: 'breakfast' },
    { day: 'Çarşamba', mealId: 'lunch' },
  );
  const targetPlan = clonePlan([
    ['Pazartesi', 'breakfast', uncompletedSource],
    ['Çarşamba', 'lunch', completedTarget],
  ]);
  const targetResult = move.moveMealPlanContent(
    targetPlan,
    { day: 'Pazartesi', mealId: 'breakfast' },
    { day: 'Çarşamba', mealId: 'lunch' },
  );

  assert.equal(sourceResult.status, 'blocked');
  assert.equal(sourceResult.reason, 'SOURCE_COMPLETED');
  assert.strictEqual(sourceResult.nextPlan, sourcePlan);
  assert.equal(targetResult.status, 'blocked');
  assert.equal(targetResult.reason, 'TARGET_COMPLETED');
  assert.strictEqual(targetResult.nextPlan, targetPlan);
  assert.equal(targetPlan.Çarşamba.lunch.isEaten, true);
});

test('recipe, deleted-recipe, unsaved and pending-photo snapshots move as-is', () => {
  const recipe = content({ source: 'recipe', recipeId: '33333333-3333-4333-8333-333333333333' });
  const deletedRecipe = content({ source: 'recipe', recipeId: null, name: 'Deleted recipe snapshot' });
  const unsaved = content({ mealId: undefined, name: 'Unsaved', pendingPhoto: { name: 'photo.jpg' } });
  const currentPlan = clonePlan([
    ['Pazartesi', 'breakfast', recipe],
    ['Salı', 'lunch', deletedRecipe],
    ['Çarşamba', 'dinner', unsaved],
  ]);
  const recipeMove = move.moveMealPlanContent(currentPlan, { day: 'Pazartesi', mealId: 'breakfast' }, { day: 'Perşembe', mealId: 'lunch' });
  const deletedMove = move.moveMealPlanContent(recipeMove.nextPlan, { day: 'Salı', mealId: 'lunch' }, { day: 'Perşembe', mealId: 'dinner' });
  const unsavedMove = move.moveMealPlanContent(deletedMove.nextPlan, { day: 'Çarşamba', mealId: 'dinner' }, { day: 'Cuma', mealId: 'breakfast' });

  assert.strictEqual(unsavedMove.nextPlan.Perşembe.lunch, recipe);
  assert.equal(unsavedMove.nextPlan.Perşembe.lunch.source, 'recipe');
  assert.strictEqual(unsavedMove.nextPlan.Perşembe.dinner, deletedRecipe);
  assert.equal(unsavedMove.nextPlan.Perşembe.dinner.recipeId, null);
  assert.strictEqual(unsavedMove.nextPlan.Cuma.breakfast, unsaved);
  assert.equal(unsavedMove.nextPlan.Cuma.breakfast.mealId, undefined);
  assert.strictEqual(unsavedMove.nextPlan.Cuma.breakfast.pendingPhoto, unsaved.pendingPhoto);
});

test('payload derives target date, type, time and sort_order while retaining the moved UUID', async () => {
  const persisted = content({
    mealId: '55555555-5555-4555-8555-555555555555',
    source: 'manual',
    recipeId: null,
  });
  const currentPlan = clonePlan([['Cuma', 'breakfast', persisted]]);
  const moved = move.moveMealPlanContent(
    currentPlan,
    { day: 'Cuma', mealId: 'breakfast' },
    { day: 'Çarşamba', mealId: 'lunch' },
  );
  const days = buildPayload(moved.nextPlan);
  const targetMeal = days[2].meals[0];

  assert.equal(days[2].plan_date, '2026-08-05');
  assert.equal(days[2].meals.length, 1);
  assert.equal(days[4].meals.length, 0);
  assert.equal(targetMeal.id, '55555555-5555-4555-8555-555555555555');
  assert.equal(targetMeal.type, 'lunch');
  assert.equal(targetMeal.time, '12:30');
  assert.equal(targetMeal.sort_order, 1);

  const calls = [];
  supabaseStub.__setRpcHandler(async (name, args) => {
    calls.push({ name, args });
    return {
      data: {
        client_id: '11111111-1111-4111-8111-111111111111',
        dietitian_id: '22222222-2222-4222-8222-222222222222',
        week_start: '2026-08-03',
        week_end: '2026-08-09',
        plans: WEEK_DATES.map((date, index) => ({
          id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index + 1}`,
          plan_date: date,
          notes: null,
          meals: index === 2 ? [{
            id: targetMeal.id,
            plan_id: `aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa${index + 1}`,
            type: targetMeal.type,
            title: targetMeal.title,
            calories: targetMeal.calories,
            description: targetMeal.description,
            macros: targetMeal.macros,
            photo_url: null,
            is_eaten: false,
            sort_order: targetMeal.sort_order,
            time: targetMeal.time,
            source: targetMeal.source,
            recipe_id: targetMeal.recipe_id,
          }] : [],
        })),
      },
      error: null,
    };
  });
  await planService.saveWeeklyMealPlan(
    '11111111-1111-4111-8111-111111111111',
    '2026-08-03',
    days,
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.p_days[2].meals[0].id, targetMeal.id);
  assert.equal(calls[0].args.p_days[2].meals[0].type, 'lunch');
  assert.equal(calls[0].args.p_days[2].meals[0].time, '12:30');
  assert.equal(calls[0].args.p_days[2].meals[0].sort_order, 1);
  assert.equal(calls[0].args.p_days[4].meals.length, 0);
});

test('drag sources keep recipe COPY separate from planned-meal MOVE', () => {
  assert.equal(move.RECIPE_DRAG_DATA_TYPE, 'application/x-dietbridge-recipe-id');
  assert.equal(move.PLANNED_MEAL_DRAG_DATA_TYPE, 'application/x-dietbridge-planned-meal');
  assert.notEqual(move.RECIPE_DRAG_DATA_TYPE, move.PLANNED_MEAL_DRAG_DATA_TYPE);
  assert.deepEqual(
    move.parsePlannedMealDragSource(move.serializePlannedMealDragSource({ day: 'Cuma', mealId: 'lunch' })),
    { day: 'Cuma', mealId: 'lunch' },
  );
  assert.equal(move.parsePlannedMealDragSource('recipe-id'), null);
  assert.match(mealPlansSource, /setData\(RECIPE_DRAG_DATA_TYPE, recipeId\)/);
  assert.match(mealPlansSource, /setData\(PLANNED_MEAL_DRAG_DATA_TYPE, serializePlannedMealDragSource\(source\)\)/);
  assert.match(mealPlansSource, /if \(hasPlannedMealPayload \|\| plannedMealPayload\) \{/);
  assert.match(mealPlansSource, /const recipeId = event\.dataTransfer\.getData\(RECIPE_DRAG_DATA_TYPE\) \|\| event\.dataTransfer\.getData\('text\/plain'\)/);
  assert.match(mealPlansSource, /draggable=\{!isCompleted\}/);
  assert.match(mealPlansSource, /onKeyDown=\{\(event\) => handleMoveHandleKeyDown/);
  assert.match(mealPlansSource, /role="dialog"/);
  assert.match(mealPlansSource, /moveMealPlanContent\(weeklyPlan, source, target\)/);
});
