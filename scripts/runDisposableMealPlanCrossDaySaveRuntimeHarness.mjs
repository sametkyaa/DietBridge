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
const NEW_MIGRATION = '20260831071948_meal_plan_new_recipe_custom_snapshot_contract.sql';
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
const mealPhotoPaths = [];
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
  return active;
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

const createRecipe = async (dietitian, label, overrides = {}) => {
  const id = overrides.id ?? randomUUID();
  const row = assertNoError(await admin
    .from('recipes')
    .insert({
      id,
      dietitian_id: dietitian.id,
      name: overrides.name ?? 'Disposable ' + label + ' recipe',
      description: overrides.description ?? 'Recipe source snapshot',
      meal_type: overrides.meal_type ?? 'dinner',
      calories: overrides.calories ?? 510,
      protein: overrides.protein ?? 36,
      carbs: overrides.carbs ?? 48,
      fat: overrides.fat ?? 16,
      image_path: overrides.image_path ?? null,
    })
    .select('id,dietitian_id,name,description,meal_type,calories,protein,carbs,fat,image_path,created_at,updated_at')
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
  ...(Object.prototype.hasOwnProperty.call(overrides, 'snapshot_mode')
    ? { snapshot_mode: overrides.snapshot_mode }
    : {}),
});

const newRecipePayload = (recipeId, overrides = {}) => ({
  type: 'breakfast',
  title: 'New recipe placement',
  description: 'New recipe placement description',
  calories: 500,
  macros: { protein: 35, carbs: 45, fat: 15 },
  time: '08:00',
  sort_order: 0,
  source: 'recipe',
  recipe_id: recipeId,
  photo_url: null,
  ...overrides,
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
  return result.error;
};

const readMeal = async (mealId, label = 'meal read') => {
  const result = await admin
    .from('meals')
    .select('id,plan_id,type,title,description,calories,macros,photo_url,time,sort_order,source,recipe_id,is_eaten,completed_at,created_at')
    .eq('id', mealId)
    .maybeSingle();
  return assertNoError(result, label);
};

const readRecipe = async (recipeId, label = 'recipe read') => {
  const result = await admin
    .from('recipes')
    .select('id,dietitian_id,name,description,meal_type,calories,protein,carbs,fat,image_path,created_at,updated_at')
    .eq('id', recipeId)
    .maybeSingle();
  return assertNoError(result, label);
};

const createMealPhoto = async (dietitian, client) => {
  const path = 'meal-plans/' + client.id + '/' + dietitian.id + '/' + randomUUID() + '.webp';
  const upload = await admin.storage
    .from('meal-photos')
    .upload(path, new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])], { type: 'image/webp' }), {
      contentType: 'image/webp',
      upsert: false,
    });
  assertNoError(upload, 'meal photo fixture upload');
  mealPhotoPaths.push(path);
  return path;
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
  const relationA = await createActiveRelation(dietitianA, clientA);
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

  const recipeId = randomUUID();
  const recipeImagePath = 'recipes/' + dietitianA.id + '/' + recipeId + '/' + randomUUID() + '.webp';
  const recipe = await createRecipe(dietitianA, 'snapshot-edit', {
    id: recipeId,
    image_path: recipeImagePath,
  });
  const recipeBeforeInitialPlacement = await readRecipe(recipe.id, 'recipe before initial placement');
  const recipeWeek = await createWeek(dietitianA, clientA, '2026-10-05', 'recipe snapshot edit');
  const initialRecipeResponse = await saveWeek(
    webDietitianA,
    clientA.id,
    recipeWeek,
    new Map([[0, [{
      type: 'breakfast',
      title: 'FORGED recipe title',
      description: 'FORGED recipe description',
      calories: 1,
      macros: { protein: 1, carbs: 1, fat: 1 },
      time: '08:00',
      sort_order: 0,
      source: 'recipe',
      recipe_id: recipe.id,
      photo_url: null,
    }]]]),
    'new recipe placement',
  );
  const recipeMealId = initialRecipeResponse.plans
    .flatMap((plan) => plan.meals ?? [])
    .find((meal) => meal.source === 'recipe' && meal.recipe_id === recipe.id)?.id;
  assert(Boolean(recipeMealId), 'NEW_RECIPE_PLACEMENT_RETURNS_MEAL_ID');
  mealIds.push(recipeMealId);
  const initialRecipeSnapshot = await readMeal(recipeMealId, 'initial recipe snapshot read');
  assert(initialRecipeSnapshot.title === recipe.name
    && initialRecipeSnapshot.description === recipe.description
    && initialRecipeSnapshot.calories === recipe.calories
    && initialRecipeSnapshot.macros.protein === recipe.protein
    && initialRecipeSnapshot.macros.carbs === recipe.carbs
    && initialRecipeSnapshot.macros.fat === recipe.fat
    && initialRecipeSnapshot.photo_url === recipe.image_path, 'NEW_RECIPE_FORGED_SNAPSHOT_IGNORED');
  const recipeAfterInitialPlacement = await readRecipe(recipe.id, 'recipe after initial placement');
  assert(JSON.stringify(recipeAfterInitialPlacement) === JSON.stringify(recipeBeforeInitialPlacement), 'NEW_RECIPE_PLACEMENT_DOES_NOT_MUTATE_MASTER');

  const explicitMasterRecipe = await createRecipe(dietitianA, 'explicit-master');
  const explicitMasterBefore = await readRecipe(explicitMasterRecipe.id, 'explicit master before placement');
  const explicitMasterWeek = await createWeek(dietitianA, clientA, '2026-11-02', 'explicit recipe master');
  const explicitMasterResponse = await saveWeek(
    webDietitianA,
    clientA.id,
    explicitMasterWeek,
    new Map([[
      0,
      [newRecipePayload(explicitMasterRecipe.id, {
        snapshot_mode: 'recipe_master',
        title: 'FORGED explicit master title',
        description: 'FORGED explicit master description',
        calories: 1,
        macros: { protein: 1, carbs: 1, fat: 1 },
      })],
    ]]),
    'explicit recipe master placement',
  );
  const explicitMasterMealId = explicitMasterResponse.plans
    .flatMap((plan) => plan.meals ?? [])
    .find((meal) => meal.source === 'recipe' && meal.recipe_id === explicitMasterRecipe.id)?.id;
  assert(Boolean(explicitMasterMealId), 'EXPLICIT_RECIPE_MASTER_RETURNS_MEAL_ID');
  mealIds.push(explicitMasterMealId);
  const explicitMasterSnapshot = await readMeal(explicitMasterMealId, 'explicit master snapshot read');
  assert(explicitMasterSnapshot.title === explicitMasterRecipe.name
    && explicitMasterSnapshot.description === explicitMasterRecipe.description
    && explicitMasterSnapshot.calories === explicitMasterRecipe.calories
    && explicitMasterSnapshot.macros.protein === explicitMasterRecipe.protein
    && explicitMasterSnapshot.photo_url === explicitMasterRecipe.image_path
    && explicitMasterSnapshot.source === 'recipe'
    && explicitMasterSnapshot.recipe_id === explicitMasterRecipe.id, 'EXPLICIT_RECIPE_MASTER_IGNORES_FORGED_SNAPSHOT');
  const explicitMasterAfter = await readRecipe(explicitMasterRecipe.id, 'explicit master after placement');
  assert(JSON.stringify(explicitMasterAfter) === JSON.stringify(explicitMasterBefore), 'EXPLICIT_RECIPE_MASTER_DOES_NOT_MUTATE_MASTER');

  const customRecipe = await createRecipe(dietitianA, 'custom-initial');
  const customRecipeBefore = await readRecipe(customRecipe.id, 'custom recipe before placement');
  const customWeek = await createWeek(dietitianA, clientA, '2026-11-09', 'custom initial recipe');
  const customResponse = await saveWeek(
    webDietitianA,
    clientA.id,
    customWeek,
    new Map([[
      0,
      [newRecipePayload(customRecipe.id, {
        snapshot_mode: 'custom',
        title: 'Custom initial recipe title',
        description: 'Custom initial recipe description',
        calories: 635,
        macros: { protein: 42, carbs: 57, fat: 21 },
      })],
    ]]),
    'custom initial recipe placement',
  );
  const customMealId = customResponse.plans
    .flatMap((plan) => plan.meals ?? [])
    .find((meal) => meal.source === 'recipe' && meal.recipe_id === customRecipe.id)?.id;
  assert(Boolean(customMealId), 'CUSTOM_INITIAL_RECIPE_RETURNS_MEAL_ID');
  mealIds.push(customMealId);
  const customSnapshot = await readMeal(customMealId, 'custom initial snapshot read');
  assert(customSnapshot.title === 'Custom initial recipe title'
    && customSnapshot.description === 'Custom initial recipe description'
    && customSnapshot.calories === 635
    && customSnapshot.macros.protein === 42
    && customSnapshot.macros.carbs === 57
    && customSnapshot.macros.fat === 21
    && customSnapshot.source === 'recipe'
    && customSnapshot.recipe_id === customRecipe.id, 'CUSTOM_INITIAL_RECIPE_SNAPSHOT_VALUES_PERSIST');
  const customRecipeAfter = await readRecipe(customRecipe.id, 'custom recipe after placement');
  assert(JSON.stringify(customRecipeAfter) === JSON.stringify(customRecipeBefore), 'CUSTOM_INITIAL_RECIPE_DOES_NOT_MUTATE_MASTER');

  const customPhotoRecipe = await createRecipe(dietitianA, 'custom-photo');
  const customPhotoRecipeBefore = await readRecipe(customPhotoRecipe.id, 'custom photo recipe before placement');
  const customPhotoWeek = await createWeek(dietitianA, clientA, '2026-11-16', 'custom initial photo');
  const customPhotoPath = await createMealPhoto(dietitianA, clientA);
  const customPhotoResponse = await saveWeek(
    webDietitianA,
    clientA.id,
    customPhotoWeek,
    new Map([[
      0,
      [newRecipePayload(customPhotoRecipe.id, {
        snapshot_mode: 'custom',
        title: 'Custom photo recipe title',
        photo_url: customPhotoPath,
      })],
    ]]),
    'custom initial recipe photo placement',
  );
  const customPhotoMealId = customPhotoResponse.plans
    .flatMap((plan) => plan.meals ?? [])
    .find((meal) => meal.source === 'recipe' && meal.recipe_id === customPhotoRecipe.id)?.id;
  assert(Boolean(customPhotoMealId), 'CUSTOM_INITIAL_RECIPE_PHOTO_RETURNS_MEAL_ID');
  mealIds.push(customPhotoMealId);
  const customPhotoSnapshot = await readMeal(customPhotoMealId, 'custom photo snapshot read');
  assert(customPhotoSnapshot.title === 'Custom photo recipe title'
    && customPhotoSnapshot.photo_url === customPhotoPath
    && customPhotoSnapshot.source === 'recipe'
    && customPhotoSnapshot.recipe_id === customPhotoRecipe.id, 'CUSTOM_INITIAL_RECIPE_PHOTO_PERSISTS');
  const customPhotoRecipeAfter = await readRecipe(customPhotoRecipe.id, 'custom photo recipe after placement');
  assert(JSON.stringify(customPhotoRecipeAfter) === JSON.stringify(customPhotoRecipeBefore), 'CUSTOM_INITIAL_RECIPE_PHOTO_DOES_NOT_MUTATE_MASTER');

  const foreignRecipe = await createRecipe(dietitianB, 'foreign-custom');
  const foreignCustomWeek = await createWeek(dietitianA, clientA, '2026-11-23', 'foreign custom recipe');
  await expectRejected(
    webDietitianA,
    clientA.id,
    foreignCustomWeek,
    new Map([[0, [newRecipePayload(foreignRecipe.id, {
      snapshot_mode: 'custom',
      title: 'Foreign recipe must fail',
    })]]]),
    'NEW_CUSTOM_FOREIGN_RECIPE_REJECTED',
  );
  const foreignCustomMeals = assertNoError(
    await admin.from('meals').select('id').eq('recipe_id', foreignRecipe.id),
    'foreign custom meal absence check',
  );
  assert(foreignCustomMeals.length === 0, 'NEW_CUSTOM_FOREIGN_RECIPE_NOT_CONVERTED_TO_MEAL');

  const missingRecipeId = randomUUID();
  const missingRecipeWeek = await createWeek(dietitianA, clientA, '2026-11-30', 'missing custom recipe');
  await expectRejected(
    webDietitianA,
    clientA.id,
    missingRecipeWeek,
    new Map([[0, [newRecipePayload(missingRecipeId, {
      snapshot_mode: 'custom',
      title: 'Missing recipe must fail',
    })]]]),
    'NEW_CUSTOM_MISSING_RECIPE_REJECTED',
  );
  const missingRecipeMeals = assertNoError(
    await admin.from('meals').select('id').eq('recipe_id', missingRecipeId),
    'missing custom meal absence check',
  );
  assert(missingRecipeMeals.length === 0, 'NEW_CUSTOM_MISSING_RECIPE_NOT_CONVERTED_TO_MANUAL');

  const deletedBeforeSaveRecipe = await createRecipe(dietitianA, 'deleted-before-save');
  assertNoError(
    await admin.from('recipes').delete().eq('id', deletedBeforeSaveRecipe.id),
    'deleted-before-save recipe fixture',
  );
  const deletedBeforeSaveWeek = await createWeek(dietitianA, clientA, '2026-12-07', 'deleted custom recipe');
  await expectRejected(
    webDietitianA,
    clientA.id,
    deletedBeforeSaveWeek,
    new Map([[0, [newRecipePayload(deletedBeforeSaveRecipe.id, {
      snapshot_mode: 'custom',
      title: 'Deleted recipe must fail',
    })]]]),
    'NEW_CUSTOM_DELETED_RECIPE_REJECTED',
  );
  const deletedBeforeSaveMeals = assertNoError(
    await admin.from('meals').select('id').eq('recipe_id', deletedBeforeSaveRecipe.id),
    'deleted custom meal absence check',
  );
  assert(deletedBeforeSaveMeals.length === 0, 'NEW_CUSTOM_DELETED_RECIPE_NOT_CONVERTED_TO_MANUAL');

  const invalidCustomRecipe = await createRecipe(dietitianA, 'invalid-custom');
  const invalidCustomWeek = await createWeek(dietitianA, clientA, '2026-12-14', 'invalid custom recipe');
  const invalidCustomExistingMeal = await createMeal(invalidCustomWeek, 0, {
    title: 'Atomic invalid custom sentinel',
    is_eaten: true,
    completed_at: '2026-08-30T12:00:00.000Z',
  }, 'invalid custom sentinel');
  const invalidCustomExistingBefore = await readMeal(invalidCustomExistingMeal.id, 'invalid custom sentinel before');
  const invalidCases = [
    ['title', { title: '   ' }],
    ['macros', { macros: { protein: -1, carbs: 1, fat: 1 } }],
    ['calories', { calories: 100001 }],
    ['photo', {
      photo_url: 'meal-plans/' + clientA.id + '/' + dietitianA.id + '/' + randomUUID() + '.webp',
    }],
  ];
  for (const [caseName, overrides] of invalidCases) {
    await expectRejected(
      webDietitianA,
      clientA.id,
      invalidCustomWeek,
      new Map([
        [0, [mealPayload(invalidCustomExistingMeal)]],
        [1, [newRecipePayload(invalidCustomRecipe.id, {
          snapshot_mode: 'custom',
          ...overrides,
        })]],
      ]),
      'NEW_CUSTOM_INVALID_' + caseName.toUpperCase() + '_REJECTED',
    );
    const invalidCustomExistingAfter = await readMeal(
      invalidCustomExistingMeal.id,
      'invalid custom sentinel after ' + caseName,
    );
    assert(
      JSON.stringify(invalidCustomExistingAfter) === JSON.stringify(invalidCustomExistingBefore),
      'NEW_CUSTOM_INVALID_' + caseName.toUpperCase() + '_IS_ATOMIC',
    );
    const invalidCustomMeals = assertNoError(
      await admin.from('meals').select('id').eq('recipe_id', invalidCustomRecipe.id),
      'invalid custom meal absence check ' + caseName,
    );
    assert(invalidCustomMeals.length === 0, 'NEW_CUSTOM_INVALID_' + caseName.toUpperCase() + '_NO_PARTIAL_INSERT');
  }
  pass('NEW_RECIPE_CUSTOM_SNAPSHOT_DISPOSABLE_MATRIX_PASS');

  const mealPhotoPath = await createMealPhoto(dietitianA, clientA);
  await saveWeek(
    webDietitianA,
    clientA.id,
    recipeWeek,
    new Map([[0, [mealPayload(initialRecipeSnapshot, {
      title: 'Edited plan-only recipe snapshot',
      description: 'Edited snapshot description',
      calories: 640,
      macros: { protein: 41, carbs: 52, fat: 19 },
      photo_url: mealPhotoPath,
    })]]]),
    'existing recipe snapshot edit',
  );
  const editedRecipeSnapshot = await readMeal(recipeMealId, 'edited recipe snapshot read');
  assert(editedRecipeSnapshot.id === recipeMealId
    && editedRecipeSnapshot.title === 'Edited plan-only recipe snapshot'
    && editedRecipeSnapshot.description === 'Edited snapshot description'
    && editedRecipeSnapshot.calories === 640
    && editedRecipeSnapshot.macros.protein === 41
    && editedRecipeSnapshot.macros.carbs === 52
    && editedRecipeSnapshot.macros.fat === 19, 'EXISTING_RECIPE_SNAPSHOT_FIELDS_EDITED');
  assert(editedRecipeSnapshot.source === 'recipe'
    && editedRecipeSnapshot.recipe_id === recipe.id
    && editedRecipeSnapshot.photo_url === mealPhotoPath, 'EXISTING_RECIPE_PROVENANCE_AND_PHOTO_EDIT_PRESERVED');
  const recipeAfterSnapshotEdit = await readRecipe(recipe.id, 'recipe after snapshot edit');
  assert(JSON.stringify(recipeAfterSnapshotEdit) === JSON.stringify(recipeBeforeInitialPlacement), 'EXISTING_RECIPE_EDIT_DOES_NOT_MUTATE_MASTER');

  assertNoError(await admin
    .from('recipes')
    .update({
      name: 'Changed recipe master',
      description: 'Changed master description',
      calories: 720,
      protein: 45,
      carbs: 61,
      fat: 22,
    })
    .eq('id', recipe.id)
    .select('id')
    .single(), 'recipe master drift fixture');
  const changedRecipeMaster = await readRecipe(recipe.id, 'changed recipe master read');
  await saveWeek(
    webDietitianA,
    clientA.id,
    recipeWeek,
    new Map([[0, [mealPayload(editedRecipeSnapshot)]]]),
    'existing snapshot save after recipe master drift',
  );
  const snapshotAfterMasterDrift = await readMeal(recipeMealId, 'snapshot after master drift read');
  assert(snapshotAfterMasterDrift.title === editedRecipeSnapshot.title
    && snapshotAfterMasterDrift.calories === editedRecipeSnapshot.calories
    && JSON.stringify(snapshotAfterMasterDrift.macros) === JSON.stringify(editedRecipeSnapshot.macros), 'EXISTING_SNAPSHOT_DOES_NOT_REFRESH_FROM_MASTER');
  const recipeAfterExistingSave = await readRecipe(recipe.id, 'recipe after existing snapshot save');
  assert(JSON.stringify(recipeAfterExistingSave) === JSON.stringify(changedRecipeMaster), 'EXISTING_SNAPSHOT_SAVE_LEAVES_CHANGED_MASTER_UNTOUCHED');

  const secondRecipe = await createRecipe(dietitianA, 'provenance-target');
  const snapshotBeforeTamper = await readMeal(recipeMealId, 'snapshot before provenance tamper');
  await expectRejected(
    webDietitianA,
    clientA.id,
    recipeWeek,
    new Map([[0, [mealPayload(snapshotBeforeTamper, { recipe_id: secondRecipe.id })]]]),
    'RECIPE_ID_PROVENANCE_TAMPERING_REJECTED',
  );
  await expectRejected(
    webDietitianA,
    clientA.id,
    recipeWeek,
    new Map([[0, [mealPayload(snapshotBeforeTamper, { source: 'manual', recipe_id: null })]]]),
    'RECIPE_SOURCE_PROVENANCE_TAMPERING_REJECTED',
  );
  const snapshotAfterTamper = await readMeal(recipeMealId, 'snapshot after provenance tamper');
  assert(JSON.stringify(snapshotAfterTamper) === JSON.stringify(snapshotBeforeTamper), 'PROVENANCE_REJECTION_PRESERVES_RECIPE_SNAPSHOT');

  assertNoError(await admin
    .from('meals')
    .update({ is_eaten: true, completed_at: '2026-08-30T11:00:00.000Z' })
    .eq('id', recipeMealId)
    .select('id')
    .single(), 'recipe completion fixture');
  const recipeBeforeMove = await readMeal(recipeMealId, 'recipe before edited move');
  await saveWeek(
    webDietitianA,
    clientA.id,
    recipeWeek,
    new Map([[4, [mealPayload(recipeBeforeMove, {
      type: 'dinner',
      time: '19:30',
      title: 'Edited while moving snapshot',
    })]]]),
    'recipe edited cross-day move',
  );
  const recipeAfterMove = await readMeal(recipeMealId, 'recipe after edited move');
  assert(recipeAfterMove.plan_id === recipeWeek.plans.get(recipeWeek.dates[4]).id
    && recipeAfterMove.title === 'Edited while moving snapshot'
    && recipeAfterMove.source === 'recipe'
    && recipeAfterMove.recipe_id === recipe.id, 'RECIPE_EDITED_CROSS_DAY_IDENTITY_AND_PLACEMENT_PRESERVED');
  assert(recipeAfterMove.is_eaten === true
    && recipeAfterMove.completed_at === recipeBeforeMove.completed_at
    && recipeAfterMove.created_at === recipeBeforeMove.created_at, 'RECIPE_EDITED_MOVE_PRESERVES_COMPLETION_AND_CREATED_AT');

  const deletedRecipe = await createRecipe(dietitianA, 'deleted-snapshot');
  const deletedRecipeWeek = await createWeek(dietitianA, clientA, '2026-10-12', 'deleted recipe snapshot');
  const deletedPlacement = await saveWeek(
    webDietitianA,
    clientA.id,
    deletedRecipeWeek,
    new Map([[0, [{
      type: 'breakfast',
      title: 'FORGED deleted recipe initial title',
      description: null,
      calories: 2,
      macros: { protein: 2, carbs: 2, fat: 2 },
      time: '08:00',
      sort_order: 0,
      source: 'recipe',
      recipe_id: deletedRecipe.id,
      photo_url: null,
    }]]]),
    'deleted recipe initial placement',
  );
  const deletedMealId = deletedPlacement.plans
    .flatMap((plan) => plan.meals ?? [])
    .find((meal) => meal.recipe_id === deletedRecipe.id)?.id;
  assert(Boolean(deletedMealId), 'DELETED_RECIPE_FIXTURE_MEAL_CREATED');
  mealIds.push(deletedMealId);
  assertNoError(await admin.from('recipes').delete().eq('id', deletedRecipe.id), 'deleted recipe master fixture');
  const deletedAfterFkClear = await readMeal(deletedMealId, 'deleted recipe after FK clear');
  assert(deletedAfterFkClear.source === 'recipe' && deletedAfterFkClear.recipe_id === null, 'DELETED_RECIPE_FK_CLEARS_WITH_SNAPSHOT_RETAINED');

  const staleDeletionError = await expectRejected(
    webDietitianA,
    clientA.id,
    deletedRecipeWeek,
    new Map([[0, [mealPayload(deletedAfterFkClear, { recipe_id: deletedRecipe.id })]]]),
    'STALE_DELETED_RECIPE_PROVENANCE_REJECTED',
  );
  assert(staleDeletionError.message.includes('Recipe provenance changed; reload the weekly plan.'), 'STALE_DELETION_ERROR_IS_ACTIONABLE');
  const deletedAfterStaleReject = await readMeal(deletedMealId, 'deleted snapshot after stale reject');
  assert(JSON.stringify(deletedAfterStaleReject) === JSON.stringify(deletedAfterFkClear), 'STALE_DELETION_REJECTION_IS_ATOMIC');

  const atomicManual = await createMeal(deletedRecipeWeek, 2, {
    type: 'lunch',
    title: 'Atomic manual original',
    time: '12:30:00',
  }, 'atomic manual meal');
  const atomicManualBefore = await readMeal(atomicManual.id, 'atomic manual before provenance failure');
  await expectRejected(
    webDietitianA,
    clientA.id,
    deletedRecipeWeek,
    new Map([
      [0, [mealPayload(deletedAfterFkClear, { recipe_id: deletedRecipe.id })]],
      [2, [mealPayload(atomicManualBefore, { title: 'Must roll back' })]],
    ]),
    'PROVENANCE_FAILURE_ROLLS_BACK_WEEK',
  );
  const atomicManualAfterReject = await readMeal(atomicManual.id, 'atomic manual after provenance failure');
  assert(JSON.stringify(atomicManualAfterReject) === JSON.stringify(atomicManualBefore), 'PROVENANCE_FAILURE_HAS_NO_PARTIAL_WEEKLY_MUTATION');

  await expectRejected(
    webDietitianA,
    clientA.id,
    deletedRecipeWeek,
    new Map([
      [0, [mealPayload(deletedAfterFkClear, { title: 'Invalid blank path', recipe_id: null, photo_url: 'recipes/' + dietitianA.id + '/' + secondRecipe.id + '/' + randomUUID() + '.webp' })]],
      [2, [mealPayload(atomicManualBefore)]],
    ]),
    'ARBITRARY_RECIPE_SNAPSHOT_PATH_REJECTED',
  );

  await saveWeek(
    webDietitianA,
    clientA.id,
    deletedRecipeWeek,
    new Map([
      [1, [mealPayload(deletedAfterFkClear, {
        type: 'lunch',
        time: '13:00',
        title: 'Edited deleted recipe snapshot',
        description: 'Editable without recipe lookup',
        calories: 455,
        macros: { protein: 29, carbs: 44, fat: 13 },
        recipe_id: null,
      })]],
      [2, [mealPayload(atomicManualBefore, { title: 'Manual regression edited' })]],
    ]),
    'deleted recipe and manual snapshot edit',
  );
  const deletedRecipeAfter = await readMeal(deletedMealId, 'deleted recipe after edit');
  const manualAfterEdit = await readMeal(atomicManual.id, 'manual after edit');
  assert(deletedRecipeAfter.plan_id === deletedRecipeWeek.plans.get(deletedRecipeWeek.dates[1]).id
    && deletedRecipeAfter.source === 'recipe'
    && deletedRecipeAfter.recipe_id === null
    && deletedRecipeAfter.title === 'Edited deleted recipe snapshot'
    && deletedRecipeAfter.calories === 455
    && deletedRecipeAfter.macros.protein === 29, 'DELETED_RECIPE_SNAPSHOT_EDIT_PERSISTS');
  assert(manualAfterEdit.title === 'Manual regression edited'
    && manualAfterEdit.source === 'manual'
    && manualAfterEdit.recipe_id === null, 'EXISTING_MANUAL_EDIT_REGRESSION_PASS');

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

  await expectRejected(
    webDietitianA,
    clientA.id,
    securityWeek,
    new Map([
      [2, [mealPayload(authorizedMeal, { type: 'lunch', time: '12:30' })]],
      [3, [mealPayload(authorizedMeal, { type: 'snack', time: '16:00' })]],
    ]),
    'DUPLICATE_MEAL_ID_REJECTED',
  );
  const authorizedAfterDuplicate = await readMeal(authorizedMeal.id, 'authorized after duplicate rejection');
  assert(authorizedAfterDuplicate.plan_id === authorizedBeforeReject.plan_id
    && authorizedAfterDuplicate.is_eaten === authorizedBeforeReject.is_eaten
    && authorizedAfterDuplicate.completed_at === authorizedBeforeReject.completed_at, 'DUPLICATE_ID_REJECTION_IS_ATOMIC');

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
  const removedRelation = assertNoError(await admin
    .from('dietitian_clients')
    .update({ status: 'removed' })
    .eq('id', relationA.id)
    .select('id,status')
    .single(), 'inactive relation fixture');
  assert(removedRelation.status === 'removed', 'INACTIVE_RELATION_FIXTURE_CREATED');
  await expectRejected(
    webDietitianA,
    clientA.id,
    securityWeek,
    new Map(),
    'INACTIVE_RELATION_REJECTED',
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
  if (mealPhotoPaths.length) {
    assertNoError(
      await admin.storage.from('meal-photos').remove([...new Set(mealPhotoPaths)]),
      'meal photo fixture cleanup',
    );
    pass('DISPOSABLE_MEAL_PHOTO_RESIDUE_ZERO');
  }
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
  assert(migrationCount === '55', 'DISPOSABLE_SCHEMA_MIGRATION_COUNT', 'repository=54, local-prerequisite=1');
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
