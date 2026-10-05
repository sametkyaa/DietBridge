'use strict';
/**
 * `meals.time` is a nullable `time` column. One legacy meal without a planned
 * time must not break meal tracking, chat meal activity or the plan editor.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required; run via `npm test`.');

const mealTime = require(path.join(buildDir, 'shared', 'utils', 'mealTime.js'));
const trackingContract = require(path.join(buildDir, 'features', 'meal-tracking', 'utils', 'mealTrackingContract.js'));
const trackingService = require(path.join(buildDir, 'features', 'meal-tracking', 'services', 'mealTrackingService.js'));
const activityService = require(path.join(buildDir, 'features', 'chat', 'services', 'mealActivityService.js'));
const activityContract = require(path.join(buildDir, 'features', 'chat', 'utils', 'mealActivity.js'));
const planService = require(path.join(buildDir, 'features', 'meal-plans', 'services', 'mealPlanService.js'));
const readModel = require(path.join(buildDir, 'features', 'meal-plans', 'services', 'mealPlanReadModel.js'));
const payload = require(path.join(buildDir, 'features', 'meal-plans', 'utils', 'mealPlanPayload.js'));
const supabaseStub = require(path.join(buildDir, 'lib', 'supabaseClient.js'));

const read = (relativePath) => fs.readFileSync(path.join(__dirname, '..', relativePath), 'utf8');

const IDS = {
  dietitian: '11111111-1111-4111-8111-111111111111',
  client: '22222222-2222-4222-8222-222222222222',
  plan: '33333333-3333-4333-8333-333333333333',
  relation: '44444444-4444-4444-8444-444444444444',
  conversation: '55555555-5555-4555-8555-555555555555',
  timedMeal: '66666666-6666-4666-8666-666666666661',
  untimedMeal: '66666666-6666-4666-8666-666666666662',
};

const rawMeal = (overrides = {}) => ({
  id: IDS.timedMeal,
  plan_id: IDS.plan,
  type: 'snack',
  title: 'Ara öğün',
  time: '10:30:00',
  sort_order: 0,
  is_eaten: false,
  completed_at: null,
  photo_url: null,
  ...overrides,
});

const planRow = (meals) => ({
  id: IDS.plan,
  client_id: IDS.client,
  dietitian_id: IDS.dietitian,
  plan_date: '2026-08-24',
  meals,
});

test('shared meal time helpers sort missing times last and label them "Saat yok"', () => {
  assert.equal(mealTime.MEAL_TIME_MISSING_LABEL, 'Saat yok');
  assert.equal(mealTime.formatOptionalMealTime(null), 'Saat yok');
  assert.equal(mealTime.formatOptionalMealTime(''), 'Saat yok');
  assert.equal(mealTime.formatOptionalMealTime('08:30'), '08:30');
  assert.deepEqual(
    [null, '19:00', '', '08:00'].sort(mealTime.compareOptionalMealTimes),
    ['08:00', '19:00', null, ''],
  );
});

test('meal tracking keeps a null-time meal visible and orders it after timed meals of the day', () => {
  const plans = trackingService.normalizeMealTrackingOverviewPlans(
    [planRow([
      rawMeal({ id: IDS.untimedMeal, time: null, sort_order: 0 }),
      rawMeal({ id: IDS.timedMeal, time: '07:15:00', sort_order: 0 }),
    ])],
    [IDS.client],
    IDS.dietitian,
  );
  const [day] = plans.get(IDS.client);
  assert.equal(day.plannedCount, 2);
  assert.deepEqual(day.meals.map((meal) => [meal.id, meal.time]), [
    [IDS.timedMeal, '07:15'],
    [IDS.untimedMeal, null],
  ]);

  const summary = trackingContract.summarizeMealTrackingOverview(
    { clientId: IDS.client, displayName: 'Danışan', avatar: '' },
    plans.get(IDS.client),
    'today',
    '2026-08-24',
  );
  assert.deepEqual(summary.mealSummary.map((entry) => entry.label), ['Ara Öğün · 07:15', 'Ara Öğün · Saat yok']);
});

test('meal tracking keeps sort_order as the primary meal order for null times', () => {
  const plans = trackingService.normalizeMealTrackingOverviewPlans(
    [planRow([
      rawMeal({ id: IDS.timedMeal, time: '07:15:00', sort_order: 1 }),
      rawMeal({ id: IDS.untimedMeal, time: null, sort_order: 0 }),
    ])],
    [IDS.client],
    IDS.dietitian,
  );
  assert.deepEqual(plans.get(IDS.client)[0].meals.map((meal) => meal.id), [IDS.untimedMeal, IDS.timedMeal]);
});

test('meal tracking still rejects a non-null time outside the column contract', () => {
  assert.throws(
    () => trackingService.normalizeMealTrackingOverviewPlans(
      [planRow([rawMeal({ time: '25:00' })])],
      [IDS.client],
      IDS.dietitian,
    ),
    (error) => error.code === 'CONTRACT',
  );
});

const installActivityStub = (plans) => {
  supabaseStub.__setUserId(IDS.dietitian);
  supabaseStub.__setFromHandler((table) => {
    const query = {
      select: () => query,
      eq: () => query,
      order: () => query,
      maybeSingle: async () => ({
        data: {
          id: IDS.relation,
          dietitian_id: IDS.dietitian,
          client_id: IDS.client,
          status: 'active',
        },
        error: null,
      }),
      then: (resolve, reject) => {
        assert.equal(table, 'meal_plans');
        return Promise.resolve({ data: plans, error: null }).then(resolve, reject);
      },
    };
    return query;
  });
};

test('chat meal activity keeps a completed null-time meal next to the other activities', async () => {
  installActivityStub([planRow([
    rawMeal({ id: IDS.untimedMeal, time: null, is_eaten: true, completed_at: '2026-08-24T07:00:00.000Z' }),
    rawMeal({ id: IDS.timedMeal, time: '10:30:00', sort_order: 1, is_eaten: true, completed_at: '2026-08-24T08:00:00.000Z' }),
  ])]);

  const activities = await activityService.fetchMealActivities({
    relationId: IDS.relation,
    conversationId: IDS.conversation,
    clientId: IDS.client,
    dietitianId: IDS.dietitian,
    currentUserId: IDS.dietitian,
  });

  assert.deepEqual(activities.map((activity) => [activity.mealId, activity.mealTime]), [
    [IDS.untimedMeal, null],
    [IDS.timedMeal, '10:30'],
  ]);
  assert.equal(activities.every(activityContract.isMealActivity), true);
  const component = read('features/chat/components/ChatMealActivity.tsx');
  assert.match(component, /formatOptionalMealTime\(activity\.mealTime\)/);
});

test('chat meal activity still rejects a malformed non-null time', async () => {
  installActivityStub([planRow([
    rawMeal({ time: 'öğlen', is_eaten: true, completed_at: '2026-08-24T07:00:00.000Z' }),
  ])]);
  await assert.rejects(
    () => activityService.fetchMealActivities({
      relationId: IDS.relation,
      conversationId: IDS.conversation,
      clientId: IDS.client,
      dietitianId: IDS.dietitian,
      currentUserId: IDS.dietitian,
    }),
    (error) => error.code === 'CONTRACT',
  );
});

test('meal plan fetch keeps a legacy null-time meal readable and sortable', async () => {
  supabaseStub.__setFromHandler(() => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      gte: () => chain,
      lte: async () => ({
        data: [{
          id: IDS.plan,
          plan_date: '2026-08-24',
          notes: null,
          meals: [{
            id: IDS.untimedMeal,
            type: 'snack',
            title: 'Saatsiz ara öğün',
            calories: null,
            description: null,
            macros: { protein: 0, carbs: 0, fat: 0 },
            photo_url: null,
            is_eaten: false,
            sort_order: 0,
            time: null,
            source: 'manual',
            recipe_id: null,
          }],
        }],
        error: null,
      }),
    };
    return chain;
  });

  const rows = await planService.fetchWeeklyMealPlan(IDS.client, IDS.dietitian, '2026-08-24', '2026-08-30');
  assert.equal(rows[0].meals[0].time, null);
  assert.equal(planService.normalizeOptionalMealTime(undefined), null);
  assert.equal(planService.normalizeOptionalMealTime('08:00:00'), '08:00');
  assert.throws(() => planService.normalizeOptionalMealTime('8:00'), (error) => error.code === 'INVALID_WEEK_PAYLOAD');

  const sorted = readModel.sortReadModelMeals([
    { id: 'b', sort_order: 1, time: null },
    { id: 'a', sort_order: 0, time: '08:00' },
  ]);
  assert.deepEqual(sorted.map((meal) => meal.id), ['a', 'b']);
});

const DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const WEEK_DATES = ['2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29', '2026-08-30'];

const buildPayload = (meals, weeklyPlan) => payload.buildWeeklyMealPlanPayload({
  days: DAYS,
  weekDates: WEEK_DATES,
  meals,
  weeklyPlan,
  mapMealTypeToDb: planService.mapMealTypeToDb,
  normalizeMealTime: planService.normalizeMealTime,
  normalizeCanonicalMealMacros: planService.normalizeCanonicalMealMacros,
  resolvePhotoUrl: () => null,
});

const plannedContent = {
  id: 'legacy-snapshot',
  mealId: IDS.untimedMeal,
  name: 'Saatsiz ara öğün',
  image: null,
  imagePreview: null,
  calories: 0,
  description: null,
  macros: { protein: 0, carbs: 0, fat: 0 },
  source: 'manual',
  recipeId: null,
  isEaten: false,
};

test('re-saving a legacy null-time meal never invents a time and returns a clear validation message', () => {
  const rows = [
    { id: 'timed', name: 'Kahvaltı', time: '08:00' },
    { id: 'legacy', name: 'Ara Öğün', time: '' },
  ];

  assert.throws(
    () => buildPayload(rows, { Pazartesi: { legacy: plannedContent } }),
    (error) => {
      assert.equal(error.code, 'MISSING_MEAL_TIME');
      assert.equal(
        planService.getMealPlanUserMessage(error),
        'Saati olmayan bir öğün satırı var. Kaydetmeden önce bu satıra SS:DD biçiminde saat girin.',
      );
      return true;
    },
  );

  const days = buildPayload(rows, { Pazartesi: { timed: { ...plannedContent, mealId: undefined } } });
  assert.deepEqual(days[0].meals.map((meal) => meal.time), ['08:00']);

  const edited = buildPayload(
    [rows[0], { ...rows[1], time: '16:00' }],
    { Pazartesi: { legacy: plannedContent } },
  );
  assert.equal(edited[0].meals[0].time, '16:00');
  assert.equal(edited[0].meals[0].id, IDS.untimedMeal);
});

test('meal plan editor loads null-time rows without throwing and labels them "Saat yok"', () => {
  const source = read('pages/MealPlans.tsx');
  const rowDetails = source.match(/const getMealRowDetails = [\s\S]*?\n};/);
  assert.ok(rowDetails);
  assert.match(rowDetails[0], /normalizeOptionalMealTime\(meal\.time, 'meal\.time'\) \?\? ''/);
  assert.doesNotMatch(rowDetails[0], /normalizeMealTime\(meal\.time/);
  assert.match(source, /placeholder="Saat yok"/);
  assert.match(source, /formatOptionalMealTime\(meal\.time\)/);
  assert.equal((source.match(/compareOptionalMealTimes\(left\.time, right\.time\)/g) ?? []).length, 2);
  assert.match(read('pages/MealTracking.tsx'), /formatOptionalMealTime\(meal\.time\)/);
});
