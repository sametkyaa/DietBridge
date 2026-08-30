import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-MVP5-Only-9b!';
const projectId = `dietbridge-mvp5-${process.pid}-${randomUUID().slice(0, 8)}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const actorIds = [];
const taskIds = [];
const relationshipIds = [];
let disposable;
let local;
let admin;
let stackStarted = false;
let stackStartAttempted = false;
let mainError;

const cleanEnvironment = ({
  SUPABASE_ACCESS_TOKEN: _accessToken,
  SUPABASE_TOKEN: _token,
  SUPABASE_DB_PASSWORD: _databasePassword,
  SUPABASE_SERVICE_ROLE_KEY: _serviceRole,
  SUPABASE_URL: _remoteUrl,
  SUPABASE_ANON_KEY: _remoteAnon,
  VITE_SUPABASE_URL: _remoteViteUrl,
  VITE_SUPABASE_ANON_KEY: _remoteViteAnon,
  ...environment
}) => ({ ...environment, TZ: 'Europe/Istanbul' });

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

const pass = (label, detail = '') => {
  process.stdout.write(`PASS: ${label}${detail ? ` ${detail}` : ''}\n`);
};

const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  pass(label, detail);
};

const assertNoError = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

const assertNoRows = (result, label) => {
  if (result.error) {
    pass(label, `denied=${result.error.code ?? result.error.name ?? 'error'}`);
    return;
  }
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  assert(rows.length === 0, label, `unexpected_rows=${rows.length}`);
};

const parseStatus = (value) => Object.fromEntries(value.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
  .filter(Boolean)
  .map((match) => [match[1], match[2]]));

const anonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActor = async (label, role) => {
  const email = `mvp5-${label}-${randomUUID()}@example.invalid`;
  const result = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: `Disposable ${label}`,
      mvp7_harness: 'disposable-test-identity',
    },
  });
  const user = assertNoError(result, `${label} auth fixture`);
  assert(user.user?.id, `${label.toUpperCase()}_AUTH_CREATED`);
  actorIds.push(user.user.id);
  return { id: user.user.id, email, label, role, disposableTestIdentity: true };
};

const actorClient = async (actor) => {
  const signIn = anonymousClient();
  const session = assertNoError(
    await signIn.auth.signInWithPassword({ email: actor.email, password: PASSWORD }),
    `${actor.label} local sign-in`,
  );
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const verifyDietitian = async (actor, verificationStatus) => {
  const result = await admin.from('dietitian_profiles').update({
    verification_status: verificationStatus,
    is_verified: verificationStatus === 'approved',
    verified_at: verificationStatus === 'approved' ? new Date().toISOString() : null,
    rejection_reason: verificationStatus === 'rejected' ? 'Disposable rejection' : null,
  }).eq('user_id', actor.id).select('user_id,verification_status,is_verified').single();
  const row = assertNoError(result, `${actor.label} verification fixture`);
  assert(
    row.verification_status === verificationStatus,
    `${actor.label.toUpperCase()}_${verificationStatus.toUpperCase()}_FIXTURE`,
  );
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
  assertNoError(
    await admin.from('dietitian_subscriptions').upsert({
      dietitian_id: dietitian.id,
      plan_id: 'core',
      status: 'active',
      client_limit_override: null,
    }).select('dietitian_id').single(),
    `${dietitian.label} disposable Core bootstrap`,
  );
  pass('DISPOSABLE_TEST_CORE_BOOTSTRAP', dietitian.email);
};

const activateRelationship = async (dietitian, client) => {
  let result = await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id,
    client_id: client.id,
    status: 'pending',
  }).select('id').single();
  const pending = assertNoError(result, 'relationship pending fixture');
  relationshipIds.push(pending.id);
  result = await admin.from('dietitian_clients').update({ status: 'active' })
    .eq('id', pending.id).select('id,status,accepted_at').single();
  const active = assertNoError(result, 'relationship active fixture');
  assert(active.status === 'active' && Boolean(active.accepted_at), 'ACTIVE_RELATIONSHIP_FIXTURE');
  return active.id;
};

const directTaskPayload = (dietitianId, clientId, title) => ({
  dietitian_id: dietitianId,
  client_id: clientId,
  title,
  description: 'Disposable runtime task',
  due_date: '2099-12-01',
  due_time: '09:30',
  priority: 'medium',
  status: 'pending',
  completed_at: null,
});

const taskDraft = (overrides = {}) => ({
  clientId: null,
  title: 'Disposable general task',
  description: 'Disposable runtime task',
  dueDate: '2099-12-01',
  dueTime: '09:30',
  priority: 'medium',
  ...overrides,
});

const compileDailyTaskService = () => {
  const sourceRoot = join(disposable.tempRoot, 'daily-task-service-source');
  const buildRoot = join(disposable.tempRoot, 'daily-task-service-build');
  const sources = [
    'features/dashboard/services/dailyTaskService.ts',
    'features/dashboard/types/dailyTask.ts',
    'features/dashboard/utils/dailyTaskContract.ts',
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
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 });
  const require = createRequire(import.meta.url);
  return {
    service: require(join(buildRoot, 'features', 'dashboard', 'services', 'dailyTaskService.js')),
    actorProxy: require(join(buildRoot, 'lib', 'supabaseClient.js')),
  };
};

const assertServiceError = async (operation, ServiceError, label) => {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof ServiceError, label, `unexpected=${error?.constructor?.name ?? typeof error}`);
    return;
  }
  throw new Error(`${label}: operation unexpectedly succeeded`);
};

try {
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  const configText = readFileSync(disposable.configPath, 'utf8');
  assert(/^project_id\s*=\s*"[^"]+"/m.test(configText), 'DISPOSABLE_CONFIG_PROJECT_ID_PRESENT');
  writeFileSync(
    disposable.configPath,
    configText.replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`),
    'utf8',
  );

  stackStartAttempted = true;
  cli(['start']);
  stackStarted = true;
  pass('DISPOSABLE_LOCAL_STACK_STARTED', `project=${projectId}`);
  cli(['db', 'reset', '--local', '--no-seed']);
  pass('DISPOSABLE_49_MIGRATION_REPLAY');

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
  await verifyDietitian(approvedA, 'approved');
  await verifyDietitian(approvedB, 'approved');
  await bootstrapDisposableCore(approvedA);
  await bootstrapDisposableCore(approvedB);
  await verifyDietitian(rejected, 'rejected');
  const relationshipA = await activateRelationship(approvedA, clientA);
  await activateRelationship(approvedB, clientB);
  assertNoError(await admin.from('profiles').delete().eq('id', missing.id), 'missing profile fixture');
  const missingRows = assertNoError(
    await admin.from('profiles').select('id').eq('id', missing.id),
    'missing profile check',
  );
  assert(missingRows.length === 0, 'MISSING_PROFILE_FIXTURE');

  const api = {
    approvedA: await actorClient(approvedA),
    approvedB: await actorClient(approvedB),
    pending: await actorClient(pending),
    rejected: await actorClient(rejected),
    missing: await actorClient(missing),
    clientA: await actorClient(clientA),
    clientB: await actorClient(clientB),
    anonymous: anonymousClient(),
  };

  const { service, actorProxy } = compileDailyTaskService();
  actorProxy.setSupabaseClient(api.approvedA);
  pass('REAL_DAILY_TASK_SERVICE_COMPILED');

  const generalTask = await service.createDailyTask(taskDraft());
  taskIds.push(generalTask.id);
  assert(
    generalTask.clientId === null && generalTask.status === 'pending' && generalTask.completedAt === null,
    'APPROVED_GENERAL_CREATE',
  );

  let linkedTask = await service.createDailyTask(taskDraft({
    clientId: clientA.id,
    title: 'Disposable linked task',
    priority: 'high',
  }));
  taskIds.push(linkedTask.id);
  assert(linkedTask.clientId === clientA.id, 'APPROVED_ACTIVE_CLIENT_CREATE');

  let fetched = await service.fetchDailyTasks();
  assert(
    fetched.some(({ id }) => id === generalTask.id) && fetched.some(({ id }) => id === linkedTask.id),
    'APPROVED_SERVICE_READ',
  );

  const freshApprovedA = await actorClient(approvedA);
  actorProxy.setSupabaseClient(freshApprovedA);
  fetched = await service.fetchDailyTasks();
  assert(fetched.some(({ id }) => id === linkedTask.id), 'FRESH_SESSION_CREATE_PERSISTED');
  actorProxy.setSupabaseClient(api.approvedA);

  linkedTask = await service.updateDailyTask(linkedTask.id, taskDraft({
    clientId: clientA.id,
    title: 'Disposable linked task updated',
    description: 'Updated through the real service',
    dueTime: '10:45',
    priority: 'low',
  }));
  assert(
    linkedTask.title === 'Disposable linked task updated'
      && linkedTask.dueTime === '10:45'
      && linkedTask.priority === 'low'
      && linkedTask.status === 'pending',
    'APPROVED_SERVICE_UPDATE',
  );

  linkedTask = await service.setDailyTaskCompletion(linkedTask.id, true);
  assert(linkedTask.status === 'completed' && Boolean(linkedTask.completedAt), 'COMPLETE_SETS_TIMESTAMP');
  const originalCompletedAt = linkedTask.completedAt;
  let result = await api.approvedA.from('daily_tasks')
    .update({ completed_at: '2000-01-01T00:00:00.000Z' })
    .eq('id', linkedTask.id)
    .select('id,status,completed_at')
    .single();
  const preservedCompletion = assertNoError(result, 'completed timestamp preservation');
  assert(
    preservedCompletion.status === 'completed' && preservedCompletion.completed_at === originalCompletedAt,
    'COMPLETED_TIMESTAMP_CANNOT_BE_FORGED',
  );

  linkedTask = await service.setDailyTaskCompletion(linkedTask.id, false);
  assert(linkedTask.status === 'pending' && linkedTask.completedAt === null, 'REOPEN_CLEARS_TIMESTAMP');
  result = await api.approvedA.from('daily_tasks')
    .update({ completed_at: '2000-01-01T00:00:00.000Z' })
    .eq('id', linkedTask.id)
    .select('id,status,completed_at')
    .single();
  const pendingCompletion = assertNoError(result, 'pending timestamp normalization');
  assert(
    pendingCompletion.status === 'pending' && pendingCompletion.completed_at === null,
    'PENDING_TIMESTAMP_REMAINS_NULL',
  );

  result = await api.approvedB.from('daily_tasks').select('id').eq('id', linkedTask.id);
  assert(assertNoError(result, 'foreign approved read').length === 0, 'FOREIGN_DIETITIAN_READ_ZERO');
  assertNoRows(
    await api.approvedB.from('daily_tasks').update({ title: 'foreign update' })
      .eq('id', linkedTask.id).select('id'),
    'FOREIGN_DIETITIAN_UPDATE_ZERO',
  );
  assertNoRows(
    await api.approvedB.from('daily_tasks').delete().eq('id', linkedTask.id).select('id'),
    'FOREIGN_DIETITIAN_DELETE_ZERO',
  );

  await assertServiceError(
    () => service.createDailyTask(taskDraft({ clientId: clientB.id, title: 'Foreign linked client' })),
    service.DailyTaskServiceError,
    'UNRELATED_CLIENT_SERVICE_CREATE_DENY',
  );
  assertNoRows(
    await api.approvedA.from('daily_tasks')
      .insert(directTaskPayload(approvedA.id, clientB.id, 'Foreign linked direct'))
      .select('id'),
    'UNRELATED_CLIENT_DIRECT_CREATE_DENY',
  );

  for (const [label, actor, actorId] of [
    ['CLIENT_A', api.clientA, clientA.id],
    ['CLIENT_B', api.clientB, clientB.id],
    ['PENDING', api.pending, pending.id],
    ['REJECTED', api.rejected, rejected.id],
    ['MISSING_PROFILE', api.missing, missing.id],
    ['ANONYMOUS', api.anonymous, approvedA.id],
  ]) {
    const read = await actor.from('daily_tasks').select('id').eq('id', linkedTask.id);
    if (read.error) pass(`${label}_READ_DENY`, `denied=${read.error.code ?? 'error'}`);
    else assert(read.data.length === 0, `${label}_READ_DENY`);
    assertNoRows(
      await actor.from('daily_tasks')
        .insert(directTaskPayload(actorId, null, `${label} denied`))
        .select('id'),
      `${label}_CREATE_DENY`,
    );
    assertNoRows(
      await actor.from('daily_tasks').update({ title: `${label} denied` })
        .eq('id', linkedTask.id).select('id'),
      `${label}_UPDATE_DENY`,
    );
    assertNoRows(
      await actor.from('daily_tasks').delete().eq('id', linkedTask.id).select('id'),
      `${label}_DELETE_DENY`,
    );
  }

  const immutableBefore = assertNoError(
    await admin.from('daily_tasks').select('id,dietitian_id,created_at').eq('id', linkedTask.id).single(),
    'immutable baseline',
  );
  assertNoRows(
    await api.approvedA.from('daily_tasks').update({ dietitian_id: approvedB.id })
      .eq('id', linkedTask.id).select('id'),
    'IMMUTABLE_OWNER_DENY',
  );
  assertNoRows(
    await api.approvedA.from('daily_tasks').update({ id: randomUUID() })
      .eq('id', linkedTask.id).select('id'),
    'IMMUTABLE_ID_DENY',
  );
  assertNoRows(
    await api.approvedA.from('daily_tasks').update({ created_at: '2000-01-01T00:00:00.000Z' })
      .eq('id', linkedTask.id).select('id'),
    'IMMUTABLE_CREATED_AT_DENY',
  );
  const immutableAfter = assertNoError(
    await admin.from('daily_tasks').select('id,dietitian_id,created_at').eq('id', linkedTask.id).single(),
    'immutable postflight',
  );
  assert(
    JSON.stringify(immutableAfter) === JSON.stringify(immutableBefore),
    'IMMUTABLE_FIELDS_UNCHANGED',
  );

  assertNoError(
    await admin.from('dietitian_clients').update({ status: 'removed' }).eq('id', relationshipA),
    'inactive relationship fixture',
  );
  actorProxy.setSupabaseClient(api.approvedA);
  fetched = await service.fetchDailyTasks();
  assert(fetched.some(({ id }) => id === linkedTask.id), 'REMOVED_RELATIONSHIP_TASK_REMAINS_READABLE');

  linkedTask = await service.updateDailyTask(linkedTask.id, taskDraft({
    clientId: clientA.id,
    title: 'Managed after relationship removal',
    description: null,
    dueTime: null,
    priority: 'medium',
  }));
  assert(linkedTask.clientId === clientA.id, 'REMOVED_RELATIONSHIP_EXISTING_LINK_MANAGEABLE');
  linkedTask = await service.setDailyTaskCompletion(linkedTask.id, true);
  assert(linkedTask.status === 'completed' && Boolean(linkedTask.completedAt), 'REMOVED_RELATIONSHIP_COMPLETE');
  linkedTask = await service.setDailyTaskCompletion(linkedTask.id, false);
  assert(linkedTask.status === 'pending' && linkedTask.completedAt === null, 'REMOVED_RELATIONSHIP_REOPEN');

  linkedTask = await service.updateDailyTask(linkedTask.id, taskDraft({
    clientId: null,
    title: 'Unlinked after relationship removal',
    description: null,
    dueTime: null,
    priority: 'medium',
  }));
  assert(linkedTask.clientId === null, 'REMOVED_RELATIONSHIP_UNLINK_ALLOWED');
  await assertServiceError(
    () => service.updateDailyTask(linkedTask.id, taskDraft({
      clientId: clientA.id,
      title: 'Relink denied',
    })),
    service.DailyTaskServiceError,
    'REMOVED_RELATIONSHIP_RELINK_DENY',
  );
  await assertServiceError(
    () => service.createDailyTask(taskDraft({
      clientId: clientA.id,
      title: 'Inactive create denied',
    })),
    service.DailyTaskServiceError,
    'REMOVED_RELATIONSHIP_SERVICE_CREATE_DENY',
  );
  assertNoRows(
    await api.approvedA.from('daily_tasks')
      .insert(directTaskPayload(approvedA.id, clientA.id, 'Inactive direct create'))
      .select('id'),
    'REMOVED_RELATIONSHIP_DIRECT_CREATE_DENY',
  );

  await service.deleteDailyTask(linkedTask.id);
  pass('APPROVED_LINKED_DELETE');
  const freshAfterDelete = await actorClient(approvedA);
  result = await freshAfterDelete.from('daily_tasks').select('id').eq('id', linkedTask.id);
  assert(assertNoError(result, 'fresh linked delete read').length === 0, 'FRESH_SESSION_DELETE_PERSISTED');
  await service.deleteDailyTask(generalTask.id);
  pass('APPROVED_GENERAL_DELETE');

  process.stdout.write('DAILY_TASK_RUNTIME_MATRIX_PASS\n');
} catch (error) {
  mainError = error;
} finally {
  if (admin) {
    try {
      if (actorIds.length) await admin.from('daily_tasks').delete().in('dietitian_id', actorIds);
      if (relationshipIds.length) await admin.from('dietitian_clients').delete().in('id', relationshipIds);
      if (actorIds.length) await admin.from('dietitian_subscriptions').delete().in('dietitian_id', actorIds);
      const taskResidue = actorIds.length
        ? assertNoError(
            await admin.from('daily_tasks').select('id').in('dietitian_id', actorIds),
            'task residue check',
          ).length
        : 0;
      const relationshipResidue = relationshipIds.length
        ? assertNoError(
            await admin.from('dietitian_clients').select('id').in('id', relationshipIds),
            'relationship residue check',
          ).length
        : 0;
      assert(taskResidue === 0, 'TEMPORARY_DAILY_TASKS_ZERO');
      assert(relationshipResidue === 0, 'TEMPORARY_RELATIONSHIPS_ZERO');
      const subscriptionResidue = actorIds.length
        ? assertNoError(
            await admin.from('dietitian_subscriptions').select('dietitian_id').in('dietitian_id', actorIds),
            'subscription residue check',
          ).length
        : 0;
      assert(subscriptionResidue === 0, 'TEMPORARY_SUBSCRIPTIONS_ZERO');
      for (const id of [...actorIds].reverse()) await admin.auth.admin.deleteUser(id);
      const authResidue = [];
      let page = 1;
      while (true) {
        const listed = assertNoError(
          await admin.auth.admin.listUsers({ page, perPage: 100 }),
          'auth residue check',
        );
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
      if (mainError) {
        if (stackStarted) mainError.message += `; local stack stop failed: ${stopError.message}`;
      } else {
        mainError = stopError;
      }
    }
  }
  if (disposable?.tempRoot) {
    const tempParent = dirname(disposable.tempRoot);
    rmSync(tempParent, { recursive: true, force: true });
    pass('DISPOSABLE_TEMP_RESIDUE_ZERO');
  }
  try {
    const containerResidual = execFileSync('docker', [
      'ps', '-a', '--filter', `name=^supabase_.*_${projectId}$`, '--format', '{{.ID}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    const volumeResidual = execFileSync('docker', [
      'volume', 'ls', '--filter', `name=${projectId}`, '--format', '{{.Name}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    const networkResidual = execFileSync('docker', [
      'network', 'ls', '--filter', `name=${projectId}`, '--format', '{{.Name}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    assert(
      containerResidual === '' && volumeResidual === '' && networkResidual === '',
      'DISPOSABLE_DOCKER_RESIDUE_ZERO',
    );
  } catch (dockerError) {
    if (mainError) mainError.message += `; Docker residue verification failed: ${dockerError.message}`;
    else mainError = dockerError;
  }
}

if (mainError) throw mainError;
