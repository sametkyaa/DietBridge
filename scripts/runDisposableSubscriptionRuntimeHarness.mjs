import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

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
const projectId = `dietbridge-mvp7-${process.pid}-${randomUUID().slice(0, 8)}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
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

const anonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActor = async (label, role) => {
  const email = `mvp7-${label}-${randomUUID()}@example.invalid`;
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
  assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: status,
    is_verified: status === 'approved',
    verified_at: status === 'approved' ? new Date().toISOString() : null,
  }).eq('user_id', actor.id).select('user_id').single(), `${actor.label} verification fixture`);
};

const setPlan = async (dietitian, planId, subStatus = 'active') => {
  assertNoError(await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: dietitian.id, plan_id: planId, status: subStatus,
  }).select('dietitian_id').single(), `${dietitian.label} plan ${planId}/${subStatus}`);
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
  pass('DISPOSABLE_MIGRATION_REPLAY');

  local = parseStatus(cli(['status', '--output', 'env']));
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? ''), 'LOOPBACK_API_GUARD', local.API_URL);
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'LOCAL_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const plans = assertNoError(await admin.from('subscription_plans').select('id,client_limit,is_active').order('sort_order'), 'plan catalog read');
  const planLimit = Object.fromEntries(plans.map((p) => [p.id, p.client_limit]));
  assert(planLimit.free === 10 && planLimit.pro === 50 && planLimit.premium === 200, 'CANONICAL_PLAN_LIMITS', JSON.stringify(planLimit));

  const dietA = await createActor('dietitian-a', 'dietitian');
  const dietB = await createActor('dietitian-b', 'dietitian');
  const pendingDiet = await createActor('pending-dietitian', 'dietitian');
  await verifyDietitian(dietA, 'approved');
  await verifyDietitian(dietB, 'approved');
  await verifyDietitian(pendingDiet, 'pending');

  const clients = [];
  for (let i = 0; i < 6; i += 1) clients.push(await createActor(`client-${i}`, 'client'));

  const apiA = await actorClient(dietA);
  const apiB = await actorClient(dietB);
  const anon = anonymousClient();

  // limit = 0: a not-entitled subscription blocks everything.
  await setPlan(dietA, 'pro', 'canceled');
  const zeroLimitOverview = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'zero-limit overview');
  assert(zeroLimitOverview[0].effective_limit === 0 && zeroLimitOverview[0].limit_reached === true, 'CANCELED_SUB_ZERO_LIMIT');
  const zeroSeed = await seedRelationship(dietA, clients[0], 'active');
  assert(Boolean(zeroSeed.error), 'ZERO_LIMIT_DIRECT_INSERT_DENIED', zeroSeed.error?.message ?? 'no error');

  // free plan default (no subscription row) enforces 10.
  await admin.from('dietitian_subscriptions').delete().eq('dietitian_id', dietA.id);
  const defaultOverview = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'default overview');
  assert(defaultOverview[0].plan_id === 'free' && defaultOverview[0].effective_limit === 10, 'NO_SUB_DEFAULTS_TO_FREE');

  // Small custom plan to make boundary testing cheap.
  assertNoError(await admin.from('subscription_plans').insert({ id: 'test_tiny', name: 'Tiny', client_limit: 2, is_active: true, sort_order: 99 }).select('id').single(), 'tiny plan fixture');
  await setPlan(dietA, 'test_tiny', 'active');

  const r1 = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[0].email }), 'request 1');
  assert(r1 === 'requested', 'BELOW_LIMIT_REQUEST_OK', r1);
  await trackRel(dietA, clients[0], 'track rel1');
  const r2 = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[1].email }), 'request 2');
  assert(r2 === 'requested', 'AT_LIMIT_SECOND_REQUEST_OK', r2);
  await trackRel(dietA, clients[1], 'track rel2');
  const r3 = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[2].email }), 'request 3');
  assert(r3 === 'limit_reached', 'ABOVE_LIMIT_RPC_REFUSED', r3);
  const directOverLimit = await seedRelationship(dietA, clients[2], 'active');
  assert(Boolean(directOverLimit.error), 'ABOVE_LIMIT_DIRECT_INSERT_DENIED', directOverLimit.error?.message ?? 'no error');

  const filledOverview = assertNoError(await apiA.rpc('get_dietitian_subscription_overview'), 'filled overview');
  assert(filledOverview[0].used === 2 && filledOverview[0].remaining === 0 && filledOverview[0].limit_reached === true, 'USAGE_RECONCILES_AT_LIMIT', JSON.stringify(filledOverview[0]));

  // client accept (pending -> active) is not blocked even at the limit.
  const rel0 = assertNoError(await admin.from('dietitian_clients').select('id').eq('dietitian_id', dietA.id).eq('client_id', clients[0].id).single(), 'find rel to activate');
  const clientAApi = await actorClient(clients[0]);
  const accepted = await clientAApi.from('dietitian_clients').update({ status: 'active' }).eq('id', rel0.id).select('id,status').maybeSingle();
  assert(!accepted.error && accepted.data?.status === 'active', 'CLIENT_ACCEPT_AT_LIMIT_ALLOWED', accepted.error?.message ?? '');

  // plan change up frees capacity.
  await setPlan(dietA, 'pro', 'active');
  const r4 = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[2].email }), 'request 4 after upgrade');
  assert(r4 === 'requested', 'UPGRADE_ALLOWS_NEW_CLIENT', r4);
  await trackRel(dietA, clients[2], 'track rel4');

  // plan change down blocks new adds without deleting existing.
  await setPlan(dietA, 'test_tiny', 'active');
  const r5 = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[3].email }), 'request 5 after downgrade');
  assert(r5 === 'limit_reached', 'DOWNGRADE_BLOCKS_NEW_CLIENT', r5);

  // reactivation of a removed relationship is capacity-checked.
  assertNoError(await admin.from('dietitian_clients').update({ status: 'removed' }).eq('id', rel0.id).select('id').single(), 'remove for reactivation test');
  await setPlan(dietA, 'test_tiny', 'active');
  const reactivate = assertNoError(await apiA.rpc('request_client_connection_by_email', { p_email: clients[0].email }), 'reactivation at limit');
  assert(reactivate === 'limit_reached', 'REACTIVATION_AT_LIMIT_REFUSED', reactivate);

  // tenant isolation.
  const foreignSub = assertNoError(await apiB.from('dietitian_subscriptions').select('dietitian_id').eq('dietitian_id', dietA.id), 'foreign subscription read');
  assert(foreignSub.length === 0, 'FOREIGN_SUBSCRIPTION_NOT_READABLE');
  const bOverview = assertNoError(await apiB.rpc('get_dietitian_subscription_overview'), 'B overview');
  assert(bOverview[0].used === 0 && bOverview[0].plan_id === 'free', 'TENANT_B_USAGE_INDEPENDENT', JSON.stringify(bOverview[0]));
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
