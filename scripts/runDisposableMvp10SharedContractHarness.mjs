#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

// MVP-10 only: every mutation in this runner is guarded to a disposable
// loopback Supabase stack. It must never be pointed at a hosted project.
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-MVP10-Only-4m!';
const projectId = `dietbridge-mvp10-${process.pid}-${randomUUID().slice(0, 8)}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const PLAN_DATE = '2026-08-10';
const MEASURED_AT = '2026-08-11';
const actorIds = [];
const relationshipIds = [];
const planIds = [];
const mealIds = [];
const measurementIds = [];
const dailyLogIds = [];
const conversationIds = [];
const messageIds = [];

let disposable;
let local;
let admin;
let stackStarted = false;
let stackStartAttempted = false;
let mainError;
let retainedMaterializationTempParent = null;

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

const cli = (args, options = {}) => execFileSync(process.execPath, [
  npxCli,
  '--yes',
  `supabase@${SUPABASE_VERSION}`,
  '--workdir',
  disposable.tempRoot,
  ...args,
], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: cleanEnvironment(process.env),
  maxBuffer: 16 * 1024 * 1024,
  timeout: 10 * 60 * 1000,
  ...options,
});

const pass = (label, detail = '') => process.stdout.write(`PASS: ${label}${detail ? ` ${detail}` : ''}\n`);

const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  pass(label, detail);
};

const assertNoError = (result, label) => {
  if (result?.error) throw new Error(`${label}: ${result.error.message}`);
  return result?.data;
};

const parseStatus = (value) => Object.fromEntries(value.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
  .filter(Boolean)
  .map((match) => [match[1], match[2]]));

const wait = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const deleteAuthActor = async (id) => {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await admin.auth.admin.deleteUser(id);
    if (!result.error || (result.error.status === 404 && result.error.code === 'user_not_found')) return;
    lastError = result.error;
    if (attempt < 3) await wait(150 * attempt);
  }
  throw new Error(`Auth fixture deletion failed: ${lastError?.message ?? 'unknown error'}`);
};

const listAuthActorResidue = async () => {
  let residue = [];
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const users = assertNoError(await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'Auth residue check');
    residue = users.users.filter(({ id }) => actorIds.includes(id));
    if (residue.length === 0) return residue;
    if (attempt < 4) await wait(150 * attempt);
  }
  return residue;
};

const anonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const actorClient = async (actor) => {
  const session = assertNoError(
    await anonymousClient().auth.signInWithPassword({ email: actor.email, password: PASSWORD }),
    `${actor.label} local sign-in`,
  );
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const createActor = async (label, role) => {
  const email = `mvp10-${label}-${randomUUID()}@example.invalid`;
  const result = assertNoError(await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: `Disposable ${label}`,
      mvp10_harness: 'disposable-shared-contract',
    },
  }), `${label} Auth fixture`);
  assert(result.user?.id, `${label.toUpperCase()}_AUTH_CREATED`);
  actorIds.push(result.user.id);
  return { id: result.user.id, email, label, role };
};

const approveDietitian = async (actor) => {
  const row = assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: 'approved',
    is_verified: true,
    verified_at: '2026-08-11T12:00:00.000Z',
  }).eq('user_id', actor.id).select('user_id,verification_status,is_verified').single(), `${actor.label} approval fixture`);
  assert(row.verification_status === 'approved' && row.is_verified === true, `${actor.label.toUpperCase()}_APPROVED`);
};

const bootstrapDisposableCore = async (dietitian) => {
  assert(
    local.API_URL.startsWith('http://127.0.0.1:') || local.API_URL.startsWith('http://localhost:'),
    'DISPOSABLE_BOOTSTRAP_LOOPBACK_ONLY',
  );
  const authUser = assertNoError(await admin.auth.admin.getUserById(dietitian.id), `${dietitian.label} bootstrap Auth read`);
  assert(
    authUser.user?.user_metadata?.mvp10_harness === 'disposable-shared-contract'
      && dietitian.email.endsWith('@example.invalid'),
    'DISPOSABLE_BOOTSTRAP_IDENTITY_EXPLICITLY_VERIFIED',
    dietitian.email,
  );
  const profile = assertNoError(await admin.from('profiles').select('id,role').eq('id', dietitian.id).single(), `${dietitian.label} bootstrap profile read`);
  const dietitianProfile = assertNoError(await admin.from('dietitian_profiles')
    .select('user_id,verification_status,is_verified').eq('user_id', dietitian.id).single(), `${dietitian.label} bootstrap dietitian profile read`);
  assert(
    profile.role === 'dietitian'
      && dietitianProfile.verification_status === 'approved'
      && dietitianProfile.is_verified === true,
    'DISPOSABLE_BOOTSTRAP_APPROVED_DIETITIAN',
  );
  const subscription = assertNoError(await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: dietitian.id,
    plan_id: 'core',
    status: 'active',
    client_limit_override: null,
  }).select('dietitian_id,plan_id,status').single(), `${dietitian.label} disposable Core bootstrap`);
  assert(subscription.plan_id === 'core' && subscription.status === 'active', 'DISPOSABLE_CORE_BOOTSTRAP');
};

const createActiveRelation = async (dietitian, client) => {
  const pending = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id,
    client_id: client.id,
    status: 'pending',
  }).select('id,dietitian_id,client_id,status').single(), `${dietitian.label}/${client.label} pending relation fixture`);
  relationshipIds.push(pending.id);
  assert(pending.status === 'pending', `${dietitian.label.toUpperCase()}_${client.label.toUpperCase()}_PENDING_RELATION`);
  const row = assertNoError(await admin.from('dietitian_clients').update({
    status: 'active',
    accepted_at: '2026-08-11T12:00:00.000Z',
  }).eq('id', pending.id).select('id,dietitian_id,client_id,status').single(), `${dietitian.label}/${client.label} accept relation fixture`);
  assert(row.status === 'active', `${dietitian.label.toUpperCase()}_${client.label.toUpperCase()}_ACTIVE_RELATION`);
  return row;
};

const weeklyDays = [
  { plan_date: PLAN_DATE, notes: 'MVP10 shared contract plan', meals: [
    { type: 'breakfast', title: 'Canonical breakfast', description: null, calories: 400, macros: { protein: 25, carbs: 40, fat: 12 }, time: '08:00', sort_order: 0, source: 'manual', recipe_id: null },
    { type: 'lunch', title: 'Canonical lunch', description: 'Nullable-compatible description', calories: 650, macros: { protein: 35, carbs: 70, fat: 20 }, time: '13:00', sort_order: 1, source: 'manual', recipe_id: null },
  ] },
  ...Array.from({ length: 6 }, (_, index) => ({
    plan_date: `2026-08-${String(11 + index).padStart(2, '0')}`,
    notes: null,
    meals: [],
  })),
];

const findPlanAndMealsAsMobile = async (clientApi, client, dietitian) => {
  const relationRows = assertNoError(await clientApi.from('dietitian_clients')
    .select('id,client_id,dietitian_id,status')
    .eq('client_id', client.id)
    .eq('status', 'active'), 'Mobile-equivalent active relation read');
  assert(relationRows.length === 1 && relationRows[0].dietitian_id === dietitian.id, 'MOBILE_RELATION_CONTRACT');

  const plans = assertNoError(await clientApi.from('meal_plans')
    .select('id,client_id,dietitian_id,plan_date,notes,meals (id,plan_id,type,title,description,calories,macros,time,sort_order,photo_url,source,recipe_id,is_eaten)')
    .eq('client_id', client.id)
    .eq('dietitian_id', dietitian.id)
    .eq('plan_date', PLAN_DATE), 'Mobile-equivalent meal plan read');
  assert(plans.length === 1 && plans[0].meals.length === 2, 'MOBILE_MEAL_PLAN_FIELDS_MATCH');
  assert(plans[0].meals.every((meal) => (
    ['breakfast', 'lunch', 'dinner', 'snack'].includes(meal.type)
      && typeof meal.title === 'string'
      && typeof meal.is_eaten === 'boolean'
      && meal.source === 'manual'
      && meal.recipe_id === null
  )), 'MOBILE_MEAL_ENUM_NULLABILITY_MATCH');
  return plans[0];
};

const readRows = async (client, table, columns, idColumn, ids, label) => (
  ids.length === 0 ? [] : assertNoError(await client.from(table).select(columns).in(idColumn, ids), label)
);

const runFlows = async () => {
  const dietitianA = await createActor('dietitian-a', 'dietitian');
  const dietitianB = await createActor('dietitian-b', 'dietitian');
  const clientA = await createActor('client-a', 'client');
  const clientB = await createActor('client-b', 'client');
  await approveDietitian(dietitianA);
  await approveDietitian(dietitianB);
  // The migration intentionally grants no implicit entitlement. Only these
  // explicitly marked, loopback-only test actors receive the local Core row.
  await bootstrapDisposableCore(dietitianA);
  await bootstrapDisposableCore(dietitianB);
  const relationA = await createActiveRelation(dietitianA, clientA);
  await createActiveRelation(dietitianB, clientB);

  const webDietitianA = await actorClient(dietitianA);
  const webDietitianB = await actorClient(dietitianB);
  const mobileClientA = await actorClient(clientA);
  const mobileClientB = await actorClient(clientB);

  const actorA = assertNoError(await mobileClientA.auth.getUser(), 'Client A session identity');
  const actorB = assertNoError(await mobileClientB.auth.getUser(), 'Client B session identity');
  assert(actorA.user.id === clientA.id && actorB.user.id === clientB.id, 'A_B_NETWORK_AUTH_IDENTITY');

  // A — Web dietitian writes through the canonical atomic RPC; Mobile reads
  // the same rows and completes one meal through the client RPC.
  const saved = assertNoError(await webDietitianA.rpc('save_weekly_meal_plan', {
    p_client_id: clientA.id,
    p_week_start: PLAN_DATE,
    p_days: weeklyDays,
  }), 'Web meal plan RPC');
  const savedPlans = saved?.plans ?? [];
  assert(savedPlans.length === 7 && savedPlans[0].meals.length === 2, 'WEB_MEAL_PLAN_ROUNDTRIP_CREATED');
  planIds.push(...savedPlans.map(({ id }) => id));
  mealIds.push(...savedPlans.flatMap(({ meals }) => meals.map(({ id }) => id)));

  const mobilePlan = await findPlanAndMealsAsMobile(mobileClientA, clientA, dietitianA);
  const mobileMeal = mobilePlan.meals.find(({ type }) => type === 'breakfast');
  assert(mobileMeal && mobileMeal.calories === 400 && mobileMeal.macros.protein === 25, 'MOBILE_FIELDS_EQUAL_WEB_PAYLOAD');
  const completion = assertNoError(await mobileClientA.rpc('set_my_meal_completion', {
    p_meal_id: mobileMeal.id,
    p_is_eaten: true,
  }), 'Mobile meal completion RPC');
  assert(completion === true, 'MOBILE_MEAL_COMPLETION_RPC_PASS');
  const refreshedMeal = assertNoError(await webDietitianA.from('meals').select('id,is_eaten').eq('id', mobileMeal.id).single(), 'Web refreshed meal read');
  assert(refreshedMeal.is_eaten === true, 'WEB_SEES_MOBILE_IS_EATEN');
  pass('FLOW_A_MEAL_PLAN_ROUNDTRIP');

  // B — Mobile/client-owned measurement is visible to the linked Web
  // dietitian and is invisible to the foreign tenant.
  const measurement = assertNoError(await mobileClientA.from('measurements').upsert({
    client_id: clientA.id,
    measured_at: MEASURED_AT,
    weight: 74.5,
    waist: 88,
  }, { onConflict: 'client_id,measured_at' }).select('id,client_id,measured_at,weight,waist').single(), 'Mobile measurement upsert');
  measurementIds.push(measurement.id);
  const webMeasurement = assertNoError(await webDietitianA.from('measurements').select('id,client_id,measured_at,weight,waist').eq('id', measurement.id).single(), 'Web measurement read');
  assert(webMeasurement.client_id === clientA.id && webMeasurement.measured_at === MEASURED_AT && webMeasurement.weight === 74.5, 'WEB_ANALYTICS_SEES_MOBILE_MEASUREMENT');
  const foreignMeasurement = await webDietitianB.from('measurements').select('id').eq('id', measurement.id);
  assert(!foreignMeasurement.error && foreignMeasurement.data.length === 0, 'FOREIGN_TENANT_MEASUREMENT_DENIED');
  pass('FLOW_B_MEASUREMENT_ROUNDTRIP');

  // C — Mobile daily water tracking and meal completion feed the same Web
  // source tables; date-only values stay Europe/Istanbul civil dates.
  const dailyLog = assertNoError(await mobileClientA.from('daily_logs').upsert({
    client_id: clientA.id,
    date: MEASURED_AT,
    water_intake: 1750,
  }, { onConflict: 'client_id,date' }).select('id,client_id,date,water_intake').single(), 'Mobile daily-log upsert');
  dailyLogIds.push(dailyLog.id);
  const webDailyLog = assertNoError(await webDietitianA.from('daily_logs').select('id,client_id,date,water_intake').eq('id', dailyLog.id).single(), 'Web daily-log read');
  assert(webDailyLog.client_id === clientA.id && webDailyLog.date === MEASURED_AT && webDailyLog.water_intake === 1750, 'WEB_ANALYTICS_SEES_MOBILE_WATER');
  const foreignDailyLog = await webDietitianB.from('daily_logs').select('id').eq('id', dailyLog.id);
  assert(!foreignDailyLog.error && foreignDailyLog.data.length === 0, 'FOREIGN_TENANT_DAILY_LOG_DENIED');
  pass('FLOW_C_DAILY_TRACKING_ROUNDTRIP');

  // D — Both actors use the same relationship RPC; the foreign dietitian is
  // not a conversation participant.
  const dietitianMessageId = randomUUID();
  const firstMessage = assertNoError(await webDietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationA.id,
    p_client_message_id: dietitianMessageId,
    p_body: 'Web → Mobile canonical message',
  }), 'Web chat send RPC');
  messageIds.push(firstMessage.id);
  const conversation = assertNoError(await mobileClientA.from('chat_conversations')
    .select('id,dietitian_client_id,dietitian_id,client_id')
    .eq('dietitian_client_id', relationA.id).single(), 'Mobile conversation read');
  conversationIds.push(conversation.id);
  assert(conversation.client_id === clientA.id && conversation.dietitian_id === dietitianA.id, 'MOBILE_CHAT_PARTICIPANT_CONTRACT');
  const clientMessageId = randomUUID();
  const reply = assertNoError(await mobileClientA.rpc('send_chat_message', {
    p_dietitian_client_id: relationA.id,
    p_client_message_id: clientMessageId,
    p_body: 'Mobile → Web canonical reply',
  }), 'Mobile chat send RPC');
  messageIds.push(reply.id);
  const webMessages = assertNoError(await webDietitianA.from('chat_messages')
    .select('id,conversation_id,sender_id,client_message_id,body')
    .eq('conversation_id', conversation.id)
    .order('created_at', { ascending: true }), 'Web chat refresh');
  assert(webMessages.length === 2 && webMessages[0].body.includes('Web') && webMessages[1].body.includes('Mobile'), 'WEB_SEES_MOBILE_CHAT_REPLY');
  const foreignConversation = await webDietitianB.from('chat_conversations').select('id').eq('id', conversation.id);
  assert(!foreignConversation.error && foreignConversation.data.length === 0, 'FOREIGN_TENANT_CHAT_DENIED');
  pass('FLOW_D_CHAT_ROUNDTRIP');

  // A -> B isolation and fresh-client restart equivalent.
  const clientBPlan = await mobileClientB.from('meal_plans').select('id').eq('client_id', clientA.id);
  assert(!clientBPlan.error && clientBPlan.data.length === 0, 'CLIENT_B_CANNOT_READ_CLIENT_A_PLAN');
  const clientBMeasurement = await mobileClientB.from('measurements').select('id').eq('client_id', clientA.id);
  assert(!clientBMeasurement.error && clientBMeasurement.data.length === 0, 'CLIENT_B_CANNOT_READ_CLIENT_A_MEASUREMENT');
  const freshClientB = await actorClient(clientB);
  const freshIdentity = assertNoError(await freshClientB.auth.getUser(), 'Fresh Client B session identity');
  assert(freshIdentity.user.id === clientB.id, 'FRESH_CLIENT_B_SESSION_ISOLATED');
  const freshClientBPlans = await freshClientB.from('meal_plans').select('id').eq('client_id', clientA.id);
  assert(!freshClientBPlans.error && freshClientBPlans.data.length === 0, 'FRESH_CLIENT_B_NO_CLIENT_A_RESIDUE');
  pass('ACCOUNT_CACHE_TENANT_ISOLATION');
};

try {
  try {
    disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  } catch (error) {
    const retainedPath = /; disposable workdir retained at (.+)$/.exec(error instanceof Error ? error.message : '');
    if (retainedPath) retainedMaterializationTempParent = dirname(retainedPath[1]);
    throw error;
  }

  const configText = readFileSync(disposable.configPath, 'utf8');
  assert(/^project_id\s*=\s*"[^"]+"/m.test(configText), 'DISPOSABLE_CONFIG_PROJECT_ID_PRESENT');
  writeFileSync(disposable.configPath, configText.replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`), 'utf8');

  stackStartAttempted = true;
  cli(['start']);
  stackStarted = true;
  pass('DISPOSABLE_LOCAL_STACK_STARTED', `project=${projectId}`);
  cli(['db', 'reset', '--local', '--no-seed']);
  pass('DISPOSABLE_41_MIGRATION_REPLAY');
  local = parseStatus(cli(['status', '--output', 'env']));
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? ''), 'LOOPBACK_API_GUARD', local.API_URL);
  assert(/^postgresql:\/\/postgres:[^@]+@(?:127\.0\.0\.1|localhost):\d+\/postgres$/.test(local.DB_URL ?? ''), 'LOOPBACK_DB_GUARD');
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'LOCAL_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  await runFlows();
  process.stdout.write('MVP10_SHARED_CONTRACT_RUNTIME_PASS\n');
} catch (error) {
  mainError = error;
} finally {
  if (admin) {
    try {
      if (conversationIds.length) assertNoError(await admin.from('chat_read_states').delete().in('conversation_id', conversationIds), 'chat read-state cleanup');
      if (conversationIds.length) assertNoError(await admin.from('chat_conversations').update({
        last_message_id: null,
        last_message_at: null,
      }).in('id', conversationIds), 'chat conversation pointer cleanup');
      if (messageIds.length) assertNoError(await admin.from('chat_messages').delete().in('id', messageIds), 'chat message cleanup');
      if (conversationIds.length) assertNoError(await admin.from('chat_conversations').delete().in('id', conversationIds), 'chat conversation cleanup');
      if (mealIds.length) assertNoError(await admin.from('meals').delete().in('id', mealIds), 'meal cleanup');
      if (planIds.length) assertNoError(await admin.from('meal_plans').delete().in('id', planIds), 'meal plan cleanup');
      if (dailyLogIds.length) assertNoError(await admin.from('daily_logs').delete().in('id', dailyLogIds), 'daily log cleanup');
      if (measurementIds.length) assertNoError(await admin.from('measurements').delete().in('id', measurementIds), 'measurement cleanup');
      if (relationshipIds.length) {
        const removed = assertNoError(await admin.from('dietitian_clients')
          .update({ status: 'removed' })
          .in('id', relationshipIds)
          .select('id,status'), 'relationship lifecycle cleanup');
        assert(removed.length === relationshipIds.length && removed.every(({ status }) => status === 'removed'), 'MVP10_RELATIONSHIP_CLEANUP_TRANSITION');
        assertNoError(await admin.from('dietitian_clients').delete().in('id', relationshipIds), 'relationship physical cleanup');
      }
      if (actorIds.length) await admin.from('dietitian_subscriptions').delete().in('dietitian_id', actorIds);
      for (const id of [...actorIds].reverse()) await deleteAuthActor(id);

      const actorOr = actorIds.join(',');
      const residueByTable = {
        relationships: assertNoError(await admin.from('dietitian_clients').select('id,status').in('id', relationshipIds), 'relationship residue check'),
        mealPlans: await readRows(admin, 'meal_plans', 'id', 'id', planIds, 'meal plan residue check'),
        meals: await readRows(admin, 'meals', 'id', 'id', mealIds, 'meal residue check'),
        dailyLogs: await readRows(admin, 'daily_logs', 'id', 'id', dailyLogIds, 'daily log residue check'),
        measurements: await readRows(admin, 'measurements', 'id', 'id', measurementIds, 'measurement residue check'),
        subscriptions: actorIds.length
          ? assertNoError(await admin.from('dietitian_subscriptions').select('dietitian_id').in('dietitian_id', actorIds), 'subscription residue check')
          : [],
        conversations: await readRows(admin, 'chat_conversations', 'id', 'id', conversationIds, 'conversation residue check'),
        messages: await readRows(admin, 'chat_messages', 'id', 'id', messageIds, 'message residue check'),
        readStates: conversationIds.length
          ? assertNoError(await admin.from('chat_read_states').select('conversation_id').in('conversation_id', conversationIds), 'chat read-state residue check')
          : [],
      };
      const sourceResidue = Object.fromEntries(Object.entries(residueByTable)
        .map(([table, rows]) => [table, rows.filter((row) => table !== 'relationships' || row.status !== 'removed').length]));
      assert(Object.values(sourceResidue).every((count) => count === 0), 'MVP10_FIXTURE_ROWS_ZERO', JSON.stringify(sourceResidue));
      if (actorOr) {
        const sourceResidue = [
          ...assertNoError(await admin.from('meal_plans').select('id').or(`client_id.in.(${actorOr}),dietitian_id.in.(${actorOr})`), 'actor plan residue'),
          ...assertNoError(await admin.from('measurements').select('id').in('client_id', actorIds), 'actor measurement residue'),
          ...assertNoError(await admin.from('daily_logs').select('id').in('client_id', actorIds), 'actor daily log residue'),
          ...assertNoError(await admin.from('dietitian_clients').select('id,status').or(`client_id.in.(${actorOr}),dietitian_id.in.(${actorOr})`), 'actor relationship residue')
            .filter(({ status }) => status !== 'removed'),
        ];
        assert(sourceResidue.length === 0, 'MVP10_ACTOR_SOURCE_RESIDUE_ZERO');
      }
      const authResidue = await listAuthActorResidue();
      assert(authResidue.length === 0, 'MVP10_AUTH_RESIDUE_ZERO', `rows=${authResidue.length}`);
    } catch (cleanupError) {
      if (mainError) mainError.message += `; fixture cleanup failed: ${cleanupError.message}`;
      else mainError = cleanupError;
    }
  }

  if (disposable?.tempRoot && stackStartAttempted) {
    try {
      cli(['stop', '--project-id', projectId, '--no-backup']);
      stackStarted = false;
      pass('DISPOSABLE_LOCAL_STACK_STOPPED', `project=${projectId}`);
    } catch (stopError) {
      if (mainError) mainError.message += `; local stack stop failed: ${stopError.message}`;
      else mainError = stopError;
    }
  }

  if (disposable?.tempRoot) {
    const tempParent = dirname(disposable.tempRoot);
    rmSync(tempParent, { recursive: true, force: true });
    assert(!existsSync(tempParent), 'DISPOSABLE_TEMP_RESIDUE_ZERO');
  } else if (retainedMaterializationTempParent) {
    rmSync(retainedMaterializationTempParent, { recursive: true, force: true });
    assert(!existsSync(retainedMaterializationTempParent), 'DISPOSABLE_MATERIALIZATION_FAILURE_TEMP_RESIDUE_ZERO');
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
  process.stderr.write(`[mvp10-shared-contract] ${mainError.message}\n`);
  process.exitCode = 1;
}
