import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import {
  existsSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

import { createClient } from '@supabase/supabase-js';

import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';
import { addCurrentIsolatedMigrations } from './addCurrentIsolatedMigrations.mjs';

/**
 * MVP-7 disposable runtime harness.
 *
 * Proves that dietitian client-limit enforcement is server-side and fail-closed
 * against a real Postgres/PostgREST/Auth stack, and that the subscription
 * overview RPC reports authoritative usage. No production access; every fixture
 * is torn down and residue is asserted to be zero.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-MVP7-Only-7c!';
const MVP7_MIGRATION_FILE = '20260812090000_mvp7_subscription_plans_and_client_limits.sql';
const projectId = `dietbridge-mvp7-${process.pid}-${randomUUID().slice(0, 8)}`;
const npxCli = process.env.npm_execpath
  ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const actorIds = [];
const relationshipIds = [];
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

const findFreeLoopbackPort = () => new Promise((resolvePort, rejectPort) => {
  const server = createServer();
  server.once('error', rejectPort);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : null;
    server.close((closeError) => {
      if (closeError) rejectPort(closeError);
      else if (port) resolvePort(port);
      else rejectPort(new Error('Unable to allocate a disposable loopback port.'));
    });
  });
});

const allocateDisposablePorts = async () => {
  const ports = await Promise.all(Array.from({ length: 8 }, () => findFreeLoopbackPort()));
  return {
    api: ports[0],
    db: ports[1],
    shadow: ports[2],
    pooler: ports[3],
    studio: ports[4],
    smtp: ports[5],
    analytics: ports[6],
    functionsInspector: ports[7],
  };
};

const applyDisposablePorts = (configText, ports) => {
  const portMap = new Map([
    [54321, ports.api],
    [54322, ports.db],
    [54320, ports.shadow],
    [54329, ports.pooler],
    [54323, ports.studio],
    [54324, ports.smtp],
    [54327, ports.analytics],
    [8083, ports.functionsInspector],
  ]);
  return configText.replace(/^port\s*=\s*(\d+)$/gm, (line, value) => {
    const replacement = portMap.get(Number(value));
    return replacement ? `port = ${replacement}` : line;
  });
};

const anonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActor = async (label, role) => {
  const email = `mvp7-${label}-${randomUUID()}@example.invalid`;
  const data = assertNoError(await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: `Disposable ${label}`,
      mvp7_harness: 'disposable-test-identity',
    },
  }), `${label} auth fixture`);
  assert(data.user?.id, `${label.toUpperCase()}_AUTH_CREATED`);
  actorIds.push(data.user.id);
  return { id: data.user.id, email, label, role, disposableTestIdentity: true };
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
  assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: status,
    is_verified: status === 'approved',
    verified_at: status === 'approved' ? new Date().toISOString() : null,
  }).eq('user_id', actor.id).select('user_id').single(), `${actor.label} verification fixture`);
};

const setPlan = async (dietitian, planId, subStatus = 'active', clientLimitOverride) => {
  const payload = {
    dietitian_id: dietitian.id,
    plan_id: planId,
    status: subStatus,
    client_limit_override: clientLimitOverride ?? null,
  };
  assertNoError(await admin.from('dietitian_subscriptions').upsert(payload)
    .select('dietitian_id').single(), `${dietitian.label} plan ${planId}/${subStatus}`);
};

const bootstrapDisposableCore = async (dietitian) => {
  assert(
    local.API_URL.startsWith('http://127.0.0.1:') || local.API_URL.startsWith('http://localhost:'),
    'DISPOSABLE_BOOTSTRAP_LOOPBACK_ONLY',
  );
  assert(
    dietitian.role === 'dietitian'
      && dietitian.disposableTestIdentity === true
      && dietitian.email.endsWith('@example.invalid'),
    'DISPOSABLE_BOOTSTRAP_IDENTITY_EXPLICITLY_VERIFIED',
    dietitian.email,
  );
  const user = assertNoError(
    await admin.auth.admin.getUserById(dietitian.id),
    `${dietitian.label} bootstrap Auth identity read`,
  );
  assert(
    user.user?.user_metadata?.mvp7_harness === 'disposable-test-identity',
    'DISPOSABLE_BOOTSTRAP_METADATA_VERIFIED',
    dietitian.email,
  );
  const profile = assertNoError(
    await admin.from('profiles').select('id,role').eq('id', dietitian.id).single(),
    `${dietitian.label} bootstrap profile read`,
  );
  const dietitianProfile = assertNoError(
    await admin.from('dietitian_profiles')
      .select('user_id,verification_status,is_verified')
      .eq('user_id', dietitian.id)
      .single(),
    `${dietitian.label} bootstrap dietitian profile read`,
  );
  assert(
    profile.role === 'dietitian'
      && dietitianProfile.verification_status === 'approved'
      && dietitianProfile.is_verified === true,
    'DISPOSABLE_BOOTSTRAP_APPROVED_DIETITIAN_VERIFIED',
    dietitian.email,
  );
  await setPlan(dietitian, 'core', 'active');
  pass('DISPOSABLE_TEST_CORE_BOOTSTRAP', dietitian.email);
};

const seedRelationship = async (dietitian, client, status = 'active') => {
  const inserted = await admin.from('dietitian_clients')
    .insert({ dietitian_id: dietitian.id, client_id: client.id, status: 'pending' })
    .select('id').single();
  if (inserted.error) return { error: inserted.error };
  relationshipIds.push(inserted.data.id);
  if (status === 'active') {
    const activated = await admin.from('dietitian_clients')
      .update({ status: 'active' }).eq('id', inserted.data.id).select('id,status').single();
    if (activated.error) return { error: activated.error };
  }
  return { id: inserted.data.id };
};

const trackRel = async (dietitian, client, label) => {
  const rel = assertNoError(
    await admin.from('dietitian_clients').select('id').eq('dietitian_id', dietitian.id).eq('client_id', client.id).single(),
    label,
  );
  relationshipIds.push(rel.id);
  return rel.id;
};

try {
  try {
    disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
    addCurrentIsolatedMigrations({ repoRoot, tempRoot: disposable.tempRoot });
  } catch (error) {
    const retainedPath = /; disposable workdir retained at (.+)$/.exec(error instanceof Error ? error.message : '');
    if (retainedPath) retainedMaterializationTempParent = dirname(retainedPath[1]);
    throw error;
  }
  const ports = await allocateDisposablePorts();
  const configText = applyDisposablePorts(readFileSync(disposable.configPath, 'utf8'), ports);
  assert(/^project_id\s*=\s*"[^"]+"/m.test(configText), 'DISPOSABLE_CONFIG_PROJECT_ID_PRESENT');
  writeFileSync(disposable.configPath, configText.replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`), 'utf8');

  const mvp7MigrationPath = join(disposable.tempRoot, 'supabase', 'migrations', MVP7_MIGRATION_FILE);
  const deferredMvp7MigrationPath = `${mvp7MigrationPath}.deferred`;
  assert(existsSync(mvp7MigrationPath), 'MVP7_MIGRATION_PRESENT_IN_DISPOSABLE_REPLAY');

  stackStartAttempted = true;
  renameSync(mvp7MigrationPath, deferredMvp7MigrationPath);
  cli(['start']);
  stackStarted = true;
  pass('DISPOSABLE_LOCAL_STACK_STARTED', `project=${projectId}`);
  cli(['db', 'reset', '--local', '--no-seed']);

  local = parseStatus(cli(['status', '--output', 'env']));
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? ''), 'LOOPBACK_API_GUARD', local.API_URL);
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'LOCAL_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Create one pre-existing dietitian before MVP-7 is applied. The migration
  // must not create a commercial entitlement for this existing identity.
  const legacyDiet = await createActor('legacy-dietitian', 'dietitian');
  await verifyDietitian(legacyDiet, 'approved');
  renameSync(deferredMvp7MigrationPath, mvp7MigrationPath);
  cli(['migration', 'up', '--local', '--include-all']);
  // `migration up` applies the SQL after PostgREST has started. Refresh the
  // disposable schema cache before the first REST read of the new tables;
  // this is local harness plumbing only and does not modify migration history.
  cli(['db', 'query', '--local', "notify pgrst, 'reload schema';"]);
  pass('DISPOSABLE_POSTGREST_SCHEMA_RELOADED');
  pass('DISPOSABLE_MIGRATION_REPLAY');
  const legacySubscriptions = assertNoError(
    await admin.from('dietitian_subscriptions')
      .select('dietitian_id,plan_id,status,client_limit_override')
      .eq('dietitian_id', legacyDiet.id),
    'legacy subscription absence read',
  );
  assert(legacySubscriptions.length === 0, 'EXISTING_DIETITIAN_NOT_AUTO_ENTITLED');

  const plans = assertNoError(await admin.from('subscription_plans').select('id,client_limit,is_active').order('sort_order'), 'plan catalog read');
  const planLimit = Object.fromEntries(plans.map((p) => [p.id, p.client_limit]));
  assert(
    plans.length === 3
      && planLimit.core === 10
      && planLimit.plus === 30
      && planLimit.scale === 50
      && !('free' in planLimit)
      && !('pro' in planLimit)
      && !('premium' in planLimit),
    'CANONICAL_PLAN_LIMITS',
    JSON.stringify(planLimit),
  );

  const nonScaleOverride = await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: legacyDiet.id,
    plan_id: 'core',
    status: 'active',
    client_limit_override: 51,
  }).select('dietitian_id').single();
  assert(Boolean(nonScaleOverride.error), 'NON_SCALE_OVERRIDE_REJECTED', nonScaleOverride.error?.message ?? 'no error');

  const nonAbove50ScaleOverride = await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: legacyDiet.id,
    plan_id: 'scale',
    status: 'active',
    client_limit_override: 50,
  }).select('dietitian_id').single();
  assert(Boolean(nonAbove50ScaleOverride.error), 'SCALE_BASE_OVERRIDE_REJECTED', nonAbove50ScaleOverride.error?.message ?? 'no error');

  const dietA = await createActor('dietitian-a', 'dietitian');
  const dietB = await createActor('dietitian-b', 'dietitian');
  const pendingDiet = await createActor('pending-dietitian', 'dietitian');
  await verifyDietitian(dietA, 'approved');
  await verifyDietitian(dietB, 'approved');
  await verifyDietitian(pendingDiet, 'pending');

  const clients = [];
  for (let i = 0; i < 78; i += 1) clients.push(await createActor(`client-${i}`, 'client'));

  const apiA = await actorClient(dietA);
  const apiB = await actorClient(dietB);
  const anon = anonymousClient();

  // Only explicitly identified disposable test dietitians receive a local
  // Core bootstrap. The migration itself never creates this entitlement.
  await bootstrapDisposableCore(dietA);
  await bootstrapDisposableCore(dietB);

  const legacyApi = await actorClient(legacyDiet);
  const noSubscriptionOverview = assertNoError(
    await legacyApi.rpc('get_dietitian_subscription_overview'),
    'no-subscription overview',
  );
  assert(
    noSubscriptionOverview[0].plan_id === null
      && noSubscriptionOverview[0].plan_name === null
      && noSubscriptionOverview[0].subscription_status === null
      && noSubscriptionOverview[0].effective_limit === 0
      && noSubscriptionOverview[0].limit_reached === true,
    'NO_SUBSCRIPTION_IS_ZERO_LIMIT',
    JSON.stringify(noSubscriptionOverview[0]),
  );
  const noSubscriptionRequest = assertNoError(
    await legacyApi.rpc('request_client_connection_by_email', { p_email: clients[0].email }),
    'no-subscription add request',
  );
  assert(noSubscriptionRequest === 'limit_reached', 'NO_SUBSCRIPTION_RPC_REFUSED', noSubscriptionRequest);
  const noSubscriptionDirect = await seedRelationship(legacyDiet, clients[1], 'active');
  assert(Boolean(noSubscriptionDirect.error), 'NO_SUBSCRIPTION_DIRECT_INSERT_DENIED', noSubscriptionDirect.error?.message ?? 'no error');

  // Every non-entitled subscription status is zero-limit. The catalog FK
  // prevents an unknown plan row; the migration helper also fails closed if
  // catalog drift ever bypasses that invariant.
  for (const status of ['canceled', 'inactive', 'past_due']) {
    await setPlan(dietA, 'core', status);
    const statusOverview = assertNoError(
      await apiA.rpc('get_dietitian_subscription_overview'),
      `${status} overview`,
    );
    assert(
      statusOverview[0].subscription_status === status
        && statusOverview[0].effective_limit === 0
        && statusOverview[0].limit_reached === true,
      `${status.toUpperCase()}_ZERO_LIMIT`,
      JSON.stringify(statusOverview[0]),
    );
  }

  // limit = 0: a not-entitled subscription blocks everything.
  await setPlan(dietA, 'core', 'canceled');
  const zeroLimitOverview = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'zero-limit overview');
  assert(zeroLimitOverview[0].effective_limit === 0 && zeroLimitOverview[0].limit_reached === true, 'CANCELED_SUB_ZERO_LIMIT');
  const zeroSeed = await seedRelationship(dietA, clients[0], 'active');
  assert(Boolean(zeroSeed.error), 'ZERO_LIMIT_DIRECT_INSERT_DENIED', zeroSeed.error?.message ?? 'no error');

  // Core = 10: below-limit, exactly-at-limit, and over-limit paths all use the
  // real commercial tier rather than a synthetic test plan.
  await setPlan(dietA, 'core', 'active');
  const coreOverview = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'Core overview');
  assert(
    coreOverview[0].plan_id === 'core'
      && coreOverview[0].plan_limit === 10
      && coreOverview[0].effective_limit === 10,
    'CORE_LIMIT_IS_10',
    JSON.stringify(coreOverview[0]),
  );
  for (let i = 0; i < 10; i += 1) {
    const result = assertNoError(
      await apiA.rpc('request_client_connection_by_email', { p_email: clients[i].email }),
      `Core request ${i + 1}`,
    );
    assert(result === 'requested', i === 0 ? 'CORE_BELOW_LIMIT_REQUEST_OK' : `CORE_REQUEST_${i + 1}_OK`, result);
    await trackRel(dietA, clients[i], `track Core rel ${i + 1}`);
  }
  const coreAtLimit = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'Core at-limit overview');
  assert(
    coreAtLimit[0].used === 10
      && coreAtLimit[0].remaining === 0
      && coreAtLimit[0].limit_reached === true,
    'CORE_AT_LIMIT_RECONCILES',
    JSON.stringify(coreAtLimit[0]),
  );
  const coreAboveLimit = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[10].email }), 'Core above-limit request');
  assert(coreAboveLimit === 'limit_reached', 'CORE_ABOVE_LIMIT_RPC_REFUSED', coreAboveLimit);
  const coreDirectOverLimit = await seedRelationship(dietA, clients[10], 'active');
  assert(Boolean(coreDirectOverLimit.error), 'CORE_ABOVE_LIMIT_DIRECT_INSERT_DENIED', coreDirectOverLimit.error?.message ?? 'no error');
  const coreDirectActiveOverLimit = await admin.from('dietitian_clients')
    .insert({ dietitian_id: dietA.id, client_id: clients[11].id, status: 'active' })
    .select('id').single();
  assert(Boolean(coreDirectActiveOverLimit.error), 'CORE_ACTIVE_INSERT_OVER_LIMIT_DENIED', coreDirectActiveOverLimit.error?.message ?? 'no error');

  // pending -> active acceptance does not consume another slot and remains
  // allowed at the exact capacity boundary.
  const rel0 = assertNoError(await admin.from('dietitian_clients').select('id').eq('dietitian_id', dietA.id).eq('client_id', clients[0].id).single(), 'find Core relation to activate');
  const clientAApi = await actorClient(clients[0]);
  const accepted = await clientAApi.from('dietitian_clients').update({ status: 'active' }).eq('id', rel0.id).select('id,status').maybeSingle();
  assert(!accepted.error && accepted.data?.status === 'active', 'CLIENT_ACCEPT_AT_CORE_LIMIT_ALLOWED', accepted.error?.message ?? '');

  // Upgrade Core -> Plus frees capacity. Fill Plus to its exact limit of 30,
  // then assert the 31st relationship is refused.
  await setPlan(dietA, 'plus', 'active');
  const plusUpgradeOverview = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'Plus upgrade overview');
  assert(plusUpgradeOverview[0].effective_limit === 30 && plusUpgradeOverview[0].used === 10, 'CORE_TO_PLUS_UPGRADE', JSON.stringify(plusUpgradeOverview[0]));
  for (let i = 10; i < 30; i += 1) {
    const result = assertNoError(
      await apiA.rpc('request_client_connection_by_email', { p_email: clients[i].email }),
      `Plus request ${i + 1}`,
    );
    assert(result === 'requested', `PLUS_REQUEST_${i + 1}_OK`, result);
    await trackRel(dietA, clients[i], `track Plus rel ${i + 1}`);
  }
  const plusAtLimit = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'Plus at-limit overview');
  assert(plusAtLimit[0].used === 30 && plusAtLimit[0].remaining === 0 && plusAtLimit[0].limit_reached === true, 'PLUS_AT_LIMIT_RECONCILES', JSON.stringify(plusAtLimit[0]));
  const plusAboveLimit = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[30].email }), 'Plus above-limit request');
  assert(plusAboveLimit === 'limit_reached', 'PLUS_ABOVE_LIMIT_RPC_REFUSED', plusAboveLimit);

  // Upgrade Plus -> Scale and exercise the bounded 50-client base tier.
  await setPlan(dietA, 'scale', 'active');
  const scaleUpgradeOverview = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'Scale upgrade overview');
  assert(scaleUpgradeOverview[0].effective_limit === 50 && scaleUpgradeOverview[0].plan_limit === 50, 'PLUS_TO_SCALE_UPGRADE', JSON.stringify(scaleUpgradeOverview[0]));
  for (let i = 30; i < 50; i += 1) {
    const result = assertNoError(
      await apiA.rpc('request_client_connection_by_email', { p_email: clients[i].email }),
      `Scale request ${i + 1}`,
    );
    assert(result === 'requested', `SCALE_REQUEST_${i + 1}_OK`, result);
    await trackRel(dietA, clients[i], `track Scale rel ${i + 1}`);
  }
  const scaleAtLimit = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'Scale at-limit overview');
  assert(scaleAtLimit[0].used === 50 && scaleAtLimit[0].remaining === 0 && scaleAtLimit[0].limit_reached === true, 'SCALE_AT_50_LIMIT_RECONCILES', JSON.stringify(scaleAtLimit[0]));
  const scaleAboveLimit = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[50].email }), 'Scale above-limit request');
  assert(scaleAboveLimit === 'limit_reached', 'SCALE_ABOVE_50_RPC_REFUSED', scaleAboveLimit);
  const scaleDirectOverLimit = await seedRelationship(dietA, clients[50], 'active');
  assert(Boolean(scaleDirectOverLimit.error), 'SCALE_ABOVE_50_DIRECT_INSERT_DENIED', scaleDirectOverLimit.error?.message ?? 'no error');
  const scaleDirectActiveOverLimit = await admin.from('dietitian_clients')
    .insert({ dietitian_id: dietA.id, client_id: clients[51].id, status: 'active' })
    .select('id').single();
  assert(Boolean(scaleDirectActiveOverLimit.error), 'SCALE_ACTIVE_INSERT_OVER_LIMIT_DENIED', scaleDirectActiveOverLimit.error?.message ?? 'no error');

  // Scale is not unlimited: a future per-account override of 75 is explicit,
  // bounded and visible as effective_limit while plan_limit remains 50.
  await setPlan(dietA, 'scale', 'active', 75);
  const scaleOverrideOverview = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'Scale override overview');
  assert(scaleOverrideOverview[0].plan_limit === 50 && scaleOverrideOverview[0].effective_limit === 75, 'SCALE_OVERRIDE_75_IS_EFFECTIVE', JSON.stringify(scaleOverrideOverview[0]));
  for (let i = 50; i < 75; i += 1) {
    const result = assertNoError(
      await apiA.rpc('request_client_connection_by_email', { p_email: clients[i].email }),
      `Scale override request ${i + 1}`,
    );
    assert(result === 'requested', `SCALE_OVERRIDE_REQUEST_${i + 1}_OK`, result);
    await trackRel(dietA, clients[i], `track Scale override rel ${i + 1}`);
  }
  const scaleOverrideAtLimit = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'Scale override at-limit overview');
  assert(scaleOverrideAtLimit[0].used === 75 && scaleOverrideAtLimit[0].remaining === 0 && scaleOverrideAtLimit[0].limit_reached === true, 'SCALE_OVERRIDE_AT_75_RECONCILES', JSON.stringify(scaleOverrideAtLimit[0]));
  const scaleOverrideAboveLimit = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[75].email }), 'Scale override above-limit request');
  assert(scaleOverrideAboveLimit === 'limit_reached', 'SCALE_OVERRIDE_ABOVE_75_RPC_REFUSED', scaleOverrideAboveLimit);

  // Downgrade preserves existing relationships but blocks new capacity.
  await setPlan(dietA, 'plus', 'active');
  const downgradeOverview = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'downgrade overview');
  assert(downgradeOverview[0].effective_limit === 30 && downgradeOverview[0].used === 75, 'DOWNGRADE_PRESERVES_EXISTING_USAGE', JSON.stringify(downgradeOverview[0]));
  const downgradeBlocked = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[75].email }), 'downgrade blocked request');
  assert(downgradeBlocked === 'limit_reached', 'DOWNGRADE_BLOCKS_NEW_CLIENT', downgradeBlocked);

  // Remove 45 relationships from the overfull downgraded account, leaving
  // exactly Plus capacity in use. Reactivating one removed relationship must
  // still be refused at the boundary.
  const removedForReactivation = assertNoError(
    await admin.from('dietitian_clients')
      .update({ status: 'removed' })
      .eq('dietitian_id', dietA.id)
      .in('client_id', clients.slice(0, 45).map(({ id }) => id))
      .select('id'),
    'remove relations for reactivation test',
  );
  assert(removedForReactivation.length === 45, 'REACTIVATION_FIXTURE_AT_PLUS_LIMIT', `removed=${removedForReactivation.length}`);
  const plusReactivateAtLimit = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[0].email }), 'Plus reactivation at-limit request');
  assert(plusReactivateAtLimit === 'limit_reached', 'REACTIVATION_AT_PLUS_LIMIT_REFUSED', plusReactivateAtLimit);

  // tenant isolation.
  const foreignSub = assertNoError(await apiB.from('dietitian_subscriptions').select('dietitian_id').eq('dietitian_id', dietA.id), 'foreign subscription read');
  assert(foreignSub.length === 0, 'FOREIGN_SUBSCRIPTION_NOT_READABLE');
  const bOverview = assertNoError(await apiB.rpc('get_dietitian_subscription_overview'), 'B overview');
  assert(bOverview[0].used === 0 && bOverview[0].plan_id === 'core' && bOverview[0].effective_limit === 10, 'BOOTSTRAPPED_TEST_DIETITIAN_HAS_CORE_LIMIT', JSON.stringify(bOverview[0]));
  const bootstrappedTestRequest = assertNoError(await apiB.rpc('request_client_connection_by_email', { p_email: clients[76].email }), 'bootstrapped test add request');
  assert(bootstrappedTestRequest === 'requested', 'BOOTSTRAPPED_TEST_DIETITIAN_CAN_ADD_CLIENT', bootstrappedTestRequest);
  await trackRel(dietB, clients[76], 'track bootstrapped test relation');
  const anonPlans = await anon.from('subscription_plans').select('id');
  assert((anonPlans.data ?? []).length === 0, 'ANON_PLAN_CATALOG_DENIED');
  const anonOverview = await anon.rpc('get_dietitian_subscription_overview');
  assert(Boolean(anonOverview.error), 'ANON_OVERVIEW_RPC_DENIED', anonOverview.error?.message ?? 'no error');
  const pendingApi = await actorClient(pendingDiet);
  // A pending (not-yet-approved) dietitian is not an entitled dietitian:
  // is_current_user_dietitian() requires approved+verified. The overview RPC
  // therefore fails closed for pending/rejected actors, matching the auth gate
  // that keeps them out of the protected app entirely.
  const pendingOverview = await pendingApi.rpc('get_dietitian_subscription_overview');
  assert(
    Boolean(pendingOverview.error),
    'PENDING_DIETITIAN_OVERVIEW_DENIED',
    pendingOverview.error ? pendingOverview.error.message : `data=${JSON.stringify(pendingOverview.data)}`,
  );

  process.stdout.write('SUBSCRIPTION_RUNTIME_MATRIX_PASS\n');
} catch (error) {
  mainError = error;
} finally {
  if (admin) {
    try {
      if (relationshipIds.length) await admin.from('dietitian_clients').delete().in('id', relationshipIds);
      if (actorIds.length) await admin.from('dietitian_subscriptions').delete().in('dietitian_id', actorIds);
      await admin.from('subscription_plans').delete().eq('id', 'test_tiny');
      const relResidue = actorIds.length
        ? assertNoError(await admin.from('dietitian_clients').select('id').or(`client_id.in.(${actorIds.join(',')}),dietitian_id.in.(${actorIds.join(',')})`), 'relationship residue check')
        : [];
      assert(relResidue.length === 0, 'TEMPORARY_RELATIONSHIPS_ZERO', `rows=${relResidue.length}`);
      const subResidue = actorIds.length
        ? assertNoError(await admin.from('dietitian_subscriptions').select('dietitian_id').in('dietitian_id', actorIds), 'subscription residue check')
        : [];
      assert(subResidue.length === 0, 'TEMPORARY_SUBSCRIPTIONS_ZERO', `rows=${subResidue.length}`);
      const tinyResidue = assertNoError(await admin.from('subscription_plans').select('id').eq('id', 'test_tiny'), 'tiny plan residue check');
      assert(tinyResidue.length === 0, 'TEMPORARY_TEST_PLAN_ZERO');
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
process.stdout.write('MVP7_SUBSCRIPTION_RUNTIME_HARNESS_PASS\n');
