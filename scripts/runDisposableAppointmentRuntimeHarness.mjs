import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';
import { addCurrentIsolatedMigrations } from './addCurrentIsolatedMigrations.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-MVP4-Only-9b!';
const projectId = `dietbridge-mvp4-${process.pid}-${randomUUID().slice(0, 8)}`;
const npxCli = process.env.npm_execpath
  ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
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
  assert(row.verification_status === verificationStatus, `${actor.label.toUpperCase()}_${verificationStatus.toUpperCase()}_FIXTURE`);
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

const appointmentPayload = (dietitianId, clientId, title, overrides = {}) => ({
  dietitian_id: dietitianId,
  client_id: clientId,
  title,
  date: '2099-12-01',
  time: '09:30',
  duration: 45,
  type: 'online',
  status: 'upcoming',
  ...overrides,
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
    return error;
  }
  throw new Error(`${label}: operation unexpectedly succeeded`);
};

try {
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  addCurrentIsolatedMigrations({ repoRoot, tempRoot: disposable.tempRoot });
  const configText = readFileSync(disposable.configPath, 'utf8');
  assert(/^project_id\s*=\s*"[^"]+"/m.test(configText), 'DISPOSABLE_CONFIG_PROJECT_ID_PRESENT');
  const disposablePorts = await allocateDisposablePorts();
  writeFileSync(
    disposable.configPath,
    applyDisposablePorts(
      configText.replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`),
      disposablePorts,
    ),
    'utf8',
  );

  stackStartAttempted = true;
  cli(['start']);
  stackStarted = true;
  pass('DISPOSABLE_LOCAL_STACK_STARTED', `project=${projectId}`);
  cli(['db', 'reset', '--local', '--no-seed']);
  pass('DISPOSABLE_53_MIGRATION_REPLAY');

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
  const clientC = await createActor('client-c', 'client');
  await verifyDietitian(approvedA, 'approved');
  await verifyDietitian(approvedB, 'approved');
  await bootstrapDisposableCore(approvedA);
  await bootstrapDisposableCore(approvedB);
  await verifyDietitian(rejected, 'rejected');
  const relationshipA = await activateRelationship(approvedA, clientA);
  await activateRelationship(approvedA, clientC);
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
    clientC: await actorClient(clientC),
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

  const sameSlotError = await assertServiceError(() => service.createAppointment({
    clientId: clientA.id,
    title: 'Same slot must fail',
    date: '2099-12-01',
    time: '09:30',
    duration: 30,
    type: 'Yüzyüze',
  }), service.AppointmentServiceError, 'ACTIVE_ACTIVE_SAME_SLOT_DENY');
  assert(sameSlotError.userMessage === service.APPOINTMENT_SLOT_CONFLICT_ERROR, 'SAME_SLOT_PRODUCT_ERROR_MESSAGE');

  let bookingCheck = await service.checkAppointmentBooking({
    clientId: clientA.id,
    title: 'Self edit check',
    date: '2099-12-01',
    time: '09:30',
    duration: 45,
    type: 'Görüntülü Görüşme',
  }, appointmentA.id);
  assert(!bookingCheck.slotConflict && bookingCheck.sameWeekCount === 0, 'EDIT_SELF_RETAINING_SLOT_ALLOWED');

  bookingCheck = await service.checkAppointmentBooking({
    clientId: clientA.id,
    title: 'Same week warning check',
    date: '2099-12-02',
    time: '10:00',
    duration: 30,
    type: 'Telefon Görüşmesi',
  });
  assert(!bookingCheck.slotConflict && bookingCheck.sameWeekCount === 1, 'SAME_CLIENT_SAME_WEEK_COUNT_ONE');
  assert(bookingCheck.weekStartDate === '2099-11-30' && bookingCheck.weekEndDate === '2099-12-06', 'SAME_WEEK_DATE_RANGE');

  const sameWeekAppointment = await service.createAppointment({
    clientId: clientA.id,
    title: 'Same week allowed',
    date: '2099-12-02',
    time: '11:00',
    duration: 30,
    type: 'Telefon Görüşmesi',
  });
  appointmentIds.push(sameWeekAppointment.id);
  assert(sameWeekAppointment.status === 'upcoming', 'SAME_CLIENT_SAME_WEEK_CREATE_ALLOWED');

  bookingCheck = await service.checkAppointmentBooking({
    clientId: clientA.id,
    title: 'Same week multiple check',
    date: '2099-12-03',
    time: '12:00',
    duration: 30,
    type: 'Telefon Görüşmesi',
  });
  assert(bookingCheck.sameWeekCount === 2, 'SAME_CLIENT_SAME_WEEK_COUNT_TWO');

  bookingCheck = await service.checkAppointmentBooking({
    clientId: clientA.id,
    title: 'Different week check',
    date: '2099-12-08',
    time: '12:00',
    duration: 30,
    type: 'Telefon Görüşmesi',
  });
  assert(bookingCheck.sameWeekCount === 0, 'SAME_CLIENT_DIFFERENT_WEEK_NO_WARNING');

  bookingCheck = await service.checkAppointmentBooking({
    clientId: clientC.id,
    title: 'Different client check',
    date: '2099-12-02',
    time: '12:30',
    duration: 30,
    type: 'Telefon Görüşmesi',
  });
  assert(bookingCheck.sameWeekCount === 0, 'DIFFERENT_CLIENT_SAME_WEEK_NO_WARNING');

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

  const reusedAfterCompletion = await service.createAppointment({
    clientId: clientA.id,
    title: 'Completed slot reused',
    date: '2099-12-01',
    time: '09:30',
    duration: 30,
    type: 'Yüzyüze',
  });
  appointmentIds.push(reusedAfterCompletion.id);
  assert(reusedAfterCompletion.status === 'upcoming', 'COMPLETED_STATUS_DOES_NOT_BLOCK_SLOT');

  const editCollisionError = await assertServiceError(() => service.updateAppointment(sameWeekAppointment.id, {
    clientId: clientA.id,
    title: 'Edit into occupied slot',
    date: '2099-12-01',
    time: '09:30',
    duration: 30,
    type: 'Telefon Görüşmesi',
  }), service.AppointmentServiceError, 'EDIT_INTO_OCCUPIED_SLOT_DENY');
  assert(editCollisionError.userMessage === service.APPOINTMENT_SLOT_CONFLICT_ERROR, 'EDIT_COLLISION_PRODUCT_ERROR_MESSAGE');

  const cancelledAtActiveSlot = assertNoError(await admin.from('appointments').insert(
    appointmentPayload(approvedA.id, clientA.id, 'Cancelled same slot', {
      status: 'cancelled',
      date: '2099-12-01',
      time: '09:30',
    }),
  ).select('id').single(), 'cancelled same slot fixture');
  appointmentIds.push(cancelledAtActiveSlot.id);
  pass('CANCELLED_STATUS_SHARES_SLOT');

  const cancelledOnlySlot = assertNoError(await admin.from('appointments').insert(
    appointmentPayload(approvedA.id, clientA.id, 'Cancelled reusable slot', {
      status: 'cancelled',
      date: '2099-12-15',
      time: '09:00',
    }),
  ).select('id').single(), 'cancelled reusable slot fixture');
  appointmentIds.push(cancelledOnlySlot.id);
  const reusedAfterCancellation = await service.createAppointment({
    clientId: clientA.id,
    title: 'Cancelled slot reused',
    date: '2099-12-15',
    time: '09:00',
    duration: 30,
    type: 'Telefon Görüşmesi',
  });
  appointmentIds.push(reusedAfterCancellation.id);
  assert(reusedAfterCancellation.status === 'upcoming', 'CANCELLED_STATUS_DOES_NOT_BLOCK_SLOT');

  const cancelledOnlyWeek = assertNoError(await admin.from('appointments').insert(
    appointmentPayload(approvedA.id, clientA.id, 'Cancelled warning exclusion', {
      status: 'cancelled',
      date: '2099-12-22',
      time: '09:00',
    }),
  ).select('id').single(), 'cancelled warning exclusion fixture');
  appointmentIds.push(cancelledOnlyWeek.id);
  bookingCheck = await service.checkAppointmentBooking({
    clientId: clientA.id,
    title: 'Cancelled warning exclusion check',
    date: '2099-12-23',
    time: '10:00',
    duration: 30,
    type: 'Telefon Görüşmesi',
  });
  assert(bookingCheck.sameWeekCount === 0, 'CANCELLED_STATUS_EXCLUDED_FROM_WEEK_WARNING');

  const concurrentSameSlot = await Promise.all([
    api.approvedA.from('appointments').insert(appointmentPayload(
      approvedA.id,
      clientA.id,
      'Concurrent one',
      { date: '2099-12-29', time: '09:30' },
    )).select('id').maybeSingle(),
    api.approvedA.from('appointments').insert(appointmentPayload(
      approvedA.id,
      clientA.id,
      'Concurrent two',
      { date: '2099-12-29', time: '09:30' },
    )).select('id').maybeSingle(),
  ]);
  const concurrentSuccesses = concurrentSameSlot.filter((attempt) => !attempt.error && attempt.data?.id);
  const concurrentConflicts = concurrentSameSlot.filter((attempt) => attempt.error?.code === '23505');
  assert(concurrentSuccesses.length === 1 && concurrentConflicts.length === 1, 'CONCURRENT_SAME_SLOT_ONE_SUCCESS_ONE_REJECTED');
  appointmentIds.push(concurrentSuccesses[0].data.id);
  result = await admin.from('appointments').select('id').eq('dietitian_id', approvedA.id).eq('date', '2099-12-29').eq('time', '09:30').eq('status', 'upcoming');
  assert(assertNoError(result, 'concurrent same slot count').length === 1, 'CONCURRENT_SAME_SLOT_RESULT_COUNT_ONE');

  const concurrentDifferentTimes = await Promise.all([
    api.approvedA.from('appointments').insert(appointmentPayload(
      approvedA.id,
      clientA.id,
      'Concurrent different one',
      { date: '2099-12-30', time: '09:30' },
    )).select('id').maybeSingle(),
    api.approvedA.from('appointments').insert(appointmentPayload(
      approvedA.id,
      clientA.id,
      'Concurrent different two',
      { date: '2099-12-30', time: '10:30' },
    )).select('id').maybeSingle(),
  ]);
  assert(concurrentDifferentTimes.every((attempt) => !attempt.error && attempt.data?.id), 'CONCURRENT_DIFFERENT_TIMES_BOTH_ALLOWED');
  for (const attempt of concurrentDifferentTimes) appointmentIds.push(attempt.data.id);

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
      if (actorIds.length) await admin.from('dietitian_subscriptions').delete().in('dietitian_id', actorIds);
      for (const id of [...actorIds].reverse()) await admin.auth.admin.deleteUser(id);
      const appointmentResidue = appointmentIds.length
        ? assertNoError(await admin.from('appointments').select('id').in('id', appointmentIds), 'appointment residue check').length
        : 0;
      const relationshipResidue = relationshipIds.length
        ? assertNoError(await admin.from('dietitian_clients').select('id').in('id', relationshipIds), 'relationship residue check').length
        : 0;
      assert(appointmentResidue === 0, 'TEMPORARY_APPOINTMENTS_ZERO');
      assert(relationshipResidue === 0, 'TEMPORARY_RELATIONSHIPS_ZERO');
      const subscriptionResidue = actorIds.length
        ? assertNoError(await admin.from('dietitian_subscriptions').select('dietitian_id').in('dietitian_id', actorIds), 'subscription residue check').length
        : 0;
      assert(subscriptionResidue === 0, 'TEMPORARY_SUBSCRIPTIONS_ZERO');
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
