#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';
import { addCurrentIsolatedMigrations } from './addCurrentIsolatedMigrations.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-MealPlan-CrossDay-4m!';
const NEW_MIGRATION = '20260830141202_meal_plan_cross_day_identity_preservation.sql';
const projectId = 'dietbridge-meal-plan-' + process.pid + '-' + randomUUID().slice(0, 8);
const npxCli = process.env.npm_execpath
  ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');

const actorIds = [];
const actorLabels = new Map();
const relationshipIds = [];
const subscriptionDietitianIds = [];
const planIds = [];
const mealIds = [];
const recipeIds = [];
let disposable;
let local;
let admin;
let stackStartAttempted = false;
let mainError;

const pass = (label, detail = '') => process.stdout.write('PASS: ' + label + (detail ? ' ' + detail : '') + '\n');
const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(label + (detail ? ': ' + detail : ''));
  pass(label, detail);
};
const redact = (value) => String(value)
  .replace(/\b(sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)\b/g, '[redacted]')
  .replace(/\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/g, '[redacted]');
const assertNoError = (result, label) => {
  if (!result || result.error) {
    throw new Error(label + ': ' + redact(result?.error?.message ?? 'missing result'));
  }
  return result.data;
};

const cleanEnvironment = (environment) => Object.fromEntries(
  Object.entries(environment).filter(([key]) => !(
    /^(?:SUPABASE|VITE_SUPABASE|EXPO_PUBLIC_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)
  )),
);

const runCli = (tempRoot, args) => {
  try {
    return execFileSync(process.execPath, [
      npxCli,
      '--yes',
      'supabase@' + SUPABASE_VERSION,
      '--workdir',
      tempRoot,
      ...args,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...cleanEnvironment(process.env), TZ: 'Europe/Istanbul' },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
  } catch (error) {
    throw new Error(
      'Supabase ' + args.join(' ') + ' failed: ' + redact(error.message) + '\n'
      + redact(String(error.stdout ?? '').slice(-6000)) + '\n'
      + redact(String(error.stderr ?? '').slice(-6000)),
    );
  }
};

const parseStatus = (value) => Object.fromEntries(
  value
    .split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

const isPortFree = (port) => new Promise((resolvePromise) => {
  const server = createServer();
  server.once('error', () => resolvePromise(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)));
});

const choosePortBase = async () => {
  const first = 56000 + (process.pid % 500);
  for (let offset = 0; offset < 5000; offset += 20) {
    const base = first + offset;
    const ports = [base, base + 1, base + 2, base + 3, base + 4, base + 7, base + 9, base + 83];
    if ((await Promise.all(ports.map(isPortFree))).every(Boolean)) return base;
  }
  throw new Error('No disposable loopback port range is available.');
};

const configureProject = async (configPath) => {
  const base = await choosePortBase();
  const config = readFileSync(configPath, 'utf8')
    .replace(/^project_id\s*=\s*"[^"]+"$/m, 'project_id = "' + projectId + '"')
    .replace(/^port\s*=\s*54321$/m, 'port = ' + base)
    .replace(/^port\s*=\s*54322$/m, 'port = ' + (base + 1))
    .replace(/^shadow_port\s*=\s*54320$/m, 'shadow_port = ' + (base + 2))
    .replace(/^port\s*=\s*54329$/m, 'port = ' + (base + 9))
    .replace(/^port\s*=\s*54323$/m, 'port = ' + (base + 3))
    .replace(/^port\s*=\s*54324$/m, 'port = ' + (base + 4))
    .replace(/^port\s*=\s*54327$/m, 'port = ' + (base + 7))
    .replace(/^inspector_port\s*=\s*8083$/m, 'inspector_port = ' + (base + 83));
  writeFileSync(configPath, config, 'utf8');
};

const createAnonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActorClient = async (actor) => {
  const session = assertNoError(
    await createAnonymousClient().auth.signInWithPassword({ email: actor.email, password: PASSWORD }),
    actor.label + ' sign-in',
  );
  assert(session?.session?.access_token, actor.label.toUpperCase() + '_ACCESS_TOKEN_PRESENT');
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + session.session.access_token } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const createActor = async (label, role) => {
  const email = 'meal-plan-cross-day-' + label + '-' + randomUUID() + '@example.invalid';
  const created = assertNoError(await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: 'Disposable ' + label,
      meal_plan_cross_day_harness: 'disposable-only',
    },
  }), label + ' Auth fixture');
  const actor = { id: created.user.id, email, label, role };
  actorIds.push(actor.id);
  actorLabels.set(actor.id, label);
  assert(actor.id, label.toUpperCase() + '_AUTH_CREATED');
  return actor;
};

const approveDietitian = async (actor) => {
  const row = assertNoError(await admin
    .from('dietitian_profiles')
    .update({
      verification_status: 'approved',
      is_verified: true,
      verified_at: '2026-08-30T08:00:00.000Z',
    })
    .eq('user_id', actor.id)
    .select('user_id,verification_status,is_verified')
    .single(), actor.label + ' approval');
  assert(row.verification_status === 'approved' && row.is_verified === true, actor.label.toUpperCase() + '_APPROVED');
};

const bootstrapCore = async (actor) => {
  const row = assertNoError(await admin
    .from('dietitian_subscriptions')
    .upsert({
      dietitian_id: actor.id,
      plan_id: 'core',
      status: 'active',
      client_limit_override: null,
    })
    .select('dietitian_id,plan_id,status')
    .single(), actor.label + ' subscription bootstrap');
  subscriptionDietitianIds.push(row.dietitian_id);
  assert(row.plan_id === 'core' && row.status === 'active', actor.label.toUpperCase() + '_CORE_SUBSCRIPTION');
};

const createActiveRelation = async (dietitian, client) => {
  const pending = assertNoError(await admin
    .from('dietitian_clients')
    .insert({
      dietitian_id: dietitian.id,
      client_id: client.id,
      status: 'pending',
    })
    .select('id')
    .single(), dietitian.label + '/' + client.label + ' pending relation');
  relationshipIds.push(pending.id);
  const active = assertNoError(await admin
    .from('dietitian_clients')
    .update({
      status: 'active',
      accepted_at: '2026-08-30T08:00:00.000Z',
    })
    .eq('id', pending.id)
    .select('id,status')
    .single(), dietitian.label + '/' + client.label + ' relation acceptance');
  assert(active.status === 'active', dietitian.label.toUpperCase() + '_' + client.label.toUpperCase() + '_ACTIVE_RELATION');
};

const formatDate = (date) => date.toISOString().slice(0, 10);
const weekDates = (weekStart) => {
  const start = new Date(weekStart + 'T00:00:00.000Z');
  return Array.from({ length: 7 }, (_, offset) => {
    const date = new Date(start);
    date.setUTCDate(date.getUTCDate() + offset);
    return formatDate(date);
  });
};

const createWeek = async (dietitian, client, weekStart, label) => {
  const dates = weekDates(weekStart);
  const rows = assertNoError(await admin
    .from('meal_plans')
    .upsert(dates.map((planDate) => ({
      client_id: client.id,
      dietitian_id: dietitian.id,
      plan_date: planDate,
      notes: null,
    })), { onConflict: 'client_id,dietitian_id,plan_date' })
    .select('id,client_id,dietitian_id,plan_date,notes'), label + ' plan fixture');
  assert(rows.length === 7, label.toUpperCase() + '_SEVEN_PLANS_CREATED');
  rows.forEach((row) => planIds.push(row.id));
  return {
    weekStart,
    dates,
    plans: new Map(rows.map((row) => [row.plan_date, row])),
  };
};

const createMeal = async (week, offset, {
  id = randomUUID(),
  type = 'breakfast',
  title = 'Disposable cross-day meal',
  description = 'Cross-day identity fixture',
  calories = 420,
  macros = { protein: 30, carbs: 45, fat: 14 },
  time = '08:00:00',
  sort_order = 0,
  source = 'manual',
  recipe_id = null,
  is_eaten = false,
  completed_at = null,
  created_at = '2026-08-01T08:00:00.000Z',
} = {}, label = 'meal') => {
  const row = assertNoError(await admin
    .from('meals')
    .insert({
      id,
      plan_id: week.plans.get(week.dates[offset]).id,
      type,
      title,
      description,
      calories,
      macros,
      time,
      sort_order,
      source,
      recipe_id,
      is_eaten,
      completed_at,
      created_at,
      photo_url: null,
    })
    .select('id,plan_id,type,title,description,calories,macros,time,sort_order,source,recipe_id,is_eaten,completed_at,created_at,photo_url')
    .single(), label);
  mealIds.push(row.id);
  return row;
};

const createRecipe = async (dietitian, label) => {
  const row = assertNoError(await admin
    .from('recipes')
    .insert({
      id: randomUUID(),
      dietitian_id: dietitian.id,
      name: 'Disposable ' + label + ' recipe',
      description: 'Recipe source snapshot',
      meal_type: 'dinner',
      calories: 510,
      protein: 36,
      carbs: 48,
      fat: 16,
      image_path: null,
    })
    .select('id,name,description,calories,protein,carbs,fat,image_path')
    .single(), label + ' recipe fixture');
  recipeIds.push(row.id);
  return row;
};

const mealPayload = (row, overrides = {}) => ({
  id: row.id,
  type: overrides.type ?? row.type,
  title: overrides.title ?? row.title,
  description: overrides.description ?? row.description,
  calories: overrides.calories ?? row.calories,
  macros: overrides.macros ?? row.macros,
  time: overrides.time ?? (typeof row.time === 'string' ? row.time.slice(0, 5) : row.time),
  sort_order: overrides.sort_order ?? row.sort_order,
  source: overrides.source ?? row.source,
  recipe_id: Object.prototype.hasOwnProperty.call(overrides, 'recipe_id') ? overrides.recipe_id : row.recipe_id,
  photo_url: overrides.photo_url ?? row.photo_url,
});

const weeklyPayload = (week, placements = new Map()) => week.dates.map((planDate, offset) => ({
  plan_date: planDate,
  notes: null,
  meals: placements.get(offset) ?? [],
}));

const saveWeek = async (client, clientId, week, placements, label) => {
  const result = await client.rpc('save_weekly_meal_plan', {
    p_client_id: clientId,
    p_week_start: week.weekStart,
    p_days: weeklyPayload(week, placements),
  });
  return assertNoError(result, label);
};

const expectRejected = async (client, clientId, week, placements, label) => {
  const result = await client.rpc('save_weekly_meal_plan', {
    p_client_id: clientId,
    p_week_start: week.weekStart,
    p_days: weeklyPayload(week, placements),
  });
  assert(Boolean(result?.error), label, redact(result?.error?.message ?? 'RPC unexpectedly succeeded'));
};

const readMeal = async (mealId, label = 'meal read') => {
  const result = await admin
    .from('meals')
    .select('id,plan_id,type,title,source,recipe_id,is_eaten,completed_at,created_at')
    .eq('id', mealId)
    .maybeSingle();
  return assertNoError(result, label);
};

const readSchema = (sql) => execFileSync('docker', [
  'exec',
  'supabase_db_' + projectId,
  'psql',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '-Atc',
  sql,
], { encoding: 'utf8', timeout: 30_000 }).trim();

const runFlows = async () => {
  const dietitianA = await createActor('dietitian-a', 'dietitian');
  const dietitianB = await createActor('dietitian-b', 'dietitian');
  const clientA = await createActor('client-a', 'client');
  const clientB = await createActor('client-b', 'client');
  await approveDietitian(dietitianA);
  await approveDietitian(dietitianB);
  await bootstrapCore(dietitianA);
  await bootstrapCore(dietitianB);
  await createActiveRelation(dietitianA, clientA);
  await createActiveRelation(dietitianB, clientB);

  const webDietitianA = await createActorClient(dietitianA);
  const webDietitianB = await createActorClient(dietitianB);
  const mobileClientA = await createActorClient(clientA);
  const anonymous = createAnonymousClient();

  const sameDayWeek = await createWeek(dietitianA, clientA, '2026-09-07', 'same-day');
  const sameDayMeal = await createMeal(sameDayWeek, 0, {
    title: 'Same-day original',
    is_eaten: true,
    completed_at: '2026-08-30T08:00:00.000Z',
  }, 'same-day meal');
  const sameDayBefore = await readMeal(sameDayMeal.id, 'same-day before read');
  const sameDayResponse = await saveWeek(
    webDietitianA,
    clientA.id,
    sameDayWeek,
    new Map([[0, [mealPayload(sameDayMeal, { title: 'Same-day updated', time: '08:30' })]]]),
    'same-day update',
  );
  assert(sameDayResponse.plans?.length === 7, 'SAME_DAY_RESPONSE_HAS_SEVEN_PLANS');
  const sameDayAfter = await readMeal(sameDayMeal.id, 'same-day after read');
  assert(sameDayAfter.plan_id === sameDayWeek.plans.get(sameDayWeek.dates[0]).id, 'SAME_DAY_PLAN_ID_STABLE');
  assert(sameDayAfter.title === 'Same-day updated', 'SAME_DAY_EDITOR_FIELDS_UPDATED');
  assert(sameDayAfter.is_eaten === true
    && sameDayAfter.completed_at === sameDayBefore.completed_at
    && sameDayAfter.created_at === sameDayBefore.created_at, 'SAME_DAY_CLIENT_STATE_AND_IDENTITY_PRESERVED');

  const moveWeek = await createWeek(dietitianA, clientA, '2026-09-14', 'cross-day move');
  const moveMeal = await createMeal(moveWeek, 0, {
    title: 'Cross-day original',
    is_eaten: true,
    completed_at: '2026-08-30T09:00:00.000Z',
  }, 'cross-day move meal');
  const moveBefore = await readMeal(moveMeal.id, 'cross-day before read');
  const moveResponse = await saveWeek(
    webDietitianA,
    clientA.id,
    moveWeek,
    new Map([[2, [mealPayload(moveMeal, { type: 'lunch', title: 'Cross-day moved', time: '12:30' })]]]),
    'cross-day move',
  );
  assert(moveResponse.plans?.length === 7, 'CROSS_DAY_MOVE_RESPONSE_HAS_SEVEN_PLANS');
  const moveAfter = await readMeal(moveMeal.id, 'cross-day after read');
  assert(moveAfter.plan_id === moveWeek.plans.get(moveWeek.dates[2]).id, 'CROSS_DAY_MOVE_UPDATES_TARGET_PLAN');
  assert(moveAfter.type === 'lunch' && moveAfter.title === 'Cross-day moved', 'CROSS_DAY_MOVE_UPDATES_EDITOR_FIELDS');
  assert(moveAfter.is_eaten === true
    && moveAfter.completed_at === moveBefore.completed_at
    && moveAfter.created_at === moveBefore.created_at, 'CROSS_DAY_MOVE_PRESERVES_COMPLETION_AND_IDENTITY');
  const movedRows = assertNoError(await admin.from('meals').select('id').eq('id', moveMeal.id), 'cross-day identity count');
  assert(movedRows.length === 1, 'CROSS_DAY_MOVE_HAS_ONE_CANONICAL_ROW');

  const swapWeek = await createWeek(dietitianA, clientA, '2026-09-21', 'cross-day swap');
  const swapMealA = await createMeal(swapWeek, 0, {
    title: 'Swap A',
    is_eaten: true,
    completed_at: '2026-08-30T10:00:00.000Z',
  }, 'swap A');
  const swapMealB = await createMeal(swapWeek, 4, {
    type: 'dinner',
    title: 'Swap B',
    time: '19:00:00',
    is_eaten: false,
    completed_at: null,
  }, 'swap B');
  await saveWeek(
    webDietitianA,
    clientA.id,
    swapWeek,
    new Map([
      [0, [mealPayload(swapMealB, { type: 'breakfast', time: '08:00' })]],
      [4, [mealPayload(swapMealA, { type: 'dinner', time: '19:00' })]],
    ]),
    'cross-day swap',
  );
  const swapAfterA = await readMeal(swapMealA.id, 'swap A after read');
  const swapAfterB = await readMeal(swapMealB.id, 'swap B after read');
  assert(swapAfterA.plan_id === swapWeek.plans.get(swapWeek.dates[4]).id
    && swapAfterB.plan_id === swapWeek.plans.get(swapWeek.dates[0]).id, 'CROSS_DAY_SWAP_PLACEMENTS_EXCHANGED');
  assert(swapAfterA.is_eaten === true
    && swapAfterA.completed_at === swapMealA.completed_at
    && swapAfterB.is_eaten === false
    && swapAfterB.completed_at === null, 'CROSS_DAY_SWAP_COMPLETION_STAYS_WITH_IDS');

  const staleWeek = await createWeek(dietitianA, clientA, '2026-09-28', 'stale cleanup');
  const staleMeal = await createMeal(staleWeek, 0, { title: 'Stale row to remove' }, 'stale meal');
  const staleResponse = await saveWeek(
    webDietitianA,
    clientA.id,
    staleWeek,
    new Map([[2, [{
      type: 'lunch',
      title: 'New row after cleanup',
      description: 'New meal fixture',
      calories: 390,
      macros: { protein: 25, carbs: 40, fat: 12 },
      time: '12:00',
      sort_order: 0,
      source: 'manual',
      recipe_id: null,
      photo_url: null,
    }]]]),
    'stale cleanup and insert',
  );
  const newMealId = staleResponse.plans
    .flatMap((plan) => plan.meals ?? [])
    .find((meal) => meal.title === 'New row after cleanup')?.id;
  assert(newMealId && newMealId !== staleMeal.id, 'NEW_MEAL_GETS_NEW_ID');
  const staleAfter = await readMeal(staleMeal.id, 'stale meal after cleanup');
  const newAfter = await readMeal(newMealId, 'new meal after cleanup');
  assert(staleAfter === null, 'WEEK_WIDE_CLEANUP_REMOVES_OMITTED_ROW');
  assert(newAfter.plan_id === staleWeek.plans.get(staleWeek.dates[2]).id
    && newAfter.is_eaten === false, 'WEEK_WIDE_CLEANUP_RETAINS_NEW_ROW');

  const recipe = await createRecipe(dietitianA, 'live');
  const recipeWeek = await createWeek(dietitianA, clientA, '2026-10-05', 'recipe move');
  const recipeMeal = await createMeal(recipeWeek, 0, {
    type: 'breakfast',
    title: 'Old recipe snapshot',
    source: 'recipe',
    recipe_id: recipe.id,
    is_eaten: true,
    completed_at: '2026-08-30T11:00:00.000Z',
  }, 'recipe meal');
  await saveWeek(
    webDietitianA,
    clientA.id,
    recipeWeek,
    new Map([[4, [mealPayload(recipeMeal, { type: 'dinner', time: '19:30' })]]]),
    'recipe cross-day move',
  );
  const recipeAfter = await readMeal(recipeMeal.id, 'recipe after read');
  assert(recipeAfter.plan_id === recipeWeek.plans.get(recipeWeek.dates[4]).id
    && recipeAfter.source === 'recipe'
    && recipeAfter.recipe_id === recipe.id, 'RECIPE_CROSS_DAY_SOURCE_AND_PLACEMENT_PRESERVED');
  assert(recipeAfter.title === recipe.name
    && recipeAfter.is_eaten === true
    && recipeAfter.completed_at === recipeMeal.completed_at, 'RECIPE_CROSS_DAY_SNAPSHOT_AND_COMPLETION_PRESERVED');

  const deletedRecipeWeek = await createWeek(dietitianA, clientA, '2026-10-12', 'deleted recipe snapshot');
  const deletedRecipeMeal = await createMeal(deletedRecipeWeek, 0, {
    type: 'breakfast',
    title: 'Deleted recipe snapshot',
    description: 'Frozen snapshot',
    source: 'recipe',
    recipe_id: null,
    is_eaten: true,
    completed_at: '2026-08-30T12:00:00.000Z',
  }, 'deleted recipe meal');
  await saveWeek(
    webDietitianA,
    clientA.id,
    deletedRecipeWeek,
    new Map([[1, [mealPayload(deletedRecipeMeal, { type: 'lunch', time: '13:00' })]]]),
    'deleted recipe cross-day move',
  );
  const deletedRecipeAfter = await readMeal(deletedRecipeMeal.id, 'deleted recipe after read');
  assert(deletedRecipeAfter.plan_id === deletedRecipeWeek.plans.get(deletedRecipeWeek.dates[1]).id
    && deletedRecipeAfter.source === 'recipe'
    && deletedRecipeAfter.recipe_id === null
    && deletedRecipeAfter.title === deletedRecipeMeal.title, 'DELETED_RECIPE_SNAPSHOT_CROSS_DAY_PRESERVED');
  assert(deletedRecipeAfter.is_eaten === true
    && deletedRecipeAfter.completed_at === deletedRecipeMeal.completed_at, 'DELETED_RECIPE_COMPLETION_PRESERVED');

  const securityWeek = await createWeek(dietitianA, clientA, '2026-10-19', 'security');
  const authorizedMeal = await createMeal(securityWeek, 0, {
    title: 'Authorized atomic fixture',
    is_eaten: true,
    completed_at: '2026-08-30T13:00:00.000Z',
  }, 'authorized security meal');
  const foreignWeek = await createWeek(dietitianB, clientB, '2026-10-19', 'foreign tenant');
  const foreignMeal = await createMeal(foreignWeek, 0, { title: 'Foreign tenant fixture' }, 'foreign tenant meal');
  const otherWeek = await createWeek(dietitianA, clientA, '2026-10-26', 'other week');
  const otherWeekMeal = await createMeal(otherWeek, 0, { title: 'Other week fixture' }, 'other week meal');
  const authorizedBeforeReject = await readMeal(authorizedMeal.id, 'authorized before rejection');

  await expectRejected(
    webDietitianA,
    clientA.id,
    securityWeek,
    new Map([
      [2, [mealPayload(authorizedMeal, { type: 'lunch', time: '12:30' })]],
      [3, [mealPayload(foreignMeal, { type: 'snack', time: '16:00' })]],
    ]),
    'FORGED_FOREIGN_MEAL_ID_REJECTED',
  );
  const authorizedAfterForeignReject = await readMeal(authorizedMeal.id, 'authorized after foreign rejection');
  assert(authorizedAfterForeignReject.plan_id === authorizedBeforeReject.plan_id
    && authorizedAfterForeignReject.completed_at === authorizedBeforeReject.completed_at, 'FOREIGN_ID_REJECTION_IS_ATOMIC');

  await expectRejected(
    webDietitianA,
    clientA.id,
    securityWeek,
    new Map([[1, [mealPayload(otherWeekMeal, { type: 'lunch', time: '13:00' })]]]),
    'FORGED_OTHER_WEEK_MEAL_ID_REJECTED',
  );
  const authorizedAfterWeekReject = await readMeal(authorizedMeal.id, 'authorized after week rejection');
  assert(authorizedAfterWeekReject.plan_id === authorizedBeforeReject.plan_id, 'OTHER_WEEK_ID_REJECTION_PRESERVES_STATE');

  const invalidPayload = new Map([
    [2, [mealPayload(authorizedMeal, { type: 'lunch', time: '12:30' })]],
    [3, [{
      type: 'not-a-real-meal',
      title: 'Invalid payload after valid move',
      description: null,
      calories: null,
      macros: { protein: 1, carbs: 1, fat: 1 },
      time: '16:00',
      sort_order: 0,
      source: 'manual',
      recipe_id: null,
      photo_url: null,
    }]],
  ]);
  await expectRejected(webDietitianA, clientA.id, securityWeek, invalidPayload, 'INVALID_PAYLOAD_REJECTED');
  const authorizedAfterInvalid = await readMeal(authorizedMeal.id, 'authorized after invalid payload');
  assert(authorizedAfterInvalid.plan_id === authorizedBeforeReject.plan_id
    && authorizedAfterInvalid.is_eaten === authorizedBeforeReject.is_eaten
    && authorizedAfterInvalid.completed_at === authorizedBeforeReject.completed_at, 'INVALID_PAYLOAD_ROLLS_BACK_PRIOR_MOVE');

  await expectRejected(
    webDietitianA,
    clientB.id,
    securityWeek,
    new Map(),
    'WRONG_CLIENT_RELATION_REJECTED',
  );
  await expectRejected(
    mobileClientA,
    clientA.id,
    securityWeek,
    new Map(),
    'CLIENT_ROLE_CANNOT_SAVE_WEEKLY_PLAN',
  );
  await expectRejected(
    anonymous,
    clientA.id,
    securityWeek,
    new Map(),
    'ANONYMOUS_CANNOT_SAVE_WEEKLY_PLAN',
  );
  const foreignRead = await webDietitianB
    .from('meal_plans')
    .select('id')
    .eq('client_id', clientA.id)
    .eq('dietitian_id', dietitianA.id);
  assert(Boolean(foreignRead.error) || (Array.isArray(foreignRead.data) && foreignRead.data.length === 0), 'FOREIGN_DIETITIAN_READ_DENIED');

  const functionSecurity = readSchema("select p.prosecdef::text || '|' || coalesce(array_to_string(p.proconfig, ','), '') from pg_proc p where p.oid = 'public.save_weekly_meal_plan(uuid,date,jsonb)'::regprocedure;");
  const authenticatedExecute = readSchema("select has_function_privilege('authenticated', 'public.save_weekly_meal_plan(uuid,date,jsonb)', 'EXECUTE')::text;");
  const anonExecute = readSchema("select has_function_privilege('anon', 'public.save_weekly_meal_plan(uuid,date,jsonb)', 'EXECUTE')::text;");
  const serviceRoleExecute = readSchema("select has_function_privilege('service_role', 'public.save_weekly_meal_plan(uuid,date,jsonb)', 'EXECUTE')::text;");
  const mealsRls = readSchema("select relrowsecurity::text from pg_class where oid = 'public.meals'::regclass;");
  const plansRls = readSchema("select relrowsecurity::text from pg_class where oid = 'public.meal_plans'::regclass;");
  assert(functionSecurity.startsWith('true|search_path=pg_catalog, public'), 'RPC_SECURITY_DEFINER_SEARCH_PATH_PINNED', functionSecurity);
  assert(authenticatedExecute === 'true' && anonExecute === 'false' && serviceRoleExecute === 'false', 'RPC_EXECUTE_GRANTS_RESTRICTED');
  assert(mealsRls === 'true' && plansRls === 'true', 'MEAL_TABLES_RETAIN_RLS');
  pass('MEAL_PLAN_CROSS_DAY_DISPOSABLE_MATRIX_PASS');
};

const cleanup = async () => {
  if (!admin) return;
  if (mealIds.length) {
    assertNoError(await admin.from('meals').delete().in('id', [...new Set(mealIds)]), 'meal fixture cleanup');
    const remaining = assertNoError(await admin.from('meals').select('id').in('id', [...new Set(mealIds)]), 'meal fixture cleanup check');
    assert(remaining.length === 0, 'DISPOSABLE_MEAL_RESIDUE_ZERO');
  }
  if (recipeIds.length) {
    assertNoError(await admin.from('recipes').delete().in('id', [...new Set(recipeIds)]), 'recipe fixture cleanup');
    const remaining = assertNoError(await admin.from('recipes').select('id').in('id', [...new Set(recipeIds)]), 'recipe fixture cleanup check');
    assert(remaining.length === 0, 'DISPOSABLE_RECIPE_RESIDUE_ZERO');
  }
  if (planIds.length) {
    assertNoError(await admin.from('meal_plans').delete().in('id', [...new Set(planIds)]), 'plan fixture cleanup');
    const remaining = assertNoError(await admin.from('meal_plans').select('id').in('id', [...new Set(planIds)]), 'plan fixture cleanup check');
    assert(remaining.length === 0, 'DISPOSABLE_PLAN_RESIDUE_ZERO');
  }
  if (relationshipIds.length) {
    assertNoError(await admin.from('dietitian_clients').delete().in('id', [...new Set(relationshipIds)]), 'relationship fixture cleanup');
    const remaining = assertNoError(await admin.from('dietitian_clients').select('id').in('id', [...new Set(relationshipIds)]), 'relationship fixture cleanup check');
    assert(remaining.length === 0, 'DISPOSABLE_RELATIONSHIP_RESIDUE_ZERO');
  }
  if (subscriptionDietitianIds.length) {
    assertNoError(await admin.from('dietitian_subscriptions').delete().in('dietitian_id', [...new Set(subscriptionDietitianIds)]), 'subscription fixture cleanup');
    const remaining = assertNoError(await admin.from('dietitian_subscriptions').select('dietitian_id').in('dietitian_id', [...new Set(subscriptionDietitianIds)]), 'subscription fixture cleanup check');
    assert(remaining.length === 0, 'DISPOSABLE_SUBSCRIPTION_RESIDUE_ZERO');
  }
  for (const actorId of [...actorIds].reverse()) {
    const result = await admin.auth.admin.deleteUser(actorId);
    if (result.error && !(result.error.status === 404 && result.error.code === 'user_not_found')) {
      throw new Error('Auth cleanup failed for ' + (actorLabels.get(actorId) ?? actorId) + ': ' + redact(result.error.message));
    }
  }
  const users = assertNoError(await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'auth fixture cleanup check').users
    .filter(({ id }) => actorIds.includes(id));
  assert(users.length === 0, 'DISPOSABLE_AUTH_RESIDUE_ZERO');
};

try {
  const sourceMigrations = readdirSync(join(repoRoot, 'supabase', 'migrations'))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  assert(sourceMigrations.at(-1) === NEW_MIGRATION, 'CROSS_DAY_MIGRATION_IS_CANONICAL_TAIL');
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  addCurrentIsolatedMigrations({ repoRoot, tempRoot: disposable.tempRoot });
  await configureProject(disposable.configPath);
  stackStartAttempted = true;
  runCli(disposable.tempRoot, ['start']);
  pass('DISPOSABLE_LOCAL_STACK_STARTED', 'project=' + projectId);
  runCli(disposable.tempRoot, ['db', 'reset', '--local', '--no-seed']);
  pass('DISPOSABLE_MEAL_PLAN_MIGRATION_REPLAY', 'canonical chain plus local prerequisite');
  runCli(disposable.tempRoot, ['db', 'advisors', '--local', '--type', 'security', '--level', 'error', '--fail-on', 'error']);
  pass('DISPOSABLE_MEAL_PLAN_SECURITY_ADVISORS_NO_ERROR');
  runCli(disposable.tempRoot, ['db', 'lint', '--local', '--schema', 'private,public', '--level', 'error', '--fail-on', 'error']);
  pass('DISPOSABLE_MEAL_PLAN_DATABASE_LINT_NO_ERROR');
  local = parseStatus(runCli(disposable.tempRoot, ['status', '--output', 'env']));
  assert(new URL(local.API_URL).hostname === '127.0.0.1', 'DISPOSABLE_LOOPBACK_ONLY');
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'DISPOSABLE_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const migrationCount = readSchema('select count(*) from supabase_migrations.schema_migrations;');
  assert(migrationCount === '53', 'DISPOSABLE_SCHEMA_MIGRATION_COUNT', 'repository=52, local-prerequisite=1');
  await runFlows();
} catch (error) {
  mainError = error;
} finally {
  try {
    await cleanup();
  } catch (cleanupError) {
    mainError = mainError
      ? new Error(mainError.message + '; cleanup failed: ' + cleanupError.message)
      : cleanupError;
  }
  if (disposable?.tempRoot && stackStartAttempted) {
    try {
      runCli(disposable.tempRoot, ['stop', '--project-id', projectId, '--no-backup']);
      pass('DISPOSABLE_LOCAL_STACK_STOPPED', 'project=' + projectId);
    } catch (stopError) {
      mainError = mainError
        ? new Error(mainError.message + '; stack stop failed: ' + stopError.message)
        : stopError;
    }
  }
  if (disposable?.tempRoot) {
    const tempParent = dirname(disposable.tempRoot);
    rmSync(tempParent, { recursive: true, force: true });
    assert(!existsSync(tempParent), 'DISPOSABLE_TEMP_RESIDUE_ZERO');
  }
  try {
    const containerResidual = execFileSync('docker', [
      'ps',
      '-a',
      '--filter',
      'name=^supabase_.*_' + projectId + '$',
      '--format',
      '{{.ID}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    const volumeResidual = execFileSync('docker', [
      'volume',
      'ls',
      '--filter',
      'name=' + projectId,
      '--format',
      '{{.Name}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    const networkResidual = execFileSync('docker', [
      'network',
      'ls',
      '--filter',
      'name=' + projectId,
      '--format',
      '{{.Name}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    assert(containerResidual === '' && volumeResidual === '' && networkResidual === '', 'DISPOSABLE_DOCKER_RESIDUE_ZERO');
  } catch (dockerError) {
    mainError = mainError
      ? new Error(mainError.message + '; Docker residue verification failed: ' + dockerError.message)
      : dockerError;
  }
}

if (mainError) {
  process.stderr.write('[meal-plan-cross-day-runtime] ' + mainError.message + '\n');
  process.exitCode = 1;
}
