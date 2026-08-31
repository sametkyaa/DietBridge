'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm run test:meal-plan-stage3b`.');

const edit = require(path.join(buildDir, 'features/meal-plans/utils/mealPlanSnapshotEdit.js'));
const move = require(path.join(buildDir, 'features/meal-plans/utils/mealPlanMove.js'));
const payload = require(path.join(buildDir, 'features/meal-plans/utils/mealPlanPayload.js'));
const planService = require(path.join(buildDir, 'features/meal-plans/services/mealPlanService.js'));
const mealPlansSource = fs.readFileSync(path.join(__dirname, '..', 'pages', 'MealPlans.tsx'), 'utf8');
const targetMigrationSource = fs.readFileSync(
  path.join(__dirname, '..', 'supabase', 'migrations', '20260831071948_meal_plan_new_recipe_custom_snapshot_contract.sql'),
  'utf8',
);

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const WEEK_DATES = ['2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07', '2026-08-08', '2026-08-09'];
const ROWS = [
  { id: 'breakfast', name: 'Kahvaltı', time: '08:00' },
  { id: 'lunch', name: 'Öğle', time: '12:30' },
  { id: 'dinner', name: 'Akşam', time: '19:00' },
];

const RECIPE_ID = '33333333-3333-4333-8333-333333333333';
const MEAL_ID = '44444444-4444-4444-8444-444444444444';

const content = (overrides = {}) => ({
  id: 'editor-snapshot',
  mealId: MEAL_ID,
  name: 'Snapshot öğünü',
  image: `recipes/22222222-2222-4222-8222-222222222222/${RECIPE_ID}/${MEAL_ID}.webp`,
  imagePreview: 'https://cdn.example.test/meal-preview.webp',
  pendingPhoto: null,
  calories: 320,
  description: 'Editor snapshot',
  macros: { protein: 18, carbs: 22, fat: 9 },
  source: 'recipe',
  recipeId: RECIPE_ID,
  isEaten: false,
  ...overrides,
});

const manualContent = (overrides = {}) => content({
  id: 'manual-snapshot',
  mealId: undefined,
  image: null,
  imagePreview: null,
  source: 'manual',
  recipeId: null,
  ...overrides,
});

const unsavedRecipeContent = (overrides = {}) => content({
  id: 'unsaved-recipe-snapshot',
  mealId: undefined,
  ...overrides,
});

const clonePlan = (entries) => entries.reduce((plan, [day, rowId, value]) => ({
  ...plan,
  [day]: { ...(plan[day] ?? {}), [rowId]: value },
}), {});

const cell = (day = 'Pazartesi', mealId = 'breakfast') => ({ day, mealId });

const buildPayload = (weeklyPlan) => payload.buildWeeklyMealPlanPayload({
  days: DAYS,
  weekDates: WEEK_DATES,
  meals: ROWS,
  weeklyPlan,
  planNotes: Object.fromEntries(DAYS.map((day) => [day, null])),
  mapMealTypeToDb: planService.mapMealTypeToDb,
  normalizeMealTime: planService.normalizeMealTime,
  normalizeCanonicalMealMacros: planService.normalizeCanonicalMealMacros,
  resolvePhotoUrl: (meal) => meal.image,
});

const draftFor = (meal, overrides = {}) => ({
  ...edit.createMealPlanSnapshotDraft(meal),
  ...overrides,
});

test('1. planned meal card opens a read-only detail dialog from its body', () => {
  assert.match(mealPlansSource, /openMealDetail\(\{ day, mealId: meal\.id \}\)/);
  assert.match(mealPlansSource, /aria-label=\{`Öğün detayını aç: \$\{cellContent\.name\}`\}/);
  assert.match(mealPlansSource, /aria-labelledby="meal-detail-dialog-title"/);
});

test('2. Enter and Space keyboard activation use the same detail handler', () => {
  assert.match(mealPlansSource, /const handlePlannedMealCardKeyDown/);
  assert.match(mealPlansSource, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(mealPlansSource, /onKeyDown=\{\(event\) => handlePlannedMealCardKeyDown/);
});

test('3. edit action is a separate button and stops card propagation', () => {
  assert.match(mealPlansSource, /event\.stopPropagation\(\);\s*openMealEdit\(\{ day, mealId: meal\.id \}\)/);
  assert.match(mealPlansSource, /aria-label=\{isCompleted \? 'Tamamlanmış öğünün içeriği değiştirilemez'/);
});

test('3b. meal card action buttons use separated flex hit areas', () => {
  const actionRegion = mealPlansSource.match(
    /<div className="absolute left-2 top-2 z-10 flex items-center gap-1">[\s\S]*?<\/div>/,
  )?.[0];
  assert.ok(actionRegion, 'meal card action region should be present');
  assert.equal((actionRegion.match(/<button/g) ?? []).length, 2);
  assert.match(actionRegion, /className=\{`flex h-8 w-8 shrink-0 items-center/);
  assert.match(actionRegion, /className="flex h-8 w-8 shrink-0 items-center/);
  assert.doesNotMatch(actionRegion, /right-9/);
  assert.match(mealPlansSource, /className="absolute -right-1\.5 -top-1\.5/);
});

test('4. existing move handle and move helper remain active', () => {
  assert.match(mealPlansSource, /draggable=\{!isCompleted\}/);
  assert.match(mealPlansSource, /onKeyDown=\{\(event\) => handleMoveHandleKeyDown/);
  assert.match(mealPlansSource, /moveMealPlanContent\(weeklyPlan, source, target\)/);
  const source = manualContent({ pendingPhoto: { name: 'pending.jpg' } });
  const result = move.moveMealPlanContent(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), cell('Çarşamba', 'lunch'));
  assert.equal(result.status, 'moved');
  assert.strictEqual(result.nextPlan.Çarşamba.lunch, source);
});

test('5. unsaved manual meal edits apply only snapshot fields', () => {
  const source = manualContent();
  const result = edit.applyMealPlanSnapshotEdit(
    clonePlan([['Pazartesi', 'breakfast', source]]),
    cell(),
    draftFor(source, { name: 'Yeni manuel öğün', calories: '410', description: 'Yeni açıklama', protein: '30', carbs: '40', fat: '12' }),
  );
  const next = result.nextPlan.Pazartesi.breakfast;
  assert.equal(result.status, 'applied');
  assert.equal(next.name, 'Yeni manuel öğün');
  assert.equal(next.calories, 410);
  assert.deepEqual(next.macros, { protein: 30, carbs: 40, fat: 12 });
  assert.equal(next.source, 'manual');
  assert.equal(next.snapshotMode, undefined);
});

test('6. persisted manual meal keeps its database identity after editing', () => {
  const source = manualContent({ mealId: MEAL_ID });
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), draftFor(source, { name: 'Kaydedilmiş manuel' }));
  const next = result.nextPlan.Pazartesi.breakfast;
  assert.equal(result.status, 'applied');
  assert.equal(next.mealId, MEAL_ID);
  assert.equal(next.source, 'manual');
});

test('7. untouched unsaved recipe payload omits snapshot_mode', () => {
  const recipe = unsavedRecipeContent();
  const meal = buildPayload(clonePlan([['Pazartesi', 'breakfast', recipe]]))[0].meals[0];
  assert.equal(meal.mealId, undefined);
  assert.equal(meal.source, 'recipe');
  assert.equal(Object.prototype.hasOwnProperty.call(meal, 'snapshot_mode'), false);
});

test('8. editing an unsaved recipe marks the plan snapshot custom', () => {
  const recipe = unsavedRecipeContent();
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', recipe]]), cell(), draftFor(recipe, { name: 'Özel tarif snapshotı' }));
  assert.equal(result.status, 'applied');
  assert.equal(result.nextPlan.Pazartesi.breakfast.snapshotMode, 'custom');
});

test('9. custom unsaved recipe payload carries edited values and custom mode', () => {
  const recipe = unsavedRecipeContent();
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', recipe]]), cell(), draftFor(recipe, {
    name: 'Özel tarif snapshotı',
    description: 'Plan özel açıklaması',
    calories: '515',
    protein: '31',
    carbs: '44',
    fat: '17',
  }));
  const meal = buildPayload(result.nextPlan)[0].meals[0];
  assert.equal(meal.title, 'Özel tarif snapshotı');
  assert.equal(meal.description, 'Plan özel açıklaması');
  assert.equal(meal.calories, 515);
  assert.deepEqual(meal.macros, { protein: 31, carbs: 44, fat: 17 });
  assert.equal(meal.snapshot_mode, 'custom');
  assert.equal(meal.recipe_id, RECIPE_ID);
});

test('10. persisted recipe edit retains meal id, recipe source and recipe id', () => {
  const recipe = content();
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', recipe]]), cell(), draftFor(recipe, { name: 'Düzenlenmiş tarif snapshotı' }));
  const next = result.nextPlan.Pazartesi.breakfast;
  assert.equal(result.status, 'applied');
  assert.equal(next.mealId, MEAL_ID);
  assert.equal(next.source, 'recipe');
  assert.equal(next.recipeId, RECIPE_ID);
});

test('11. deleted recipe snapshot remains editable without restoring recipe provenance', () => {
  const deleted = content({ recipeId: null });
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', deleted]]), cell(), draftFor(deleted, { name: 'Silinmiş tarif snapshotı' }));
  const next = result.nextPlan.Pazartesi.breakfast;
  assert.equal(result.status, 'applied');
  assert.equal(next.source, 'recipe');
  assert.equal(next.recipeId, null);
  assert.equal(next.name, 'Silinmiş tarif snapshotı');
});

test('12. completed meals are blocked with the canonical user message', () => {
  const completed = content({ isEaten: true });
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', completed]]), cell(), draftFor(completed, { name: 'Değişmemeli' }));
  assert.equal(result.status, 'blocked');
  assert.equal(result.message, 'Tamamlanmış bir öğünün içeriği değiştirilemez.');
  assert.strictEqual(result.nextPlan.Pazartesi.breakfast, completed);
  assert.match(mealPlansSource, /disabled=\{isCompleted\}/);
});

test('13. edit never changes mealId', () => {
  const source = content();
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), draftFor(source, { name: 'Başlık değişti' }));
  assert.equal(result.nextPlan.Pazartesi.breakfast.mealId, source.mealId);
});

test('14. edit never changes source', () => {
  const source = content({ source: 'recipe' });
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), draftFor(source, { name: 'Başlık değişti' }));
  assert.equal(result.nextPlan.Pazartesi.breakfast.source, 'recipe');
});

test('15. edit never changes recipeId', () => {
  const source = content({ recipeId: RECIPE_ID });
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), draftFor(source, { name: 'Başlık değişti' }));
  assert.equal(result.nextPlan.Pazartesi.breakfast.recipeId, RECIPE_ID);
});

test('16. edit never changes completion state', () => {
  const source = content({ isEaten: false });
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), draftFor(source, { name: 'Başlık değişti' }));
  assert.equal(result.nextPlan.Pazartesi.breakfast.isEaten, false);
});

test('17. cancel is state-neutral because draft creation is detached from the plan', () => {
  const source = content();
  const currentPlan = clonePlan([['Pazartesi', 'breakfast', source]]);
  const before = structuredClone(currentPlan);
  const draft = draftFor(source, { name: 'İptal edilen değişiklik' });
  assert.equal(draft.name, 'İptal edilen değişiklik');
  assert.deepEqual(currentPlan, before);
  assert.equal(source.name, 'Snapshot öğünü');
});

test('18. Apply updates local editor state and does not add a direct meal write', () => {
  assert.match(mealPlansSource, /setWeeklyPlan\(result\.nextPlan\)/);
  assert.doesNotMatch(mealPlansSource, /\.update\(['"]meals['"]\)/);
  assert.doesNotMatch(mealPlansSource, /supabase\.rpc\(['"]save_weekly_meal_plan['"]\)/);
});

test('19. stale edit sessions are rejected without changing the current plan', () => {
  const currentPlan = clonePlan([['Pazartesi', 'breakfast', content()]]);
  const result = edit.applyMealPlanSnapshotEdit(currentPlan, cell('Cuma', 'breakfast'), draftFor(content(), { name: 'Stale' }));
  assert.equal(result.status, 'stale');
  assert.equal(result.message, 'Bu öğün artık planda değil. Lütfen öğünü yeniden açın.');
  assert.strictEqual(result.nextPlan, currentPlan);
});

test('20. edit then move preserves the edited snapshot object and fields', () => {
  const source = manualContent({ pendingPhoto: { name: 'pending.webp' } });
  const edited = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), draftFor(source, { name: 'Taşınacak düzenlenmiş öğün', calories: '600' }));
  const editedContent = edited.nextPlan.Pazartesi.breakfast;
  const moved = move.moveMealPlanContent(edited.nextPlan, cell(), cell('Perşembe', 'dinner'));
  assert.strictEqual(moved.nextPlan.Perşembe.dinner, editedContent);
  assert.equal(moved.nextPlan.Perşembe.dinner.name, 'Taşınacak düzenlenmiş öğün');
  assert.equal(moved.nextPlan.Perşembe.dinner.calories, 600);
});

test('21. move then edit works at the new cell', () => {
  const source = manualContent();
  const moved = move.moveMealPlanContent(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), cell('Cuma', 'lunch'));
  const edited = edit.applyMealPlanSnapshotEdit(moved.nextPlan, cell('Cuma', 'lunch'), draftFor(source, { name: 'Yeni hücre öğünü' }));
  assert.equal(edited.status, 'applied');
  assert.equal(edited.nextPlan.Cuma.lunch.name, 'Yeni hücre öğünü');
  assert.equal(edited.nextPlan.Pazartesi?.breakfast, undefined);
});

test('22. occupied targets still swap snapshots without rebuilding identity', () => {
  const source = manualContent({ id: 'source' });
  const target = manualContent({ id: 'target', name: 'Hedef' });
  const result = move.moveMealPlanContent(clonePlan([
    ['Pazartesi', 'breakfast', source],
    ['Cuma', 'dinner', target],
  ]), cell(), cell('Cuma', 'dinner'));
  assert.equal(result.status, 'swapped');
  assert.strictEqual(result.nextPlan.Cuma.dinner, source);
  assert.strictEqual(result.nextPlan.Pazartesi.breakfast, target);
});

test('23. photo replacement keeps the new preview and pending file through Apply', () => {
  const source = manualContent({ image: 'https://images.unsplash.com/original', imagePreview: 'https://images.unsplash.com/original' });
  const pendingPhoto = { name: 'replacement.webp' };
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), draftFor(source, {
    image: null,
    imagePreview: 'blob:replacement-preview',
    pendingPhoto,
  }));
  const next = result.nextPlan.Pazartesi.breakfast;
  assert.equal(result.status, 'applied');
  assert.equal(next.image, null);
  assert.equal(next.imagePreview, 'blob:replacement-preview');
  assert.strictEqual(next.pendingPhoto, pendingPhoto);
});

test('24. photo removal clears persisted reference and local preview', () => {
  const source = manualContent({ image: 'https://images.unsplash.com/original', imagePreview: 'https://images.unsplash.com/original' });
  const result = edit.applyMealPlanSnapshotEdit(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), draftFor(source, {
    image: null,
    imagePreview: null,
    pendingPhoto: null,
  }));
  const next = result.nextPlan.Pazartesi.breakfast;
  assert.equal(result.status, 'applied');
  assert.equal(next.image, null);
  assert.equal(next.imagePreview, null);
  assert.equal(next.pendingPhoto, null);
});

test('25. recipe image isolation has no page-level Storage delete and only allows explicit replacement', () => {
  assert.doesNotMatch(mealPlansSource, /storage\.[\s\S]*\.(remove|delete)\(/);
  assert.match(mealPlansSource, /image: null,[\s\S]*pendingPhoto: file/);
  assert.doesNotMatch(targetMigrationSource, /(?:insert|update|delete)\s+from\s+public\.recipes/i);
});

test('26. pending photo survives a planned meal move', () => {
  const pendingPhoto = { name: 'pending.jpg' };
  const source = manualContent({ pendingPhoto, imagePreview: 'blob:pending-preview' });
  const result = move.moveMealPlanContent(clonePlan([['Pazartesi', 'breakfast', source]]), cell(), cell('Çarşamba', 'lunch'));
  assert.strictEqual(result.nextPlan.Çarşamba.lunch.pendingPhoto, pendingPhoto);
  assert.equal(result.nextPlan.Çarşamba.lunch.imagePreview, 'blob:pending-preview');
});

test('27. recipe master values remain isolated from the Stage 3B edit contract', () => {
  assert.match(targetMigrationSource, /select id, name, description, calories, protein, carbs, fat, image_path\s+into v_recipe\s+from public\.recipes/i);
  assert.doesNotMatch(targetMigrationSource, /(?:insert|update|delete)\s+into?\s+public\.recipes/i);
  assert.match(mealPlansSource, /createMealPlanSnapshotDraft\(content\)/);
  assert.match(mealPlansSource, /setMealEditSession\(null\)/);
});
