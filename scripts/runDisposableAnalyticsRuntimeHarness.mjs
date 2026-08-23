import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-MVP6-Only-9b!';
const NOW = new Date('2026-08-11T12:00:00.000Z');
const projectId = `dietbridge-mvp6-${process.pid}-${randomUUID().slice(0, 8)}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const actorIds = [];
const relationshipIds = [];
const measurementIds = [];
const dailyLogIds = [];
const mealPlanIds = [];
const mealIds = [];
const clientProfileIds = [];
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
  DATABASE_URL: _databaseUrl,
  POSTGRES_URL: _postgresUrl,
  POSTGRES_PRISMA_URL: _postgresPrismaUrl,
  POSTGRES_URL_NON_POOLING: _postgresNonPoolingUrl,
  ...environment
}) => ({
  ...Object.fromEntries(Object.entries(environment).filter(([key]) => !(
    /^(?:SUPABASE|VITE_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)
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
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};
const parseStatus = (value) => Object.fromEntries(value.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
  .filter(Boolean)
  .map((match) => [match[1], match[2]]));

const anonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActor = async (label, role) => {
  const email = `mvp6-${label}-${randomUUID()}@example.invalid`;
  const data = assertNoError(await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { account_type: role, role, full_name: `Disposable ${label}` },
  }), `${label} auth fixture`);
  assert(data.user?.id, `${label.toUpperCase()}_AUTH_CREATED`);
  actorIds.push(data.user.id);
  return { id: data.user.id, email, label };
};

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

const verifyDietitian = async (actor, status) => {
  const row = assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: status,
    is_verified: status === 'approved',
    verified_at: status === 'approved' ? NOW.toISOString() : null,
    rejection_reason: status === 'rejected' ? 'Disposable rejection' : null,
  }).eq('user_id', actor.id).select('user_id,verification_status,is_verified').single(), `${actor.label} verification fixture`);
  assert(row.verification_status === status, `${actor.label.toUpperCase()}_${status.toUpperCase()}_FIXTURE`);
};

const bootstrapDisposableCore = async (dietitian) => {
  assert(
    local.API_URL.startsWith('http://127.0.0.1:') || local.API_URL.startsWith('http://localhost:'),
    'DISPOSABLE_BOOTSTRAP_LOOPBACK_ONLY',
  );
  const user = assertNoError(await admin.auth.admin.getUserById(dietitian.id), `${dietitian.label} bootstrap Auth read`);
  assert(
    user.user?.user_metadata?.account_type === 'dietitian'
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
  assertNoError(await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: dietitian.id,
    plan_id: 'core',
    status: 'active',
    client_limit_override: null,
  }).select('dietitian_id').single(), `${dietitian.label} disposable Core bootstrap`);
  pass('DISPOSABLE_TEST_CORE_BOOTSTRAP', dietitian.email);
};

const activateRelationship = async (dietitian, client) => {
  const pending = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id, client_id: client.id, status: 'pending',
  }).select('id').single(), 'relationship pending fixture');
  relationshipIds.push(pending.id);
  const active = assertNoError(await admin.from('dietitian_clients').update({ status: 'active' })
    .eq('id', pending.id).select('id,status,accepted_at').single(), 'relationship active fixture');
  assert(active.status === 'active' && Boolean(active.accepted_at), 'ACTIVE_RELATIONSHIP_FIXTURE');
  return active.id;
};

const compileAnalyticsService = () => {
  const sourceRoot = join(disposable.tempRoot, 'analytics-service-source');
  const buildRoot = join(disposable.tempRoot, 'analytics-service-build');
  const sources = [
    'features/analytics/services/analyticsService.ts',
    'features/analytics/types/analytics.ts',
    'features/analytics/utils/waterContract.ts',
    'features/analytics/utils/analyticsContract.ts',
    'shared/types.ts',
    'shared/utils/uuid.ts',
  ];
  for (const source of sources) {
    const destination = join(sourceRoot, source);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(join(repoRoot, source)));
  }
  const proxyPath = join(sourceRoot, 'lib', 'supabaseClient.ts');
  mkdirSync(dirname(proxyPath), { recursive: true });
  writeFileSync(proxyPath, `let activeClient: any;
export const setSupabaseClient = (client: any) => { activeClient = client; };
export const supabase: any = new Proxy({}, {
  get: (_target, property) => {
    if (!activeClient) throw new Error('Disposable Supabase actor is not selected.');
    const value = activeClient[property];
    return typeof value === 'function' ? value.bind(activeClient) : value;
  },
});
`, 'utf8');
  const constantsStub = join(sourceRoot, 'shared', 'constants.ts');
  mkdirSync(dirname(constantsStub), { recursive: true });
  writeFileSync(constantsStub, "export const USER_AVATAR = 'https://example.invalid/disposable-avatar.png';\n", 'utf8');
  const avatarUrlStub = join(sourceRoot, 'shared', 'utils', 'avatarUrl.ts');
  mkdirSync(dirname(avatarUrlStub), { recursive: true });
  writeFileSync(avatarUrlStub, `export const resolveProfilePhotoUrl = async (
  value: string | null | undefined,
  _access: unknown,
): Promise<string | null> => value;
`, 'utf8');
  const clientServiceStub = join(sourceRoot, 'features', 'clients', 'services', 'clientService.ts');
  mkdirSync(dirname(clientServiceStub), { recursive: true });
  writeFileSync(clientServiceStub, 'export const fetchActiveDietitianClientList = async () => ({ status: \'success\' as const, clients: [] });\n', 'utf8');
  execFileSync(process.execPath, [
    join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--rootDir', sourceRoot,
    '--outDir', buildRoot,
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--target', 'ES2022',
    '--esModuleInterop',
    '--skipLibCheck',
    ...sources.map((source) => join(sourceRoot, source)),
    proxyPath,
    constantsStub,
    avatarUrlStub,
    clientServiceStub,
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 });
  const require = createRequire(import.meta.url);
  return {
    service: require(join(buildRoot, 'features', 'analytics', 'services', 'analyticsService.js')),
    actorProxy: require(join(buildRoot, 'lib', 'supabaseClient.js')),
  };
};

const assertServiceDenied = async (operation, ServiceError, label) => {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof ServiceError, label, `received=${error?.constructor?.name ?? typeof error}`);
    return;
  }
  throw new Error(`${label}: operation unexpectedly succeeded`);
};

const insertAnalyticsFixtures = async (approvedA, approvedB, clientA, clientB) => {
  const profile = assertNoError(await admin.from('client_profiles').update({
    start_weight: null, current_weight: 79, target_weight: 70, daily_water_goal_ml: 2000,
  }).eq('user_id', clientA.id).select('user_id').single(), 'client profile analytics fixture');
  clientProfileIds.push(profile.user_id);

  // Auth onboarding creates an initial current-date measurement for client actors.
  // This disposable harness owns both actors, so remove only their generated rows
  // before installing deterministic boundary fixtures.
  assertNoError(
    await admin.from('measurements').delete().in('client_id', [clientA.id, clientB.id]),
    'generated onboarding measurements removed',
  );

  const measurements = [
    { client_id: clientA.id, measured_at: '2026-08-03', weight: 19, waist: 92 },
    { client_id: clientA.id, measured_at: '2026-08-04', weight: 79, waist: 91 },
    { client_id: clientA.id, measured_at: '2026-08-05', weight: 78, waist: 90 },
    { client_id: clientA.id, measured_at: '2026-08-10', weight: 76.5, waist: 88 },
    { client_id: clientA.id, measured_at: '2026-08-11', weight: 19, waist: 87 },
    { client_id: clientB.id, measured_at: '2026-08-11', weight: 65, waist: 75 },
  ];
  const insertedMeasurements = assertNoError(await admin.from('measurements').insert(measurements).select('id'), 'measurement fixtures');
  measurementIds.push(...insertedMeasurements.map(({ id }) => id));

  const logs = [
    { client_id: clientA.id, date: '2026-08-04', water_intake: 1 },
    { client_id: clientA.id, date: '2026-08-05', water_intake: 1.5 },
    { client_id: clientA.id, date: '2026-08-06', water_intake: 2.5 },
    { client_id: clientA.id, date: '2026-08-07', water_intake: null },
    { client_id: clientA.id, date: '2026-08-08', water_intake: 0 },
    { client_id: clientB.id, date: '2026-08-11', water_intake: 3000 },
  ];
  const insertedLogs = assertNoError(await admin.from('daily_logs').insert(logs).select('id'), 'daily log fixtures');
  dailyLogIds.push(...insertedLogs.map(({ id }) => id));

  const plans = assertNoError(await admin.from('meal_plans').insert([
    { client_id: clientA.id, dietitian_id: approvedA.id, plan_date: '2026-08-04', notes: 'outside boundary' },
    { client_id: clientA.id, dietitian_id: approvedA.id, plan_date: '2026-08-05', notes: 'inclusive start' },
    { client_id: clientA.id, dietitian_id: approvedA.id, plan_date: '2026-08-11', notes: 'inclusive end' },
    { client_id: clientB.id, dietitian_id: approvedB.id, plan_date: '2026-08-11', notes: 'foreign tenant' },
  ]).select('id,plan_date,client_id'), 'meal plan fixtures');
  mealPlanIds.push(...plans.map(({ id }) => id));
  const planBy = (date, clientId) => plans.find((plan) => plan.plan_date === date && plan.client_id === clientId).id;
  const meals = [
    { plan_id: planBy('2026-08-04', clientA.id), type: 'snack', title: 'Outside', is_eaten: true, calories: 100, macros: { protein: 1, carbs: 1, fat: 1 } },
    { plan_id: planBy('2026-08-05', clientA.id), type: 'breakfast', title: 'Boundary breakfast', is_eaten: true, calories: 500, macros: { protein: 30, carbs: 45, fat: 15 } },
    { plan_id: planBy('2026-08-05', clientA.id), type: 'lunch', title: 'Boundary lunch', is_eaten: false, calories: null, macros: { protein: 25, fat: 10 } },
    { plan_id: planBy('2026-08-11', clientA.id), type: 'breakfast', title: 'End breakfast', is_eaten: true, calories: 600, macros: { protein: 35, carbs: 55, fat: 18 } },
    { plan_id: planBy('2026-08-11', clientA.id), type: 'dinner', title: 'End dinner', is_eaten: true, calories: null, macros: null },
    { plan_id: planBy('2026-08-11', clientA.id), type: 'snack', title: 'End snack', is_eaten: false, calories: null, macros: null },
    { plan_id: planBy('2026-08-11', clientB.id), type: 'dinner', title: 'Foreign meal', is_eaten: true, calories: 900, macros: { protein: 50, carbs: 60, fat: 30 } },
  ];
  const insertedMeals = assertNoError(await admin.from('meals').insert(meals).select('id'), 'meal fixtures');
  mealIds.push(...insertedMeals.map(({ id }) => id));
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
  pass('DISPOSABLE_40_MIGRATION_REPLAY');

  local = parseStatus(cli(['status', '--output', 'env']));
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? ''), 'LOOPBACK_API_GUARD', local.API_URL);
  assert(/^postgresql:\/\/postgres:[^@]+@(?:127\.0\.0\.1|localhost):\d+\/postgres$/.test(local.DB_URL ?? ''), 'LOOPBACK_DB_GUARD');
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'LOCAL_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const approvedA = await createActor('approved-a', 'dietitian');
  const approvedB = await createActor('approved-b', 'dietitian');
  const pending = await createActor('pending', 'dietitian');
  const rejected = await createActor('rejected', 'dietitian');
  const missing = await createActor('missing-profile', 'dietitian');
  const clientA = await createActor('client-a', 'client');
  const clientB = await createActor('client-b', 'client');
  const pendingClient = await createActor('pending-client', 'client');
  const rejectedClient = await createActor('rejected-client', 'client');
  await verifyDietitian(approvedA, 'approved');
  await verifyDietitian(approvedB, 'approved');
  await verifyDietitian(rejected, 'rejected');
  await bootstrapDisposableCore(approvedA);
  await bootstrapDisposableCore(approvedB);
  const relationshipA = await activateRelationship(approvedA, clientA);
  await activateRelationship(approvedB, clientB);
  const approvalIsolationRelations = assertNoError(
    await admin.from('dietitian_clients')
      .select('dietitian_id,client_id,status')
      .in('dietitian_id', [pending.id, rejected.id]),
    'approval isolation relationship check',
  );
  assert(
    approvalIsolationRelations.length === 0,
    'PENDING_REJECTED_HAVE_NO_ACTIVE_RELATIONSHIP',
  );
  assertNoError(await admin.from('profiles').delete().eq('id', missing.id), 'missing profile fixture');
  assert((assertNoError(await admin.from('profiles').select('id').eq('id', missing.id), 'missing profile check')).length === 0, 'MISSING_PROFILE_FIXTURE');
  await insertAnalyticsFixtures(approvedA, approvedB, clientA, clientB);

  const api = {
    approvedA: await actorClient(approvedA), approvedB: await actorClient(approvedB),
    pending: await actorClient(pending), rejected: await actorClient(rejected),
    missing: await actorClient(missing), clientA: await actorClient(clientA),
    anonymous: anonymousClient(),
  };
  const { service, actorProxy } = compileAnalyticsService();
  actorProxy.setSupabaseClient(api.approvedA);
  pass('REAL_ANALYTICS_SERVICE_COMPILED');

  let report = await service.fetchClientAnalytics(clientA.id, '7d', NOW);
  assert(report.range.startDate === '2026-08-05' && report.range.endDate === '2026-08-11', 'ISTANBUL_7D_BOUNDARIES');
  assert(
    report.weightTrend.length === 2
      && report.weightTrend[0].date === '2026-08-05'
      && report.bodyMeasurementTrends.find(({ field }) => field === 'waist')?.points.length === 3,
    'MEASUREMENT_DATE_FILTER_INCLUSIVE',
  );
  assert(report.kpis.currentWeight === 76.5 && report.kpis.lastMeasurementDate === '2026-08-11', 'LATEST_WEIGHT_NULL_SAFE');
  assert(
    report.kpis.startWeight === 79
      && report.kpis.weightChange === -2.5
      && report.kpis.targetGap === 6.5,
    'CANONICAL_ALL_TIME_WEIGHT_KPI_AGGREGATION',
  );
  assert(report.kpis.plannedMeals === 5 && report.kpis.completedMeals === 3 && report.kpis.mealAdherencePercentage === 60, 'MEAL_ADHERENCE_AGGREGATION');
  assert(Math.abs(report.kpis.water.averageLiters - (4 / 3)) < 1e-10 && report.kpis.water.trackedDays === 3, 'WATER_NULL_ZERO_AGGREGATION');
  assert(Math.abs(report.kpis.water.goalAchievementPercentage - (100 / 3)) < 1e-10, 'WATER_GOAL_AGGREGATION');
  assert(report.plannedNutrition.calories.total === 1100 && report.plannedNutrition.calories.isComplete === false, 'PLANNED_NUTRITION_COVERAGE');

  const freshApprovedA = await actorClient(approvedA);
  actorProxy.setSupabaseClient(freshApprovedA);
  report = await service.fetchClientAnalytics(clientA.id, '7d', NOW);
  assert(report.kpis.plannedMeals === 5 && report.kpis.currentWeight === 76.5, 'FRESH_SESSION_ANALYTICS_PERSISTED');

  for (const [label, actor, targetClientId] of [
    ['FOREIGN_APPROVED', api.approvedB, clientA.id],
    ['PENDING_WITHOUT_RELATION', api.pending, pendingClient.id],
    ['REJECTED_WITHOUT_RELATION', api.rejected, rejectedClient.id],
    ['MISSING_PROFILE', api.missing, clientA.id],
    ['CLIENT', api.clientA, clientA.id],
    ['ANONYMOUS', api.anonymous, clientA.id],
  ]) {
    actorProxy.setSupabaseClient(actor);
    await assertServiceDenied(
      () => service.fetchClientAnalytics(targetClientId, '7d', NOW),
      service.AnalyticsServiceError,
      `${label}_SERVICE_DENY`,
    );
  }

  const foreignMeasurement = assertNoError(await api.approvedB.from('measurements').select('id,client_id').in('id', measurementIds), 'foreign measurement read');
  const foreignLogs = assertNoError(await api.approvedB.from('daily_logs').select('id,client_id').in('id', dailyLogIds), 'foreign daily log read');
  const foreignPlans = assertNoError(await api.approvedB.from('meal_plans').select('id').eq('dietitian_id', approvedA.id), 'foreign meal plan read');
  assert(foreignMeasurement.length === 1 && foreignMeasurement[0].client_id === clientB.id, 'FOREIGN_MEASUREMENTS_OWN_TENANT_ONLY');
  assert(foreignLogs.length === 1 && foreignLogs[0].client_id === clientB.id, 'FOREIGN_DAILY_LOGS_OWN_TENANT_ONLY');
  assert(foreignPlans.length === 0, 'FOREIGN_MEAL_PLANS_ZERO');

  assertNoError(await admin.from('dietitian_clients').update({ status: 'removed' }).eq('id', relationshipA), 'removed relationship fixture');
  actorProxy.setSupabaseClient(api.approvedA);
  await assertServiceDenied(
    () => service.fetchClientAnalytics(clientA.id, '7d', NOW),
    service.AnalyticsServiceError,
    'REMOVED_RELATIONSHIP_SERVICE_DENY',
  );
  process.stdout.write('ANALYTICS_RUNTIME_MATRIX_PASS\n');
} catch (error) {
  mainError = error;
} finally {
  if (admin) {
    try {
      if (mealIds.length) await admin.from('meals').delete().in('id', mealIds);
      if (mealPlanIds.length) await admin.from('meal_plans').delete().in('id', mealPlanIds);
      if (dailyLogIds.length) await admin.from('daily_logs').delete().in('id', dailyLogIds);
      if (measurementIds.length) await admin.from('measurements').delete().in('id', measurementIds);
      if (clientProfileIds.length) await admin.from('client_profiles').delete().in('user_id', clientProfileIds);
      if (relationshipIds.length) await admin.from('dietitian_clients').delete().in('id', relationshipIds);
      if (actorIds.length) await admin.from('dietitian_subscriptions').delete().in('dietitian_id', actorIds);
      const residue = async (table, column, values, label) => {
        if (values.length === 0) return assert(true, label);
        const rows = assertNoError(await admin.from(table).select(column).in(column, values), `${table} residue check`);
        assert(rows.length === 0, label, `rows=${rows.length}`);
      };
      await residue('meals', 'id', mealIds, 'TEMPORARY_MEALS_ZERO');
      await residue('meal_plans', 'id', mealPlanIds, 'TEMPORARY_MEAL_PLANS_ZERO');
      await residue('daily_logs', 'id', dailyLogIds, 'TEMPORARY_DAILY_LOGS_ZERO');
      await residue('measurements', 'id', measurementIds, 'TEMPORARY_MEASUREMENTS_ZERO');
      await residue('client_profiles', 'user_id', clientProfileIds, 'TEMPORARY_CLIENT_PROFILES_ZERO');
      await residue('dietitian_clients', 'id', relationshipIds, 'TEMPORARY_RELATIONSHIPS_ZERO');
      for (const id of [...actorIds].reverse()) await admin.auth.admin.deleteUser(id);
      const authResidue = [];
      let page = 1;
      while (true) {
        const listed = assertNoError(await admin.auth.admin.listUsers({ page, perPage: 100 }), 'auth residue check');
        authResidue.push(...listed.users.filter(({ id }) => actorIds.includes(id)));
        if (listed.users.length < 100) break;
        page += 1;
      }
      assert(authResidue.length === 0, 'TEMPORARY_AUTH_USERS_ZERO');
      const actorSourceResidue = [
        ...assertNoError(await admin.from('measurements').select('id').in('client_id', actorIds), 'actor measurement residue check'),
        ...assertNoError(await admin.from('daily_logs').select('id').in('client_id', actorIds), 'actor daily log residue check'),
        ...assertNoError(await admin.from('meal_plans').select('id').or(`client_id.in.(${actorIds.join(',')}),dietitian_id.in.(${actorIds.join(',')})`), 'actor meal plan residue check'),
        ...assertNoError(await admin.from('client_profiles').select('user_id').in('user_id', actorIds), 'actor client profile residue check'),
        ...assertNoError(await admin.from('dietitian_clients').select('id').or(`client_id.in.(${actorIds.join(',')}),dietitian_id.in.(${actorIds.join(',')})`), 'actor relationship residue check'),
      ];
      assert(actorSourceResidue.length === 0, 'ACTOR_SOURCE_DATA_RESIDUE_ZERO');
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
      if (mainError && stackStarted) mainError.message += `; local stack stop failed: ${stopError.message}`;
      else if (!mainError) mainError = stopError;
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

if (mainError) throw mainError;
