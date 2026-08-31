#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';
import { addCurrentIsolatedMigrations } from './addCurrentIsolatedMigrations.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-MealVisibility-4m!';
const projectId = `dietbridge-meal-${process.pid}-${randomUUID().slice(0, 8)}`;
const npxCli = process.env.npm_execpath
  ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const WEEK_START = '2026-08-10';
const TODAY = '2026-08-14';
const YESTERDAY = '2026-08-13';
const actorIds = [];
const actorMetadata = new Map();
const authDeleteDiagnostics = [];
const relationshipIds = [];
const subscriptionDietitianIds = [];
const planIds = [];
const mealIds = [];
const messageIds = [];
const conversationIds = [];
const storagePaths = [];
let disposable;
let local;
let admin;
let stackStartAttempted = false;
let mainError;

const pass = (label, detail = '') => process.stdout.write(`PASS: ${label}${detail ? ` ${detail}` : ''}\n`);
const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  pass(label, detail);
};
const assertNoError = (result, label) => {
  if (result?.error) throw new Error(`${label}: ${result.error.message}`);
  return result?.data;
};
const assertDeniedRead = async (request, label) => {
  const result = await request;
  assert(Boolean(result.error) || (Array.isArray(result.data) && result.data.length === 0), label);
};
const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const cleanEnvironment = ({
  SUPABASE_ACCESS_TOKEN: _accessToken,
  SUPABASE_TOKEN: _token,
  SUPABASE_DB_PASSWORD: _databasePassword,
  SUPABASE_SERVICE_ROLE_KEY: _serviceRole,
  SUPABASE_SECRET_KEY: _secretKey,
  SUPABASE_PUBLISHABLE_KEY: _publishableKey,
  SUPABASE_URL: _remoteUrl,
  SUPABASE_ANON_KEY: _remoteAnon,
  VITE_SUPABASE_URL: _remoteViteUrl,
  VITE_SUPABASE_ANON_KEY: _remoteViteAnon,
  EXPO_PUBLIC_SUPABASE_URL: _remoteExpoUrl,
  EXPO_PUBLIC_SUPABASE_ANON_KEY: _remoteExpoAnon,
  DATABASE_URL: _databaseUrl,
  POSTGRES_URL: _postgresUrl,
  POSTGRES_PRISMA_URL: _postgresPrismaUrl,
  POSTGRES_URL_NON_POOLING: _postgresNonPoolingUrl,
  ...environment
}) => ({
  ...Object.fromEntries(Object.entries(environment).filter(([key]) => !(
    /^(?:SUPABASE|VITE_SUPABASE|EXPO_PUBLIC_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)
  ))),
  TZ: 'Europe/Istanbul',
});

const runCli = (tempRoot, args) => {
  try {
    return execFileSync(process.execPath, [npxCli, '--yes', `supabase@${SUPABASE_VERSION}`, '--workdir', tempRoot, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: cleanEnvironment(process.env),
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
  } catch (error) {
    throw new Error(`Supabase ${args.join(' ')} failed: ${error.message}\n${String(error.stdout ?? '').slice(-6000)}\n${String(error.stderr ?? '').slice(-6000)}`);
  }
};

const parseStatus = (value) => Object.fromEntries(value.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
  .filter(Boolean)
  .map((match) => [match[1], match[2]]));

const isPortFree = (port) => new Promise((resolvePromise) => {
  const server = createServer();
  server.once('error', () => resolvePromise(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)));
});

const choosePortBase = async () => {
  const first = 56000 + (process.pid % 500);
  const offsets = Array.from({ length: 250 }, (_, index) => index * 20);
  for (const offset of offsets) {
    const base = first + offset;
    const ports = [base, base + 1, base + 2, base + 3, base + 4, base + 7, base + 9, base + 83];
    if ((await Promise.all(ports.map(isPortFree))).every(Boolean)) return base;
  }
  throw new Error('No disposable loopback port range is available.');
};

const configureDisposableProject = async (configPath) => {
  const base = await choosePortBase();
  const config = readFileSync(configPath, 'utf8')
    .replace(/^project_id\s*=\s*"[^"]+"$/m, `project_id = "${projectId}"`)
    .replace(/^port\s*=\s*54321$/m, `port = ${base}`)
    .replace(/^port\s*=\s*54322$/m, `port = ${base + 1}`)
    .replace(/^shadow_port\s*=\s*54320$/m, `shadow_port = ${base + 2}`)
    .replace(/^port\s*=\s*54329$/m, `port = ${base + 9}`)
    .replace(/^port\s*=\s*54323$/m, `port = ${base + 3}`)
    .replace(/^port\s*=\s*54324$/m, `port = ${base + 4}`)
    .replace(/^port\s*=\s*54327$/m, `port = ${base + 7}`)
    .replace(/^inspector_port\s*=\s*8083$/m, `inspector_port = ${base + 83}`);
  writeFileSync(configPath, config, 'utf8');
};

const createAnonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActorClient = async (actor) => {
  const session = assertNoError(
    await createAnonymousClient().auth.signInWithPassword({ email: actor.email, password: PASSWORD }),
    `${actor.label} sign-in`,
  );
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const createActor = async (label, role) => {
  const email = `meal-visibility-${label}-${randomUUID()}@example.invalid`;
  const result = assertNoError(await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { account_type: role, role, full_name: `Disposable ${label}`, meal_visibility_harness: 'disposable-only' },
  }), `${label} Auth fixture`);
  assert(result.user?.id, `${label.toUpperCase()}_AUTH_CREATED`);
  actorIds.push(result.user.id);
  const actor = { id: result.user.id, email, label, role };
  actorMetadata.set(actor.id, { id: actor.id, label: actor.label, role: actor.role });
  return actor;
};

const approveDietitian = async (actor) => {
  const row = assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: 'approved',
    is_verified: true,
    verified_at: '2026-08-14T08:00:00.000Z',
  }).eq('user_id', actor.id).select('user_id,verification_status,is_verified').single(), `${actor.label} approval`);
  assert(row.verification_status === 'approved' && row.is_verified === true, `${actor.label.toUpperCase()}_APPROVED`);
};

const bootstrapCore = async (dietitian) => {
  const row = assertNoError(await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: dietitian.id,
    plan_id: 'core',
    status: 'active',
    client_limit_override: null,
  }).select('dietitian_id,plan_id,status').single(), `${dietitian.label} Core bootstrap`);
  subscriptionDietitianIds.push(row.dietitian_id);
  assert(row.plan_id === 'core' && row.status === 'active', `${dietitian.label.toUpperCase()}_CORE_BOOTSTRAP`);
};

const createActiveRelation = async (dietitian, client) => {
  const pending = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id,
    client_id: client.id,
    status: 'pending',
  }).select('id,dietitian_id,client_id,status').single(), `${dietitian.label}/${client.label} pending relation`);
  relationshipIds.push(pending.id);
  const row = assertNoError(await admin.from('dietitian_clients').update({
    status: 'active',
    accepted_at: '2026-08-14T08:00:00.000Z',
  }).eq('id', pending.id).select('id,dietitian_id,client_id,status').single(), `${dietitian.label}/${client.label} relation acceptance`);
  assert(row.status === 'active', `${dietitian.label.toUpperCase()}_${client.label.toUpperCase()}_ACTIVE_RELATION`);
  return row;
};

const mealInput = ({ id, photoUrl = null, title = 'Disposable tracked breakfast' } = {}) => ({
  ...(id ? { id } : {}),
  type: 'breakfast',
  title,
  description: 'Meal visibility disposable fixture',
  calories: 420,
  macros: { protein: 30, carbs: 45, fat: 14 },
  time: '08:30',
  sort_order: 0,
  source: 'manual',
  recipe_id: null,
  photo_url: photoUrl,
});

const lunchInput = ({ id } = {}) => ({
  ...(id ? { id } : {}),
  type: 'lunch',
  title: 'Disposable pending lunch',
  description: null,
  calories: 620,
  macros: { protein: 35, carbs: 65, fat: 18 },
  time: '13:00',
  sort_order: 1,
  source: 'manual',
  recipe_id: null,
  photo_url: null,
});

const initialWeeklyPayload = () => [
  { plan_date: '2026-08-10', notes: null, meals: [] },
  { plan_date: '2026-08-11', notes: null, meals: [] },
  { plan_date: '2026-08-12', notes: null, meals: [] },
  { plan_date: YESTERDAY, notes: 'Legacy completed meal day', meals: [] },
  { plan_date: TODAY, notes: 'Meal visibility tracked day', meals: [mealInput(), lunchInput()] },
  { plan_date: '2026-08-15', notes: 'Future pending day', meals: [mealInput({ title: 'Disposable future breakfast' })] },
  { plan_date: '2026-08-16', notes: null, meals: [] },
];

const mealPayloadFromRow = (meal, photoUrl = meal.photo_url ?? null) => ({
  id: meal.id,
  type: meal.type,
  title: meal.title,
  description: meal.description,
  calories: meal.calories,
  macros: meal.macros,
  time: typeof meal.time === 'string' ? meal.time.slice(0, 5) : meal.time,
  sort_order: meal.sort_order,
  source: meal.source,
  recipe_id: meal.recipe_id,
  photo_url: photoUrl,
});

const readPlans = async (client, clientId, dietitianId) => assertNoError(await client
  .from('meal_plans')
  .select('id,client_id,dietitian_id,plan_date,notes,meals (id,plan_id,type,title,description,calories,macros,time,sort_order,photo_url,source,recipe_id,is_eaten,completed_at)')
  .eq('client_id', clientId)
  .eq('dietitian_id', dietitianId)
  .order('plan_date', { ascending: true }), 'Meal plan read');

const findMeal = (plans, planDate, mealId) => plans
  .find((plan) => plan.plan_date === planDate)?.meals.find((meal) => meal.id === mealId) ?? null;

const readTargetCanonical = async (mealId) => assertNoError(await admin
  .from('meals').select('id,is_eaten,completed_at,photo_url,plan_id').eq('id', mealId).single(), 'Canonical target meal read');

const projectActivities = (plans, relationId, conversationId, clientId, dietitianId) => plans.flatMap((plan) => (
  (plan.meals ?? [])
    .filter((meal) => meal.is_eaten === true && typeof meal.completed_at === 'string')
    .map((meal) => ({
      id: `meal_activity:${meal.id}`,
      kind: 'meal_activity',
      relationId,
      conversationId,
      clientId,
      dietitianId,
      mealId: meal.id,
      planId: plan.id,
      mealDate: plan.plan_date,
      completedAt: new Date(meal.completed_at).toISOString(),
      photoPath: meal.photo_url,
      isHumanMessage: false,
      requiresRead: false,
    }))
));

const readSchema = (sql) => execFileSync('docker', [
  'exec', `supabase_db_${projectId}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', sql,
], { encoding: 'utf8', timeout: 30_000 }).trim();

const readStorageObjects = async (path) => {
  const folder = path.slice(0, path.lastIndexOf('/'));
  const filename = path.slice(path.lastIndexOf('/') + 1);
  const rows = assertNoError(await admin.storage.from('meal-photos').list(folder, { limit: 100 }), 'Meal photo storage list');
  return rows.filter((row) => row.name === filename);
};

const readTrackedRows = async (table, columns, filterColumn, values, label) => {
  if (!values.length) return [];
  return assertNoError(await admin.from(table).select(columns).in(filterColumn, values), label);
};

const assertTrackedRowsAbsent = async (table, columns, filterColumn, values, label) => {
  const rows = await readTrackedRows(table, columns, filterColumn, values, `${label} read`);
  assert(rows.length === 0, label, `remaining=${rows.length}`);
  return rows;
};

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
  const mobileClientB = await createActorClient(clientB);
  const anonymous = createAnonymousClient();
  assert((await webDietitianA.auth.getUser()).data.user.id === dietitianA.id, 'DIETITIAN_A_SESSION_IDENTITY');
  assert((await mobileClientA.auth.getUser()).data.user.id === clientA.id, 'CLIENT_A_SESSION_IDENTITY');

  const saved = assertNoError(await webDietitianA.rpc('save_weekly_meal_plan', {
    p_client_id: clientA.id,
    p_week_start: WEEK_START,
    p_days: initialWeeklyPayload(),
  }), 'Initial weekly meal plan');
  const savedPlans = saved?.plans ?? [];
  assert(savedPlans.length === 7, 'WEEKLY_PLAN_CREATED');
  planIds.push(...savedPlans.map(({ id }) => id));
  mealIds.push(...savedPlans.flatMap(({ meals }) => meals.map(({ id }) => id)));
  const todayPlan = savedPlans.find((plan) => plan.plan_date === TODAY);
  const targetId = todayPlan?.meals.find((meal) => meal.type === 'breakfast')?.id;
  const lunchId = todayPlan?.meals.find((meal) => meal.type === 'lunch')?.id;
  const legacyPlanId = savedPlans.find((plan) => plan.plan_date === YESTERDAY)?.id;
  assert(targetId && lunchId && legacyPlanId, 'TRACKED_MEAL_IDS_CREATED');

  const legacyMeal = assertNoError(await admin.from('meals').insert({
    plan_id: legacyPlanId,
    type: 'breakfast',
    title: 'Legacy completed breakfast',
    description: null,
    calories: 380,
    macros: { protein: 24, carbs: 38, fat: 12 },
    time: '08:00',
    sort_order: 0,
    source: 'manual',
    recipe_id: null,
    is_eaten: true,
    photo_url: null,
  }).select('id,plan_id,is_eaten,completed_at').single(), 'Legacy meal fixture');
  mealIds.push(legacyMeal.id);
  assert(legacyMeal.is_eaten === true && legacyMeal.completed_at === null, 'LEGACY_MEAL_HAS_NO_FABRICATED_TIMESTAMP');

  const initialPlans = await readPlans(webDietitianA, clientA.id, dietitianA.id);
  const initialTarget = findMeal(initialPlans, TODAY, targetId);
  const initialLegacy = findMeal(initialPlans, YESTERDAY, legacyMeal.id);
  assert(initialTarget?.is_eaten === false && initialTarget?.completed_at === null, 'INCOMPLETE_MEAL_TIMESTAMP_NULL');
  assert(initialLegacy?.is_eaten === true && initialLegacy?.completed_at === null, 'LEGACY_TRACKING_READ_PRESERVED');
  assert(projectActivities(initialPlans, relationA.id, '00000000-0000-4000-8000-000000000000', clientA.id, dietitianA.id)
    .every((activity) => activity.mealId !== legacyMeal.id), 'LEGACY_MEAL_NOT_PROJECTED_TO_CHAT');

  const olderHuman = assertNoError(await webDietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationA.id,
    p_client_message_id: randomUUID(),
    p_body: 'Older human message before meal completion',
  }), 'Older human message');
  messageIds.push(olderHuman.id);
  const conversation = assertNoError(await admin.from('chat_conversations')
    .select('id,dietitian_client_id,dietitian_id,client_id,last_message_id,last_message_at')
    .eq('dietitian_client_id', relationA.id).single(), 'Conversation after older human message');
  conversationIds.push(conversation.id);
  assert((await admin.from('chat_messages').select('id').eq('conversation_id', conversation.id)).data.length === 1, 'PRE_COMPLETION_HUMAN_MESSAGE_COUNT_ONE');

  const completionResult = assertNoError(await mobileClientA.rpc('set_my_meal_completion', { p_meal_id: targetId, p_is_eaten: true }), 'First completion RPC');
  assert(completionResult === true, 'FIRST_COMPLETION_RPC_PASS');
  const firstCompleted = await readTargetCanonical(targetId);
  const firstTimestamp = firstCompleted.completed_at;
  assert(firstCompleted.is_eaten === true && typeof firstTimestamp === 'string', 'FIRST_COMPLETION_CANONICAL_TIMESTAMP_SET');
  const completedPlans = await readPlans(webDietitianA, clientA.id, dietitianA.id);
  const completedTarget = findMeal(completedPlans, TODAY, targetId);
  const completedLegacy = findMeal(completedPlans, YESTERDAY, legacyMeal.id);
  const firstActivities = projectActivities(completedPlans, relationA.id, conversation.id, clientA.id, dietitianA.id);
  assert(completedTarget?.is_eaten === true && completedTarget.completed_at === firstTimestamp, 'WEB_TRACKING_COMPLETION_READ');
  assert(completedLegacy?.is_eaten === true && completedLegacy.completed_at === null, 'LEGACY_TRACKING_COMPLETION_WITHOUT_EVENT_TIME');
  assert(firstActivities.filter((activity) => activity.mealId === targetId).length === 1, 'FIRST_COMPLETION_ONE_ACTIVITY');
  assert(firstActivities.every((activity) => activity.isHumanMessage === false && activity.requiresRead === false), 'ACTIVITY_NON_HUMAN_READ_SEMANTICS');
  assert((await admin.from('chat_messages').select('id').eq('conversation_id', conversation.id)).data.length === 1, 'COMPLETION_ADDS_ZERO_SYNTHETIC_CHAT_ROWS');
  assert((await admin.from('chat_read_states').select('conversation_id').eq('conversation_id', conversation.id).eq('user_id', dietitianA.id)).data.length === 0, 'COMPLETION_ADDS_ZERO_HUMAN_READ_ROWS');
  const ratioAfterFirstCompletion = completedPlans.find((plan) => plan.plan_date === TODAY)?.meals
    .reduce((summary, meal) => ({ planned: summary.planned + 1, completed: summary.completed + (meal.is_eaten ? 1 : 0) }), { planned: 0, completed: 0 });
  assert(ratioAfterFirstCompletion.planned === 2 && ratioAfterFirstCompletion.completed === 1, 'WEB_TRACKING_RATIO_PARTIAL');
  assert(firstActivities.every((activity) => activity.mealId !== legacyMeal.id), 'LEGACY_ACTIVITY_COUNT_ZERO');

  const photoPath = `meal-plans/${clientA.id}/${dietitianA.id}/${randomUUID()}.jpg`;
  storagePaths.push(photoPath);
  assertNoError(await webDietitianA.storage.from('meal-photos').upload(photoPath, Buffer.from('JFIF-disposable-meal-visibility-photo'), {
    contentType: 'image/jpeg',
    upsert: false,
  }), 'Canonical meal photo upload');
  const updateDays = completedPlans.map((plan) => ({
    plan_date: plan.plan_date,
    notes: plan.notes,
    meals: (plan.meals ?? []).map((meal) => meal.id === targetId
      ? mealPayloadFromRow(meal, photoPath)
      : mealPayloadFromRow(meal)),
  }));
  const photoSave = assertNoError(await webDietitianA.rpc('save_weekly_meal_plan', {
    p_client_id: clientA.id,
    p_week_start: WEEK_START,
    p_days: updateDays,
  }), 'Canonical meal photo attach flow');
  assert((photoSave?.plans ?? []).some((plan) => plan.meals?.some((meal) => meal.id === targetId && meal.photo_url === photoPath)), 'PHOTO_SAVE_RETAINS_MEAL_ID');
  const photoPlans = await readPlans(webDietitianA, clientA.id, dietitianA.id);
  const photoTarget = findMeal(photoPlans, TODAY, targetId);
  const photoActivities = projectActivities(photoPlans, relationA.id, conversation.id, clientA.id, dietitianA.id)
    .filter((activity) => activity.mealId === targetId);
  assert(photoTarget?.id === targetId && photoTarget.photo_url === photoPath, 'PHOTO_CANONICAL_ROW_UPDATED');
  assert(photoTarget.completed_at === firstTimestamp, 'PHOTO_UPDATE_PRESERVES_COMPLETION_TIMESTAMP');
  assert(photoActivities.length === 1 && photoActivities[0].id === `meal_activity:${targetId}` && photoActivities[0].photoPath === photoPath, 'PHOTO_UPDATES_SAME_ACTIVITY');
  assert((await readStorageObjects(photoPath)).length === 1, 'PHOTO_UPLOAD_COUNT_ONE');
  assertNoError(await webDietitianA.storage.from('meal-photos').createSignedUrl(photoPath, 60), 'DIETITIAN_A_SIGNED_PHOTO_READ');
  assertNoError(await mobileClientA.storage.from('meal-photos').createSignedUrl(photoPath, 60), 'CLIENT_A_SIGNED_PHOTO_READ');
  const foreignDietitianPhoto = await webDietitianB.storage.from('meal-photos').createSignedUrl(photoPath, 60);
  const foreignClientPhoto = await mobileClientB.storage.from('meal-photos').createSignedUrl(photoPath, 60);
  const anonymousPhoto = await anonymous.storage.from('meal-photos').createSignedUrl(photoPath, 60);
  assert(Boolean(foreignDietitianPhoto.error) && Boolean(foreignClientPhoto.error) && Boolean(anonymousPhoto.error), 'FOREIGN_AND_ANON_PHOTO_DENIED');
  await assertDeniedRead(webDietitianB.from('meal_plans').select('id').eq('client_id', clientA.id), 'DIETITIAN_B_MEAL_TRACKING_DENIED');
  await assertDeniedRead(mobileClientB.from('meal_plans').select('id').eq('client_id', clientA.id), 'CLIENT_B_MEAL_TRACKING_DENIED');
  await assertDeniedRead(anonymous.from('meal_plans').select('id').eq('client_id', clientA.id), 'ANONYMOUS_MEAL_TRACKING_DENIED');

  const undoResult = assertNoError(await mobileClientA.rpc('set_my_meal_completion', { p_meal_id: targetId, p_is_eaten: false }), 'Undo completion RPC');
  assert(undoResult === true, 'UNDO_RPC_PASS');
  const undone = await readTargetCanonical(targetId);
  assert(undone.is_eaten === false && undone.completed_at === null, 'UNDO_CLEARS_COMPLETION_TIMESTAMP');
  assert(undone.photo_url === photoPath, 'UNDO_RETAINS_EXISTING_PHOTO_CONTRACT');
  const undonePlans = await readPlans(webDietitianA, clientA.id, dietitianA.id);
  const undoneActivities = projectActivities(undonePlans, relationA.id, conversation.id, clientA.id, dietitianA.id);
  assert(undoneActivities.every((activity) => activity.mealId !== targetId), 'UNDO_REMOVES_CURRENT_ACTIVITY');
  const undoneRatio = undonePlans.find((plan) => plan.plan_date === TODAY)?.meals
    .reduce((summary, meal) => ({ planned: summary.planned + 1, completed: summary.completed + (meal.is_eaten ? 1 : 0) }), { planned: 0, completed: 0 });
  assert(undoneRatio.planned === 2 && undoneRatio.completed === 0, 'UNDO_DECREASES_TRACKING_RATIO');
  assert((await admin.from('chat_messages').select('id').eq('conversation_id', conversation.id)).data.length === 1, 'UNDO_LEAVES_HUMAN_CHAT_UNTOUCHED');

  await wait(100);
  const recompleteResult = assertNoError(await mobileClientA.rpc('set_my_meal_completion', { p_meal_id: targetId, p_is_eaten: true }), 'Recomplete RPC');
  assert(recompleteResult === true, 'RECOMPLETE_RPC_PASS');
  const recompleted = await readTargetCanonical(targetId);
  assert(recompleted.is_eaten === true && typeof recompleted.completed_at === 'string' && recompleted.completed_at !== firstTimestamp, 'RECOMPLETE_RESETS_TIMESTAMP');
  const recompletedPlans = await readPlans(webDietitianA, clientA.id, dietitianA.id);
  const recompletedActivities = projectActivities(recompletedPlans, relationA.id, conversation.id, clientA.id, dietitianA.id)
    .filter((activity) => activity.mealId === targetId);
  assert(recompletedActivities.length === 1, 'RECOMPLETE_ONE_ACTIVITY_NO_GHOST');
  assert(recompletedActivities[0].id === `meal_activity:${targetId}` && recompletedActivities[0].photoPath === photoPath, 'RECOMPLETE_ID_AND_PHOTO_STABLE');
  assert(Date.parse(recompletedActivities[0].completedAt) > Date.parse(firstTimestamp), 'RECOMPLETE_CHRONOLOGY_ADVANCES');

  const humanMessage = assertNoError(await mobileClientA.rpc('send_chat_message', {
    p_dietitian_client_id: relationA.id,
    p_client_message_id: randomUUID(),
    p_body: 'Real Client A human unread control',
  }), 'Client A human message');
  messageIds.push(humanMessage.id);
  const afterHuman = assertNoError(await admin.from('chat_conversations').select('last_message_id').eq('id', conversation.id).single(), 'Human conversation pointer');
  assert(afterHuman.last_message_id === humanMessage.id, 'HUMAN_MESSAGE_UPDATES_CONVERSATION_POINTER');
  const dietitianReadBefore = assertNoError(await admin.from('chat_read_states').select('last_read_message_id').eq('conversation_id', conversation.id).eq('user_id', dietitianA.id), 'Dietitian unread baseline');
  assert(dietitianReadBefore.length === 0, 'HUMAN_MESSAGE_CREATES_UNREAD_FOR_DIETITIAN');
  const markRead = assertNoError(await webDietitianA.rpc('mark_chat_conversation_read', { p_conversation_id: conversation.id, p_last_read_message_id: humanMessage.id }), 'Dietitian mark human message read');
  assert(markRead.last_read_message_id === humanMessage.id, 'HUMAN_READ_RPC_PASS');
  const readSnapshot = assertNoError(await admin.from('chat_read_states').select('last_read_message_id,last_read_at').eq('conversation_id', conversation.id).eq('user_id', dietitianA.id).single(), 'Read snapshot');
  const messageCountBeforeMealToggle = assertNoError(await admin.from('chat_messages').select('id').eq('conversation_id', conversation.id), 'Human message count before meal toggle').length;
  const toggleUndo = assertNoError(await mobileClientA.rpc('set_my_meal_completion', { p_meal_id: targetId, p_is_eaten: false }), 'Post-human undo');
  const toggleBack = assertNoError(await mobileClientA.rpc('set_my_meal_completion', { p_meal_id: targetId, p_is_eaten: true }), 'Post-human recomplete');
  assert(toggleUndo === true && toggleBack === true, 'POST_HUMAN_MEAL_TOGGLES_PASS');
  const readAfterToggles = assertNoError(await admin.from('chat_read_states').select('last_read_message_id,last_read_at').eq('conversation_id', conversation.id).eq('user_id', dietitianA.id).single(), 'Read snapshot after meal toggles');
  assert(readAfterToggles.last_read_message_id === readSnapshot.last_read_message_id && readAfterToggles.last_read_at === readSnapshot.last_read_at, 'MEAL_ACTIVITY_DOES_NOT_CHANGE_HUMAN_UNREAD');
  assert(assertNoError(await admin.from('chat_messages').select('id').eq('conversation_id', conversation.id), 'Human message count after meal toggles').length === messageCountBeforeMealToggle, 'MEAL_TOGGLES_ADD_ZERO_HUMAN_MESSAGES');

  const crossTenantActivityRead = await webDietitianB.from('meal_plans').select('id,meals(id,completed_at)').eq('client_id', clientA.id).eq('dietitian_id', dietitianA.id);
  assert(Boolean(crossTenantActivityRead.error) || (Array.isArray(crossTenantActivityRead.data) && crossTenantActivityRead.data.length === 0), 'DIETITIAN_B_ACTIVITY_DENIED');
  const crossTenantClientActivityRead = await mobileClientB.from('meal_plans').select('id,meals(id,completed_at)').eq('client_id', clientA.id).eq('dietitian_id', dietitianA.id);
  assert(Boolean(crossTenantClientActivityRead.error) || (Array.isArray(crossTenantClientActivityRead.data) && crossTenantClientActivityRead.data.length === 0), 'CLIENT_B_ACTIVITY_DENIED');

  const schema = {
    completedAtColumn: readSchema("select count(*) from information_schema.columns where table_schema='public' and table_name='meals' and column_name='completed_at';"),
    activityIndex: readSchema("select count(*) from pg_indexes where schemaname='public' and indexname='meals_completed_activity_idx';"),
    completionFunction: readSchema("select count(*) from pg_proc where oid='public.set_my_meal_completion(uuid,boolean)'::regprocedure;"),
    mealsRls: readSchema("select relrowsecurity::text from pg_class where oid='public.meals'::regclass;"),
    mealTriggers: readSchema("select count(*) from pg_trigger where tgrelid='public.meals'::regclass and not tgisinternal;"),
    anonExecute: readSchema("select has_function_privilege('anon','public.set_my_meal_completion(uuid,boolean)','EXECUTE')::text;"),
  };
  assert(schema.completedAtColumn === '1' && schema.activityIndex === '1' && schema.completionFunction === '1', 'SCHEMA_COMPLETION_VISIBILITY_OBJECTS_PRESENT', JSON.stringify(schema));
  assert(schema.mealsRls === 'true' && Number(schema.mealTriggers) >= 1 && schema.anonExecute === 'false', 'SCHEMA_RLS_TRIGGER_PRIVILEGE_STATE', JSON.stringify(schema));
  pass('MEAL_VISIBILITY_DISPOSABLE_MATRIX_PASS');
};

try {
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  addCurrentIsolatedMigrations({ repoRoot, tempRoot: disposable.tempRoot });
  await configureDisposableProject(disposable.configPath);
  stackStartAttempted = true;
  runCli(disposable.tempRoot, ['start']);
  pass('DISPOSABLE_LOCAL_STACK_STARTED', `project=${projectId}`);
  runCli(disposable.tempRoot, ['db', 'reset', '--local', '--no-seed']);
  pass('DISPOSABLE_FULL_MIGRATION_REPLAY', '54 canonical migrations + local prerequisite');
  local = parseStatus(runCli(disposable.tempRoot, ['status', '--output', 'env']));
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? ''), 'LOOPBACK_API_GUARD', local.API_URL);
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'LOCAL_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  await runFlows();
} catch (error) {
  mainError = error;
} finally {
  if (admin) {
    try {
      if (conversationIds.length) {
        const clearedPointers = assertNoError(await admin.from('chat_conversations')
          .update({ last_message_id: null })
          .in('id', conversationIds)
          .select('id,last_message_id'), 'chat conversation pointer cleanup');
        assert(clearedPointers.length === conversationIds.length
          && clearedPointers.every(({ last_message_id: lastMessageId }) => lastMessageId === null), 'DISPOSABLE_CHAT_POINTERS_CLEARED');
      }
      if (conversationIds.length) {
        assertNoError(await admin.from('chat_read_states').delete().in('conversation_id', conversationIds), 'chat read-state cleanup');
        await assertTrackedRowsAbsent('chat_read_states', 'conversation_id', 'conversation_id', conversationIds, 'DISPOSABLE_CHAT_READ_STATES_RESIDUE_ZERO');
      }
      if (messageIds.length) {
        assertNoError(await admin.from('chat_messages').delete().in('id', messageIds), 'chat message cleanup');
        await assertTrackedRowsAbsent('chat_messages', 'id', 'id', messageIds, 'DISPOSABLE_CHAT_MESSAGES_RESIDUE_ZERO');
      }
      if (conversationIds.length) {
        assertNoError(await admin.from('chat_conversations').delete().in('id', conversationIds), 'chat conversation cleanup');
        await assertTrackedRowsAbsent('chat_conversations', 'id', 'id', conversationIds, 'DISPOSABLE_CHAT_CONVERSATIONS_RESIDUE_ZERO');
      }
      if (storagePaths.length) {
        const queueBefore = await readTrackedRows('meal_photo_cleanup_queue', 'id,object_path', 'object_path', storagePaths, 'Meal photo cleanup queue before cleanup');
        pass('MEAL_PHOTO_QUEUE_BEFORE_CLEANUP', `tracked=${queueBefore.length}`);
        assertNoError(await admin.from('meal_photo_cleanup_queue').delete().in('object_path', storagePaths), 'meal photo cleanup queue cleanup');
        await assertTrackedRowsAbsent('meal_photo_cleanup_queue', 'id,object_path', 'object_path', storagePaths, 'DISPOSABLE_MEAL_PHOTO_QUEUE_RESIDUE_ZERO');
      }
      if (mealIds.length) {
        assertNoError(await admin.from('meals').delete().in('id', mealIds), 'meal cleanup');
        await assertTrackedRowsAbsent('meals', 'id', 'id', mealIds, 'DISPOSABLE_MEAL_RESIDUE_ZERO');
      }
      if (planIds.length) {
        assertNoError(await admin.from('meal_plans').delete().in('id', planIds), 'meal plan cleanup');
        await assertTrackedRowsAbsent('meal_plans', 'id', 'id', planIds, 'DISPOSABLE_MEAL_PLAN_RESIDUE_ZERO');
      }
      if (storagePaths.length) {
        assertNoError(await admin.storage.from('meal-photos').remove(storagePaths), 'meal photo storage cleanup');
        const residualObjects = (await Promise.all(storagePaths.map(readStorageObjects)))
          .flat();
        assert(residualObjects.length === 0, 'DISPOSABLE_STORAGE_RESIDUE_ZERO', `remaining=${residualObjects.length}`);
      }
      if (relationshipIds.length) {
        assertNoError(await admin.from('dietitian_clients').delete().in('id', relationshipIds), 'relationship cleanup');
        await assertTrackedRowsAbsent('dietitian_clients', 'id', 'id', relationshipIds, 'DISPOSABLE_RELATIONSHIP_RESIDUE_ZERO');
      }
      if (subscriptionDietitianIds.length) {
        assertNoError(await admin.from('dietitian_subscriptions').delete().in('dietitian_id', subscriptionDietitianIds), 'subscription cleanup');
        await assertTrackedRowsAbsent('dietitian_subscriptions', 'dietitian_id', 'dietitian_id', subscriptionDietitianIds, 'DISPOSABLE_SUBSCRIPTION_RESIDUE_ZERO');
      }
      for (const actorId of [...actorIds].reverse()) {
        const actor = actorMetadata.get(actorId) ?? { id: actorId, label: 'unknown', role: 'unknown' };
        for (let attempt = 1; attempt <= 4; attempt += 1) {
          const result = await admin.auth.admin.deleteUser(actorId);
          if (result.error) {
            authDeleteDiagnostics.push({
              actorId: actor.id,
              actorLabel: actor.label,
              actorRole: actor.role,
              attempt,
              status: result.error.status ?? result.error.statusCode ?? null,
              code: result.error.code ?? null,
              message: result.error.message ?? JSON.stringify(result.error),
            });
          }
          if (!result.error || (result.error.status === 404 && result.error.code === 'user_not_found')) break;
          if (attempt === 4) break;
          await wait(200 * attempt);
        }
      }
      let authUsers = [];
      for (let attempt = 1; attempt <= 4; attempt += 1) {
        authUsers = assertNoError(await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'Auth cleanup check').users
          .filter(({ id }) => actorIds.includes(id));
        if (authUsers.length === 0) break;
        await wait(200 * attempt);
      }
      process.stdout.write(`AUTH_DELETE_DIAGNOSTICS ${JSON.stringify(authDeleteDiagnostics)}\n`);
      process.stdout.write(`AUTH_RESIDUE_ACTOR_IDS ${JSON.stringify(authUsers.map(({ id }) => id))}\n`);
      assert(authUsers.length === 0, 'DISPOSABLE_AUTH_RESIDUE_ZERO');
    } catch (cleanupError) {
      if (mainError) mainError.message += `; cleanup failed: ${cleanupError.message}`;
      else mainError = cleanupError;
    }
  }

  if (disposable?.tempRoot && stackStartAttempted) {
    try {
      runCli(disposable.tempRoot, ['stop', '--project-id', projectId, '--no-backup']);
      pass('DISPOSABLE_LOCAL_STACK_STOPPED', `project=${projectId}`);
    } catch (stopError) {
      if (mainError) mainError.message += `; stack stop failed: ${stopError.message}`;
      else mainError = stopError;
    }
  }
  if (disposable?.tempRoot) {
    const tempParent = dirname(disposable.tempRoot);
    rmSync(tempParent, { recursive: true, force: true });
    assert(!existsSync(tempParent), 'DISPOSABLE_TEMP_RESIDUE_ZERO');
  }
  try {
    const containerResidual = execFileSync('docker', ['ps', '-a', '--filter', `name=^supabase_.*_${projectId}$`, '--format', '{{.ID}}'], { encoding: 'utf8', timeout: 30_000 }).trim();
    const volumeResidual = execFileSync('docker', ['volume', 'ls', '--filter', `name=${projectId}`, '--format', '{{.Name}}'], { encoding: 'utf8', timeout: 30_000 }).trim();
    const networkResidual = execFileSync('docker', ['network', 'ls', '--filter', `name=${projectId}`, '--format', '{{.Name}}'], { encoding: 'utf8', timeout: 30_000 }).trim();
    assert(containerResidual === '' && volumeResidual === '' && networkResidual === '', 'DISPOSABLE_DOCKER_RESIDUE_ZERO');
  } catch (dockerError) {
    if (mainError) mainError.message += `; Docker residue verification failed: ${dockerError.message}`;
    else mainError = dockerError;
  }
}

if (mainError) {
  process.stderr.write(`[meal-visibility-runtime] ${mainError.message}\n`);
  process.exitCode = 1;
}
