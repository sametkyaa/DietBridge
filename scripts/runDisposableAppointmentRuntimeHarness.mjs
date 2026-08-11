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
const PASSWORD = 'Disposable-MVP4-Only-9b!';
const projectId = `dietbridge-mvp4-${process.pid}-${randomUUID().slice(0, 8)}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const actorIds = [];
const appointmentIds = [];
const relationshipIds = [];
let disposable;
let local;
let admin;
let stackStarted = false;
let stackStartAttempted = false;
let mainError;

const cleanEnvironment = ({
  SUPABASE_ACCESS_TOKEN: _accessToken,
  SUPABASE_DB_PASSWORD: _databasePassword,
  SUPABASE_SERVICE_ROLE_KEY: _serviceRole,
  VITE_SUPABASE_URL: _remoteUrl,
  VITE_SUPABASE_ANON_KEY: _remoteAnon,
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

const parseStatus = (text) => Object.fromEntries(text.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
  .filter(Boolean)
  .map((match) => [match[1], match[2]]));

const anonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActor = async (label, role) => {
  const email = `mvp4-${label}-${randomUUID()}@example.invalid`;
  const result = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { account_type: role, role, full_name: `Disposable ${label}` },
  });
  const user = assertNoError(result, `${label} auth fixture`);
  assert(user.user?.id, `${label.toUpperCase()}_AUTH_CREATED`);
  actorIds.push(user.user.id);
  return { id: user.user.id, email, label };
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
  assert(row.verification_status === verificationStatus, `${actor.label.toUpperCase()}_${verificationStatus.toUpperCase()}_FIXTURE`);
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

const appointmentPayload = (dietitianId, clientId, title) => ({
  dietitian_id: dietitianId,
  client_id: clientId,
  title,
  date: '2099-12-01',
  time: '09:30',
  duration: 45,
  type: 'online',
  status: 'upcoming',
});

const compileAppointmentService = () => {
  const sourceRoot = join(disposable.tempRoot, 'appointment-service-source');
  const buildRoot = join(disposable.tempRoot, 'appointment-service-build');
  const sources = [
    'features/appointments/services/appointmentService.ts',
    'features/appointments/utils/appointmentContract.ts',
    'shared/types.ts',
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
    service: require(join(buildRoot, 'features', 'appointments', 'services', 'appointmentService.js')),
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
  pass('DISPOSABLE_39_MIGRATION_REPLAY');

  local = parseStatus(cli(['status', '--output', 'env']));
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? ''), 'LOOPBACK_API_GUARD', local.API_URL);
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
  await verifyDietitian(rejected, 'rejected');
  const relationshipA = await activateRelationship(approvedA, clientA);
  await activateRelationship(approvedB, clientB);
  assertNoError(await admin.from('profiles').delete().eq('id', missing.id), 'missing profile fixture');
  const missingRows = assertNoError(await admin.from('profiles').select('id').eq('id', missing.id), 'missing profile check');
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

  const { service, actorProxy } = compileAppointmentService();
  actorProxy.setSupabaseClient(api.approvedA);
  pass('REAL_APPOINTMENT_SERVICE_COMPILED');

  const appointmentA = await service.createAppointment({
    clientId: clientA.id,
    title: 'Disposable A',
    date: '2099-12-01',
    time: '09:30',
    duration: 45,
    type: 'Görüntülü Görüşme',
  });
  appointmentIds.push(appointmentA.id);
  assert(appointmentA.status === 'upcoming', 'CREATE_DEFAULT_UPCOMING');
  assert(appointmentA.date === '2099-12-01' && appointmentA.time === '09:30', 'SERVICE_DATE_TIME_ROUND_TRIP');
  let result = await admin.from('appointments').select('date,time').eq('id', appointmentA.id).single();
  const rawAppointment = assertNoError(result, 'raw date/time read');
  assert(rawAppointment.date === '2099-12-01' && rawAppointment.time === '09:30:00', 'DATE_TIME_DB_ROUND_TRIP');

  const freshA = await actorClient(approvedA);
  result = await freshA.from('appointments').select('id,title,status,date,time').eq('id', appointmentA.id).single();
  assert(assertNoError(result, 'fresh session read').id === appointmentA.id, 'FRESH_SESSION_CREATE_PERSISTED');

  let serviceUpdate = await service.updateAppointment(appointmentA.id, {
    clientId: clientA.id,
    title: 'Disposable A updated',
    date: '2099-12-01',
    time: '09:30',
    duration: 45,
    type: 'Görüntülü Görüşme',
  });
  assert(serviceUpdate.status === 'upcoming', 'UPDATE_PRESERVES_UPCOMING_STATUS');
  assertNoError(await admin.from('appointments').update({ status: 'completed' }).eq('id', appointmentA.id), 'completed fixture');
  serviceUpdate = await service.updateAppointment(appointmentA.id, {
    clientId: clientA.id,
    title: 'Disposable A completed',
    date: '2099-12-01',
    time: '09:30',
    duration: 60,
    type: 'Görüntülü Görüşme',
  });
  const completedUpdate = serviceUpdate;
  assert(completedUpdate.status === 'completed' && completedUpdate.duration === 60, 'UPDATE_PRESERVES_COMPLETED_STATUS');

  const deletableAppointment = await service.createAppointment({
    clientId: clientA.id,
    title: 'Disposable delete check',
    date: '2099-12-01',
    time: '10:30',
    duration: 30,
    type: 'Telefon Görüşmesi',
  });
  appointmentIds.push(deletableAppointment.id);
  await service.deleteAppointmentService(deletableAppointment.id);
  pass('APPROVED_DELETE');
  const freshAfterDelete = await actorClient(approvedA);
  result = await freshAfterDelete.from('appointments').select('id').eq('id', deletableAppointment.id);
  assert(assertNoError(result, 'fresh delete read').length === 0, 'FRESH_SESSION_DELETE_PERSISTED');

  result = await api.clientA.from('appointments').select('id').eq('id', appointmentA.id);
  assert(assertNoError(result, 'linked client read').length === 1, 'LINKED_CLIENT_OWN_READ');
  result = await api.approvedB.from('appointments').select('id').eq('id', appointmentA.id);
  assert(assertNoError(result, 'foreign read').length === 0, 'FOREIGN_DIETITIAN_READ_DENY');
  result = await api.clientB.from('appointments').select('id').eq('id', appointmentA.id);
  assert(assertNoError(result, 'foreign client read').length === 0, 'FOREIGN_CLIENT_READ_DENY');

  assertNoRows(await api.approvedB.from('appointments').update({ title: 'foreign' }).eq('id', appointmentA.id).select('id'), 'FOREIGN_UPDATE_DENY');
  assertNoRows(await api.approvedB.from('appointments').delete().eq('id', appointmentA.id).select('id'), 'FOREIGN_DELETE_DENY');
  await assertServiceError(() => service.updateAppointment(randomUUID(), {
    clientId: clientA.id,
    title: 'missing',
    date: '2099-12-01',
    time: '11:30',
    duration: 30,
    type: 'Yüzyüze',
  }), service.AppointmentServiceError, 'RANDOM_UUID_UPDATE_SERVICE_ERROR');
  await assertServiceError(
    () => service.deleteAppointmentService(randomUUID()),
    service.AppointmentServiceError,
    'RANDOM_UUID_DELETE_SERVICE_ERROR',
  );
  assertNoRows(await api.approvedA.from('appointments').insert(
    appointmentPayload(approvedA.id, clientB.id, 'Unrelated client'),
  ).select('id'), 'UNRELATED_CLIENT_CREATE_DENY');

  for (const [label, actor, actorId] of [
    ['CLIENT', api.clientA, clientA.id],
    ['PENDING', api.pending, pending.id],
    ['REJECTED', api.rejected, rejected.id],
    ['MISSING_PROFILE', api.missing, missing.id],
    ['ANONYMOUS', api.anonymous, approvedA.id],
  ]) {
    const read = await actor.from('appointments').select('id').eq('id', appointmentA.id);
    if (label === 'CLIENT') assert(assertNoError(read, `${label} read`).length === 1, 'CLIENT_READ_REMAINS_ALLOWED');
    else if (read.error) pass(`${label}_READ_DENY`, `denied=${read.error.code ?? 'error'}`);
    else assert(read.data.length === 0, `${label}_READ_DENY`);
    assertNoRows(await actor.from('appointments').insert(
      appointmentPayload(actorId, clientA.id, `${label} denied`),
    ).select('id'), `${label}_CREATE_DENY`);
    assertNoRows(await actor.from('appointments').update({ title: `${label} denied` }).eq('id', appointmentA.id).select('id'), `${label}_UPDATE_DENY`);
    assertNoRows(await actor.from('appointments').delete().eq('id', appointmentA.id).select('id'), `${label}_DELETE_DENY`);
  }

  result = await admin.from('dietitian_clients').update({ status: 'removed' }).eq('id', relationshipA);
  assertNoError(result, 'inactive relationship fixture');
  for (const [label, actor] of [['DIETITIAN', api.approvedA], ['CLIENT', api.clientA]]) {
    result = await actor.from('appointments').select('id').eq('id', appointmentA.id);
    assert(assertNoError(result, `${label} inactive read`).length === 0, `${label}_INACTIVE_READ_DENY`);
    assertNoRows(await actor.from('appointments').update({ title: 'inactive' }).eq('id', appointmentA.id).select('id'), `${label}_INACTIVE_UPDATE_DENY`);
    assertNoRows(await actor.from('appointments').delete().eq('id', appointmentA.id).select('id'), `${label}_INACTIVE_DELETE_DENY`);
  }
  assertNoRows(await api.approvedA.from('appointments').insert(
    appointmentPayload(approvedA.id, clientA.id, 'inactive create'),
  ).select('id'), 'INACTIVE_CREATE_DENY');

  const istanbulDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date('2026-08-10T21:30:00.000Z'));
  assert(istanbulDate === '2026-08-11', 'ISTANBUL_DATE_BOUNDARY');
  process.stdout.write('APPOINTMENT_RUNTIME_MATRIX_PASS\n');
} catch (error) {
  mainError = error;
} finally {
  if (admin) {
    try {
      if (appointmentIds.length) await admin.from('appointments').delete().in('id', appointmentIds);
      if (relationshipIds.length) await admin.from('dietitian_clients').delete().in('id', relationshipIds);
      for (const id of [...actorIds].reverse()) await admin.auth.admin.deleteUser(id);
      const appointmentResidue = appointmentIds.length
        ? assertNoError(await admin.from('appointments').select('id').in('id', appointmentIds), 'appointment residue check').length
        : 0;
      const relationshipResidue = relationshipIds.length
        ? assertNoError(await admin.from('dietitian_clients').select('id').in('id', relationshipIds), 'relationship residue check').length
        : 0;
      assert(appointmentResidue === 0, 'TEMPORARY_APPOINTMENTS_ZERO');
      assert(relationshipResidue === 0, 'TEMPORARY_RELATIONSHIPS_ZERO');
      pass('CLEANUP_QUEUE_RESIDUE_ZERO', 'appointment harness creates no queue rows');
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
