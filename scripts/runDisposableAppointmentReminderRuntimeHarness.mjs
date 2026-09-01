#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { materializeDisposableReplay } from './materializeDisposableSupabaseReplay.mjs';
import { LOCAL_PREREQUISITE_FILE, LOCAL_PREREQUISITE_SQL } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = join(repoRoot, 'supabase', 'migrations');
const notificationCoreMigrationName = '20260814214101_notification_core_backend.sql';
const appointmentReminderMigrationName = '20260817084531_appointment_reminders_backend.sql';
const pushRegistryMigrationName = '20260817120000_push_registry_outbox_backend.sql';
const supabaseVersion = '2.110.0';
const projectId = `appointment-reminders-${process.pid}-${randomUUID().slice(0, 8)}`;
const password = 'Disposable-Appointment-4m!';
const npxCli = process.env.npm_execpath
  ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');

const actorIds = [];
const relationshipIds = [];
const appointmentIds = [];
let disposable;
let local;
let admin;
let stackStartAttempted = false;
let stackStarted = false;
let mainError;

const pass = (label, detail = '') => process.stdout.write(`PASS: ${label}${detail ? ` ${detail}` : ''}\n`);
const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  pass(label, detail);
};
const redact = (value) => String(value)
  .replace(/\b(sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)\b/g, '[redacted]')
  .replace(/\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/g, '[redacted]');
const assertNoError = (result, label) => {
  if (!result || result.error) throw new Error(`${label}: ${redact(result?.error?.message ?? 'missing result')}`);
  return result.data;
};
const assertDenied = (result, label) => {
  const denied = Boolean(result?.error) || !Array.isArray(result?.data) || result.data.length === 0;
  assert(denied, label, result?.error?.code ? `denied=${result.error.code}` : '');
};
const sleep = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

const cleanEnvironment = (environment) => Object.fromEntries(
  Object.entries(environment).filter(([key]) => !(
    /^(?:SUPABASE|VITE_SUPABASE|EXPO_PUBLIC_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)
  )),
);

const runCli = (tempRoot, args) => {
  try {
    return execFileSync(
      process.execPath,
      [npxCli, '--yes', `supabase@${supabaseVersion}`, '--workdir', tempRoot, ...args],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...cleanEnvironment(process.env), TZ: 'Europe/Istanbul' },
        maxBuffer: 32 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
      },
    );
  } catch (error) {
    throw new Error(`Supabase ${args.join(' ')} failed: ${redact(error.message)}\n${redact(String(error.stdout ?? '').slice(-6000))}\n${redact(String(error.stderr ?? '').slice(-6000))}`);
  }
};

const parseStatus = (value) => Object.fromEntries(
  value.split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

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

const configureProject = async (configPath) => {
  const ports = await allocateDisposablePorts();
  const config = readFileSync(configPath, 'utf8')
    .replace(/^project_id\s*=\s*"[^"]+"$/m, `project_id = "${projectId}"`)
    .replace(/^port\s*=\s*54321$/m, `port = ${ports.api}`)
    .replace(/^port\s*=\s*54322$/m, `port = ${ports.db}`)
    .replace(/^shadow_port\s*=\s*54320$/m, `shadow_port = ${ports.shadow}`)
    .replace(/^port\s*=\s*54329$/m, `port = ${ports.pooler}`)
    .replace(/^port\s*=\s*54323$/m, `port = ${ports.studio}`)
    .replace(/^port\s*=\s*54324$/m, `port = ${ports.smtp}`)
    .replace(/^port\s*=\s*54327$/m, `port = ${ports.analytics}`)
    .replace(/^inspector_port\s*=\s*8083$/m, `inspector_port = ${ports.functionsInspector}`);
  writeFileSync(configPath, config, 'utf8');
};

const sqlQuote = (value) => `'${String(value).replaceAll("'", "''")}'`;
const sqlUuidArray = (values) => values.length
  ? `ARRAY[${values.map((value) => sqlQuote(value)).join(',')}]::uuid[]`
  : 'ARRAY[]::uuid[]';

const runPsql = (sql, { async = false } = {}) => {
  const args = [
    'exec',
    `supabase_db_${projectId}`,
    'psql',
    '-U', 'postgres',
    '-d', 'postgres',
    '-At',
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-c', sql,
  ];
  if (async) {
    return new Promise((resolvePromise, rejectPromise) => {
      const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.once('error', rejectPromise);
      child.once('close', (code) => {
        if (code !== 0) rejectPromise(new Error(`Disposable psql failed (${code}): ${redact(stderr || stdout)}`));
        else resolvePromise(stdout.trim());
      });
    });
  }
  try {
    return execFileSync('docker', args, { encoding: 'utf8', timeout: 60_000 }).trim();
  } catch (error) {
    throw new Error(`Disposable psql failed: ${redact(error.message)}`);
  }
};

const readSql = (sql) => runPsql(sql);
const countSql = (sql) => Number(readSql(sql));

const runProcessor = (referenceAt) => {
  const sql = `select row_to_json(result)::text from private.process_appointment_reminders_at(${sqlQuote(referenceAt)}::timestamptz) as result;`;
  const value = JSON.parse(readSql(sql));
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, Number(item)]));
};

const runCurrentProcessor = () => JSON.parse(
  readSql('select row_to_json(result)::text from private.process_appointment_reminders() as result;'),
);

const createAnonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActorClient = async (actor) => {
  const result = await createAnonymousClient().auth.signInWithPassword({ email: actor.email, password });
  const session = assertNoError(result, `${actor.label} sign-in`);
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const createActor = async (label, role) => {
  const result = await admin.auth.admin.createUser({
    email: `appointment-reminder-${label}-${randomUUID()}@example.invalid`,
    password,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: `Disposable ${label}`,
      appointment_reminder_harness: 'disposable-test-identity',
    },
  });
  const data = assertNoError(result, `${label} Auth fixture`);
  assert(Boolean(data.user?.id), `${label.toUpperCase()}_AUTH_CREATED`);
  actorIds.push(data.user.id);
  const profile = assertNoError(await admin.from('profiles').select('id,role').eq('id', data.user.id).single(), `${label} profile`);
  assert(profile.id === data.user.id && profile.role === role, `${label.toUpperCase()}_PROFILE_ROLE`);
  return { id: data.user.id, email: data.user.email, label, role };
};

const approveDietitian = async (dietitian) => {
  const row = assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: 'approved',
    is_verified: true,
    verified_at: '2026-08-15T08:00:00.000Z',
    rejection_reason: null,
  }).eq('user_id', dietitian.id).select('user_id,verification_status,is_verified').single(), 'dietitian approval');
  assert(row.verification_status === 'approved' && row.is_verified === true, 'DIETITIAN_APPROVED');
};

const bootstrapDietitian = async (dietitian) => {
  const row = assertNoError(await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: dietitian.id,
    plan_id: 'core',
    status: 'active',
    client_limit_override: null,
  }).select('dietitian_id,plan_id,status').single(), 'dietitian subscription bootstrap');
  assert(row.dietitian_id === dietitian.id && row.status === 'active', 'DIETITIAN_CORE_BOOTSTRAP');
};

const activateRelationship = async (dietitian, client, label) => {
  const pending = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id,
    client_id: client.id,
    status: 'pending',
  }).select('id,dietitian_id,client_id,status').single(), `${label} pending relationship`);
  relationshipIds.push(pending.id);
  const active = assertNoError(await admin.from('dietitian_clients').update({ status: 'active' })
    .eq('id', pending.id).select('id,dietitian_id,client_id,status').single(), `${label} active relationship`);
  assert(active.status === 'active', `${label}_ACTIVE`);
  return active;
};

const updateRelationship = async (relationId, status, label) => assertNoError(
  await admin.from('dietitian_clients').update({ status }).eq('id', relationId)
    .select('id,dietitian_id,client_id,status').single(),
  label,
);

const createAppointment = async ({ dietitianId, clientId, title, date, time, createdAt, status = 'upcoming' }) => {
  const row = assertNoError(await admin.from('appointments').insert({
    dietitian_id: dietitianId,
    client_id: clientId,
    title,
    date,
    time,
    duration: 30,
    type: 'online',
    status,
    created_at: createdAt,
  }).select('*').single(), `${title} appointment create`);
  appointmentIds.push(row.id);
  return row;
};

const updateAppointment = async (id, payload, label) => assertNoError(
  await admin.from('appointments').update(payload).eq('id', id).select('*').single(), label,
);

const startAt = (date, time) => `${date}T${time}+03:00`;
const shiftMinutes = (value, minutes) => new Date(new Date(value).getTime() + minutes * 60_000).toISOString();
const targetAt = (value, offsetMinutes, latenessMinutes = 0) => shiftMinutes(value, -offsetMinutes + latenessMinutes);

const readReminders = async (recipientId) => assertNoError(await admin.from('notifications')
  .select('id,recipient_id,category,event_type,aggregation_key,summary_key,actor_id,actor_display_name,conversation_id,dietitian_client_id,appointment_id,appointment_title_snapshot,appointment_date,appointment_time,appointment_status,event_count,occurred_at,seen_at,read_at')
  .eq('recipient_id', recipientId)
  .like('aggregation_key', 'appointment_reminder:%')
  .order('aggregation_key'), 'reminder read');

const readReminder = async (recipientId, key) => {
  const rows = await readReminders(recipientId);
  return rows.find((row) => row.aggregation_key === key) ?? null;
};

const readLifecycle = async (recipientId, appointmentId) => {
  const rows = assertNoError(await admin.from('notifications').select('id,event_type,aggregation_key,event_count,seen_at,read_at')
    .eq('recipient_id', recipientId).eq('aggregation_key', `appointment:${appointmentId}`), 'lifecycle read');
  return rows[0] ?? null;
};

const readFingerprint = (appointmentId) => readSql(
  `select row_to_json(a)::text from public.appointments as a where a.id = ${sqlQuote(appointmentId)};`,
);

const processorLockRace = async ({ appointmentId, referenceAt, mutationSql, label }) => {
  const holder = runPsql(`begin; ${mutationSql} select pg_sleep(1.2); commit;`, { async: true });
  await sleep(250);
  const result = runProcessor(referenceAt);
  await holder;
  assert(result.created === 0, label, JSON.stringify(result));
  return result;
};

const cleanupFixtures = async () => {
  if (!admin) return;
  if (appointmentIds.length) {
    assertNoError(await admin.from('appointments').delete().in('id', appointmentIds), 'appointment cleanup');
  }
  assertNoError(await admin.from('appointments').delete().like('title', 'Reminder EXPLAIN fixture %'), 'EXPLAIN fixture cleanup');
  if (relationshipIds.length) {
    assertNoError(await admin.from('dietitian_clients').delete().in('id', relationshipIds), 'relationship cleanup');
  }
  if (actorIds.length) {
    assertNoError(await admin.from('dietitian_subscriptions').delete().in('dietitian_id', actorIds), 'subscription cleanup');
  }
  if (actorIds.length) {
    assertNoError(await admin.from('notifications').delete().in('recipient_id', actorIds), 'notification cleanup');
  }
  for (const actorId of [...actorIds].reverse()) {
    assertNoError(await admin.auth.admin.deleteUser(actorId), 'Auth cleanup');
  }

  const actors = sqlUuidArray(actorIds);
  const relationships = sqlUuidArray(relationshipIds);
  const appointments = sqlUuidArray(appointmentIds);
  assert(countSql(`select count(*) from public.notifications where recipient_id = any(${actors});`) === 0, 'RESIDUE_NOTIFICATIONS_ZERO');
  assert(countSql(`select count(*) from public.dietitian_clients where id = any(${relationships});`) === 0, 'RESIDUE_RELATIONSHIPS_ZERO');
  assert(countSql(`select count(*) from public.appointments where id = any(${appointments});`) === 0, 'RESIDUE_APPOINTMENTS_ZERO');
  assert(countSql("select count(*) from public.appointments where title like 'Reminder EXPLAIN fixture %';") === 0, 'RESIDUE_EXPLAIN_APPOINTMENTS_ZERO');
  assert(countSql(`select count(*) from auth.users where id = any(${actors});`) === 0, 'RESIDUE_AUTH_ZERO');
  assert(countSql("select count(*) from storage.objects where name like 'appointment-reminder-harness/%';") === 0, 'RESIDUE_STORAGE_ZERO');
  pass('DISPOSABLE_APPOINTMENT_REMINDER_FIXTURES_CLEAN');
};

const runFlows = async () => {
  const sourceMigrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  assert(sourceMigrations.length === 57, 'REMINDER_CANONICAL_MIGRATION_INVENTORY_57');
  assert(sourceMigrations.at(-1) === '20260901165402_client_account_deletion_backend.sql', 'REMINDER_CANONICAL_MIGRATION_TAIL');

  const tempParent = mkdtempSync(join(tmpdir(), 'dietbridge-appointment-reminders-'));
  const tempRoot = join(tempParent, 'project');
  const manifest = materializeDisposableReplay({ repoRoot, outputRoot: tempRoot });
  const configPath = join(tempRoot, 'supabase', 'config.toml');
  copyFileSync(join(repoRoot, 'supabase', 'config.toml'), configPath);
  const runtimeMigrationDirectory = join(tempRoot, 'supabase', 'migrations');
  copyFileSync(join(migrationDirectory, notificationCoreMigrationName), join(runtimeMigrationDirectory, notificationCoreMigrationName));
  copyFileSync(join(migrationDirectory, appointmentReminderMigrationName), join(runtimeMigrationDirectory, appointmentReminderMigrationName));
  copyFileSync(join(migrationDirectory, pushRegistryMigrationName), join(runtimeMigrationDirectory, pushRegistryMigrationName));
  writeFileSync(join(runtimeMigrationDirectory, LOCAL_PREREQUISITE_FILE), LOCAL_PREREQUISITE_SQL, { flag: 'wx' });
  const runtimeFiles = readdirSync(runtimeMigrationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  assert(manifest.expectedHistory.total === 53, 'REMINDER_BASELINE_MATERIALIZED_COUNT_53');
  assert(runtimeFiles.length === 57, 'REMINDER_DISPOSABLE_MIGRATION_FILES_57');

  disposable = { tempRoot, configPath };
  await configureProject(configPath);
  stackStartAttempted = true;
  runCli(tempRoot, ['start']);
  stackStarted = true;
  pass('REMINDER_DISPOSABLE_LOCAL_STACK_STARTED', projectId);
  runCli(tempRoot, ['db', 'reset', '--local', '--no-seed']);

  local = parseStatus(runCli(tempRoot, ['status', '--output', 'env']));
  assert(new URL(local.API_URL).hostname === '127.0.0.1', 'REMINDER_LOOPBACK_ONLY');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const migrationCount = countSql('select count(*) from supabase_migrations.schema_migrations;');
  assert(migrationCount === 57, 'REMINDER_SCHEMA_MIGRATION_COUNT', 'materialized=53, local-prerequisite=1, phase-isolated=3');
  assert(countSql("select count(*) from public.notifications where event_type in ('reminder_24h','reminder_1h');") === 0,
    'REMINDER_NOTIFICATION_COUNT_0_AFTER_REPLAY');

  const cronRow = readSql("select count(*) || '|' || min(schedule) || '|' || min(command) from cron.job where jobname = 'appointment-reminders-every-5-minutes' and active;");
  assert(cronRow.startsWith('1|*/5 * * * *|select private.process_appointment_reminders();'), 'CRON_REGISTRATION_RUNTIME', cronRow);
  assert(countSql("select count(*) from cron.job where jobname = 'chat-image-cleanup-every-5-minutes';") === 1, 'EXISTING_CLEANUP_CRON_PRESERVED');
  assert(!/net\.http_post|pg_net|vault\.decrypted_secrets|service_role_key/i.test(readFileSync(join(migrationDirectory, appointmentReminderMigrationName), 'utf8')), 'CRON_NO_HTTP_SECRET_DEPENDENCY');
  assert(countSql("select count(*) from pg_catalog.pg_class where relnamespace = 'cron'::regnamespace and relname = 'job_run_details';") === 1, 'CRON_RUN_HISTORY_SURFACE_PRESENT');

  const dietitianA = await createActor('dietitian-a', 'dietitian');
  const clientA = await createActor('client-a', 'client');
  const clientB = await createActor('client-b', 'client');
  await approveDietitian(dietitianA);
  await bootstrapDietitian(dietitianA);
  const relationAA = await activateRelationship(dietitianA, clientA, 'RELATION_AA');
  const relationAB = await activateRelationship(dietitianA, clientB, 'RELATION_AB');
  const api = {
    dietitianA: await createActorClient(dietitianA),
    clientA: await createActorClient(clientA),
    clientB: await createActorClient(clientB),
    anonymous: createAnonymousClient(),
  };

  const exactStart = startAt('2026-08-20', '15:00:00');
  const exact = await createAppointment({
    dietitianId: dietitianA.id,
    clientId: clientA.id,
    title: 'Exact threshold reminder',
    date: '2026-08-20',
    time: '15:00:00',
    createdAt: shiftMinutes(exactStart, -2880),
  });
  const exactFingerprintBefore = readFingerprint(exact.id);
  const exact24Reference = targetAt(exactStart, 1440);
  let result = runProcessor(exact24Reference);
  assert(result.created === 1 && result.conflict_noop === 0, 'RUNTIME_24H_EXACTLY_ONE', JSON.stringify(result));
  const exact24Key = `appointment_reminder:${exact.id}:2026-08-20:15:00:24h`;
  let exact24 = await readReminder(clientA.id, exact24Key);
  assert(exact24?.event_type === 'reminder_24h' && exact24.summary_key === 'appointment_reminder_24h'
    && exact24.event_count === 1 && exact24.recipient_id === clientA.id && exact24.appointment_id === exact.id,
  'RUNTIME_24H_ROW_CONTRACT');
  const exactLifecycleBefore = await readLifecycle(clientA.id, exact.id);
  assert(exactLifecycleBefore?.aggregation_key === `appointment:${exact.id}` && exactLifecycleBefore.event_type === 'created',
    'RUNTIME_LIFECYCLE_SEPARATE_BEFORE_RETRY');

  const exact24BeforeDuplicate = JSON.stringify(exact24);
  result = runProcessor(exact24Reference);
  assert(result.created === 0 && result.conflict_noop === 1, 'RUNTIME_DUPLICATE_RUN_NOOP', JSON.stringify(result));
  exact24 = await readReminder(clientA.id, exact24Key);
  assert(JSON.stringify(exact24) === exact24BeforeDuplicate, 'RUNTIME_DUPLICATE_ROW_UNCHANGED');
  assertNoError(await api.clientA.rpc('mark_notification_read', { p_notification_id: exact24.id }), 'read-state retry setup');
  const readStateBeforeRetry = await readReminder(clientA.id, exact24Key);
  result = runProcessor(exact24Reference);
  const readStateAfterRetry = await readReminder(clientA.id, exact24Key);
  assert(result.created === 0 && result.conflict_noop === 1
    && readStateAfterRetry.read_at === readStateBeforeRetry.read_at
    && readStateAfterRetry.seen_at === readStateBeforeRetry.seen_at
    && readStateAfterRetry.event_count === 1,
  'RUNTIME_READ_STATE_RETRY_TRUE_NOOP', JSON.stringify(result));

  const exact1hReference = targetAt(exactStart, 60);
  result = runProcessor(exact1hReference);
  const exact1hKey = `appointment_reminder:${exact.id}:2026-08-20:15:00:1h`;
  const exact1h = await readReminder(clientA.id, exact1hKey);
  assert(result.created === 1 && exact1h?.event_type === 'reminder_1h' && exact1h.event_count === 1
    && exact1h.aggregation_key !== exact24Key,
  'RUNTIME_1H_EXACTLY_ONE_DISTINCT', JSON.stringify(result));
  assert((await readReminders(dietitianA.id)).length === 0, 'RUNTIME_DIETITIAN_RECEIVES_ZERO_REMINDERS');
  assert(readFingerprint(exact.id) === exactFingerprintBefore, 'RUNTIME_APPOINTMENT_FINGERPRINT_UNCHANGED');
  assert((await readLifecycle(clientA.id, exact.id))?.event_count === exactLifecycleBefore.event_count,
    'RUNTIME_LIFECYCLE_NOT_REARMED');

  const concurrentStart = startAt('2026-08-22', '15:00:00');
  const concurrent = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Concurrent reminder',
    date: '2026-08-22', time: '15:00:00', createdAt: shiftMinutes(concurrentStart, -2880),
  });
  const concurrentReference = targetAt(concurrentStart, 60);
  const concurrentResults = await Promise.all([runPsql(`select row_to_json(result)::text from private.process_appointment_reminders_at(${sqlQuote(concurrentReference)}::timestamptz) result;`, { async: true }), runPsql(`select row_to_json(result)::text from private.process_appointment_reminders_at(${sqlQuote(concurrentReference)}::timestamptz) result;`, { async: true })]);
  const concurrentRows = await readReminders(clientA.id);
  const concurrentKey = `appointment_reminder:${concurrent.id}:2026-08-22:15:00:1h`;
  assert(concurrentRows.filter((row) => row.aggregation_key === concurrentKey).length === 1,
    'RUNTIME_CONCURRENT_PROCESSORS_EXACTLY_ONE', concurrentResults.join('|'));

  const cancellationStart = startAt('2026-08-23', '10:00:00');
  const cancellation = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Cancelled before target',
    date: '2026-08-23', time: '10:00:00', createdAt: shiftMinutes(cancellationStart, -2880),
  });
  await updateAppointment(cancellation.id, { status: 'cancelled' }, 'cancellation before target');
  result = runProcessor(targetAt(cancellationStart, 60));
  assert(result.created === 0 && (await readReminders(clientA.id)).every((row) => row.appointment_id !== cancellation.id),
    'RUNTIME_CANCELLATION_BEFORE_THRESHOLD');

  const cancellationRaceStart = startAt('2026-08-24', '10:00:00');
  const cancellationRace = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Cancellation race',
    date: '2026-08-24', time: '10:00:00', createdAt: shiftMinutes(cancellationRaceStart, -2880),
  });
  await processorLockRace({
    appointmentId: cancellationRace.id,
    referenceAt: targetAt(cancellationRaceStart, 60),
    mutationSql: `update public.appointments set status = 'cancelled' where id = ${sqlQuote(cancellationRace.id)};`,
    label: 'RUNTIME_CANCELLATION_RACE_NO_STALE_REMINDER',
  });
  assert((await readReminders(clientA.id)).every((row) => row.appointment_id !== cancellationRace.id), 'RUNTIME_CANCELLATION_RACE_ROW_ZERO');

  const rescheduleRaceOldStart = startAt('2026-08-24', '11:00:00');
  const rescheduleRaceNewStart = startAt('2026-08-25', '11:00:00');
  const rescheduleRace = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Reschedule race',
    date: '2026-08-24', time: '11:00:00', createdAt: shiftMinutes(rescheduleRaceOldStart, -2880),
  });
  await processorLockRace({
    appointmentId: rescheduleRace.id,
    referenceAt: targetAt(rescheduleRaceOldStart, 60),
    mutationSql: `update public.appointments set date = ${sqlQuote('2026-08-25')}, time = ${sqlQuote('11:00:00')} where id = ${sqlQuote(rescheduleRace.id)};`,
    label: 'RUNTIME_RESCHEDULE_RACE_NO_STALE_REMINDER',
  });
  assert((await readReminders(clientA.id)).every((row) => row.appointment_id !== rescheduleRace.id), 'RUNTIME_RESCHEDULE_RACE_ROW_ZERO');
  runProcessor(targetAt(rescheduleRaceNewStart, 60));
  assert((await readReminders(clientA.id)).some((row) => row.appointment_id === rescheduleRace.id
    && row.aggregation_key === `appointment_reminder:${rescheduleRace.id}:2026-08-25:11:00:1h`), 'RUNTIME_RESCHEDULE_RACE_CURRENT_TUPLE_ONLY');

  const deleteRaceStart = startAt('2026-08-25', '10:00:00');
  const deleteRace = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Delete race',
    date: '2026-08-25', time: '10:00:00', createdAt: shiftMinutes(deleteRaceStart, -2880),
  });
  await processorLockRace({
    appointmentId: deleteRace.id,
    referenceAt: targetAt(deleteRaceStart, 60),
    mutationSql: `delete from public.appointments where id = ${sqlQuote(deleteRace.id)};`,
    label: 'RUNTIME_DELETE_RACE_NO_STALE_REMINDER',
  });
  assert(countSql(`select count(*) from public.appointments where id = ${sqlQuote(deleteRace.id)};`) === 0, 'RUNTIME_DELETE_RACE_APPOINTMENT_MISSING');

  const completedStart = startAt('2026-08-26', '10:00:00');
  const completed = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Completed exclusion',
    date: '2026-08-26', time: '10:00:00', createdAt: shiftMinutes(completedStart, -2880),
  });
  await updateAppointment(completed.id, { status: 'completed' }, 'completed exclusion update');
  result = runProcessor(targetAt(completedStart, 60));
  assert(result.created === 0 && (await readReminders(clientA.id)).every((row) => row.appointment_id !== completed.id), 'RUNTIME_COMPLETED_EXCLUSION');

  const late30Start = startAt('2026-08-27', '15:00:00');
  const late30 = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Late created 30m',
    date: '2026-08-27', time: '15:00:00', createdAt: shiftMinutes(late30Start, -30),
  });
  result = runProcessor(shiftMinutes(late30Start, -30));
  assert(result.created === 0 && (await readReminders(clientA.id)).every((row) => row.appointment_id !== late30.id), 'RUNTIME_LATE_CREATED_30M_NO_CATCHUP');

  const lateInsideStart = startAt('2026-08-28', '15:00:00');
  const lateInside = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Late created inside window',
    date: '2026-08-28', time: '15:00:00', createdAt: shiftMinutes(lateInsideStart, -55),
  });
  result = runProcessor(targetAt(lateInsideStart, 60, 5));
  assert(result.created === 0 && (await readReminders(clientA.id)).every((row) => row.appointment_id !== lateInside.id), 'RUNTIME_CREATED_AFTER_TARGET_NO_FABRICATION');

  const late90Start = startAt('2026-08-29', '15:00:00');
  const late90 = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Late created 90m',
    date: '2026-08-29', time: '15:00:00', createdAt: shiftMinutes(late90Start, -90),
  });
  result = runProcessor(shiftMinutes(late90Start, -90));
  assert(result.created === 0, 'RUNTIME_LATE_CREATED_90M_NO_HISTORICAL_24H');
  result = runProcessor(targetAt(late90Start, 60, 5));
  assert(result.created === 1 && (await readReminders(clientA.id)).some((row) => row.appointment_id === late90.id && row.event_type === 'reminder_1h'), 'RUNTIME_LATE_CREATED_90M_FUTURE_1H_ONLY');

  const rescheduleBeforeOldStart = startAt('2026-08-30', '15:00:00');
  const rescheduleBeforeNewStart = startAt('2026-08-31', '15:00:00');
  const rescheduleBefore = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Reschedule before target',
    date: '2026-08-30', time: '15:00:00', createdAt: shiftMinutes(rescheduleBeforeOldStart, -2880),
  });
  await updateAppointment(rescheduleBefore.id, { date: '2026-08-31', time: '15:00:00' }, 'reschedule before old target');
  runProcessor(targetAt(rescheduleBeforeOldStart, 60));
  assert((await readReminders(clientA.id)).every((row) => row.appointment_id !== rescheduleBefore.id), 'RUNTIME_RESCHEDULE_BEFORE_NO_OLD_TUPLE');
  runProcessor(targetAt(rescheduleBeforeNewStart, 60));
  assert((await readReminders(clientA.id)).some((row) => row.appointment_id === rescheduleBefore.id
    && row.aggregation_key === `appointment_reminder:${rescheduleBefore.id}:2026-08-31:15:00:1h`), 'RUNTIME_RESCHEDULE_BEFORE_NEW_TUPLE_ONE');

  const rescheduleAfterOldStart = startAt('2026-09-01', '15:00:00');
  const rescheduleAfterNewStart = startAt('2026-09-02', '15:00:00');
  const rescheduleAfter = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Reschedule after reminder',
    date: '2026-09-01', time: '15:00:00', createdAt: shiftMinutes(rescheduleAfterOldStart, -2880),
  });
  runProcessor(targetAt(rescheduleAfterOldStart, 1440));
  await updateAppointment(rescheduleAfter.id, { date: '2026-09-02', time: '15:00:00' }, 'reschedule after old reminder');
  runProcessor(targetAt(rescheduleAfterNewStart, 1440));
  runProcessor(targetAt(rescheduleAfterNewStart, 60));
  const rescheduleAfterRows = (await readReminders(clientA.id)).filter((row) => row.appointment_id === rescheduleAfter.id);
  assert(rescheduleAfterRows.length === 3
    && rescheduleAfterRows.some((row) => row.aggregation_key === `appointment_reminder:${rescheduleAfter.id}:2026-09-01:15:00:24h`)
    && rescheduleAfterRows.some((row) => row.aggregation_key === `appointment_reminder:${rescheduleAfter.id}:2026-09-02:15:00:24h`)
    && rescheduleAfterRows.some((row) => row.aggregation_key === `appointment_reminder:${rescheduleAfter.id}:2026-09-02:15:00:1h`),
  'RUNTIME_RESCHEDULE_AFTER_RETAINS_OLD_AND_CREATES_NEW');

  const sameTupleAStart = startAt('2026-09-03', '15:00:00');
  const sameTupleBStart = startAt('2026-09-04', '15:00:00');
  const sameTuple = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Same tuple round trip',
    date: '2026-09-03', time: '15:00:00', createdAt: shiftMinutes(sameTupleAStart, -2880),
  });
  runProcessor(targetAt(sameTupleAStart, 1440));
  await updateAppointment(sameTuple.id, { date: '2026-09-04', time: '15:00:00' }, 'same tuple move away');
  await updateAppointment(sameTuple.id, { date: '2026-09-03', time: '15:00:00' }, 'same tuple move back');
  runProcessor(targetAt(sameTupleAStart, 1440));
  const sameTupleRows = (await readReminders(clientA.id)).filter((row) => row.appointment_id === sameTuple.id);
  assert(sameTupleRows.length === 1 && sameTupleRows[0].aggregation_key === `appointment_reminder:${sameTuple.id}:2026-09-03:15:00:24h`, 'RUNTIME_SAME_TUPLE_ROUND_TRIP_NO_DUPLICATE');

  const relationRemovedStart = startAt('2026-09-05', '15:00:00');
  const relationRemovedAppointment = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientB.id, title: 'Relationship removed reminder',
    date: '2026-09-05', time: '15:00:00', createdAt: shiftMinutes(relationRemovedStart, -2880),
  });
  await updateRelationship(relationAB.id, 'removed', 'relationship removed before reminder');
  runProcessor(targetAt(relationRemovedStart, 60));
  assert((await readReminders(clientB.id)).every((row) => row.appointment_id !== relationRemovedAppointment.id), 'RUNTIME_RELATIONSHIP_REMOVED_NO_REMINDER');
  await updateRelationship(relationAB.id, 'pending', 'relationship re-pending');
  await updateRelationship(relationAB.id, 'active', 'relationship reactivated');

  const relationshipRaceStart = startAt('2026-09-05', '16:00:00');
  const relationshipRaceAppointment = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientB.id, title: 'Relationship race',
    date: '2026-09-05', time: '16:00:00', createdAt: shiftMinutes(relationshipRaceStart, -2880),
  });
  await processorLockRace({
    appointmentId: relationshipRaceAppointment.id,
    referenceAt: targetAt(relationshipRaceStart, 60),
    mutationSql: `update public.dietitian_clients set status = 'removed' where id = ${sqlQuote(relationAB.id)};`,
    label: 'RUNTIME_RELATIONSHIP_RACE_NO_STALE_REMINDER',
  });
  assert((await readReminders(clientB.id)).every((row) => row.appointment_id !== relationshipRaceAppointment.id), 'RUNTIME_RELATIONSHIP_RACE_ROW_ZERO');
  await updateRelationship(relationAB.id, 'pending', 'relationship race re-pending');
  await updateRelationship(relationAB.id, 'active', 'relationship race reactivated');

  const ordinaryStart = startAt('2026-09-06', '14:00:00');
  const ordinary = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Istanbul ordinary',
    date: '2026-09-06', time: '14:00:00', createdAt: shiftMinutes(ordinaryStart, -2880),
  });
  runProcessor(targetAt(ordinaryStart, 1440));
  assert((await readReminders(clientA.id)).some((row) => row.appointment_id === ordinary.id && row.appointment_date === '2026-09-06'), 'RUNTIME_ISTANBUL_ORDINARY');

  const midnightStart = startAt('2026-09-07', '00:05:00');
  const midnight = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Istanbul midnight',
    date: '2026-09-07', time: '00:05:00', createdAt: shiftMinutes(midnightStart, -2880),
  });
  runProcessor(targetAt(midnightStart, 60, 5));
  assert((await readReminders(clientA.id)).some((row) => row.appointment_id === midnight.id && row.appointment_date === '2026-09-07'), 'RUNTIME_ISTANBUL_MIDNIGHT');

  const utcBoundaryStart = startAt('2026-09-08', '00:30:00');
  const utcBoundary = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Istanbul UTC boundary',
    date: '2026-09-08', time: '00:30:00', createdAt: shiftMinutes(utcBoundaryStart, -2880),
  });
  const utcBoundaryReference = targetAt(utcBoundaryStart, 60, 5);
  assert(utcBoundaryReference.startsWith('2026-09-07T20:'), 'RUNTIME_UTC_REFERENCE_PREVIOUS_DATE', utcBoundaryReference);
  runProcessor(utcBoundaryReference);
  assert((await readReminders(clientA.id)).some((row) => row.appointment_id === utcBoundary.id && row.appointment_date === '2026-09-08'), 'RUNTIME_ISTANBUL_CIVIL_DATE_PRESERVED');

  const monthBoundaryStart = startAt('2026-10-01', '00:30:00');
  const monthBoundary = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Istanbul month boundary',
    date: '2026-10-01', time: '00:30:00', createdAt: shiftMinutes(monthBoundaryStart, -2880),
  });
  runProcessor(targetAt(monthBoundaryStart, 60, 5));
  assert((await readReminders(clientA.id)).some((row) => row.appointment_id === monthBoundary.id && row.appointment_date === '2026-10-01'), 'RUNTIME_ISTANBUL_MONTH_BOUNDARY');

  const yearBoundaryStart = startAt('2027-01-01', '00:30:00');
  const yearBoundary = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Istanbul year boundary',
    date: '2027-01-01', time: '00:30:00', createdAt: shiftMinutes(yearBoundaryStart, -2880),
  });
  runProcessor(targetAt(yearBoundaryStart, 60, 5));
  assert((await readReminders(clientA.id)).some((row) => row.appointment_id === yearBoundary.id && row.appointment_date === '2027-01-01'), 'RUNTIME_ISTANBUL_YEAR_BOUNDARY');

  assert(exact24.actor_id === null && exact24.actor_display_name === null
    && exact24.conversation_id === null && exact24.dietitian_client_id === null
    && exact24.appointment_status === 'upcoming' && exact24.event_count === 1,
  'RUNTIME_SAFE_SNAPSHOT_FIELDS');
  const hasBody = readSql(`select (to_jsonb(n) ? 'body')::text from public.notifications n where n.id = ${sqlQuote(exact24.id)};`);
  assert(['f', 'false'].includes(hasBody.toLowerCase()), 'RUNTIME_SAFE_SNAPSHOT_NO_BODY_COLUMN', hasBody);
  assertDenied(await api.clientB.from('notifications').select('id').eq('id', exact24.id), 'RUNTIME_CROSS_CLIENT_RLS_DENY');
  assertDenied(await api.dietitianA.from('notifications').select('id').eq('id', exact24.id), 'RUNTIME_DIETITIAN_RLS_DENY');
  assertDenied(await api.clientA.rpc('process_appointment_reminders'), 'RUNTIME_CLIENT_PROCESSOR_NOT_EXPOSED');
  assertDenied(await api.clientA.rpc('insert_appointment_reminder_once'), 'RUNTIME_CLIENT_PRODUCER_NOT_EXPOSED');

  const recoveryStart = startAt('2027-02-01', '15:00:00');
  const recovery = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Failed run recovery',
    date: '2027-02-01', time: '15:00:00', createdAt: shiftMinutes(recoveryStart, -2880),
  });
  runProcessor(targetAt(recoveryStart, 60, 5));
  assert((await readReminders(clientA.id)).some((row) => row.appointment_id === recovery.id), 'RUNTIME_FAILED_RUN_RECOVERY_WITHIN_WINDOW');

  const expiredStart = startAt('2027-02-02', '15:00:00');
  const expired = await createAppointment({
    dietitianId: dietitianA.id, clientId: clientA.id, title: 'Expired delivery window',
    date: '2027-02-02', time: '15:00:00', createdAt: shiftMinutes(expiredStart, -2880),
  });
  runProcessor(targetAt(expiredStart, 60, 11));
  assert((await readReminders(clientA.id)).every((row) => row.appointment_id !== expired.id), 'RUNTIME_EXPIRED_WINDOW_NO_CATCHUP');

  const explainRows = await admin.from('appointments').insert(Array.from({ length: 2000 }, (_, index) => ({
    dietitian_id: dietitianA.id,
    client_id: clientA.id,
    title: `Reminder EXPLAIN fixture ${index}`,
    date: new Date(Date.UTC(2020, 0, 1 + index)).toISOString().slice(0, 10),
    time: '08:00:00',
    duration: 30,
    type: 'online',
    status: 'upcoming',
    created_at: '2026-01-01T08:00:00.000Z',
  }))).select('id');
  assertNoError(explainRows, 'EXPLAIN fixture insert');
  const explainSql = "explain (format json, costs off) select a.id from public.appointments a where a.status = 'upcoming' and a.date between date '2026-08-20' and date '2026-08-22' and a.client_id is not null;";
  const explainPlan = readSql(explainSql);
  assert(explainPlan.includes('appointments_upcoming_reminder_candidate_idx'), 'EXPLAIN_TARGETED_INDEX_USED');
  assert(/Index Scan|Index Only Scan|Bitmap Index Scan|Bitmap Heap Scan/.test(explainPlan), 'EXPLAIN_TARGETED_INDEX_PLAN', explainPlan.slice(0, 500));
  assert(countSql("select count(*) from public.appointments where title like 'Reminder EXPLAIN fixture %';") === 2000, 'EXPLAIN_FIXTURE_COUNT');
  runCurrentProcessor();
  pass('RUNTIME_NO_APPOINTMENT_MUTATION_PROCESSOR_ONLY');

  const sourceCount = countSql(`select count(*) from public.appointments where id = any(${sqlUuidArray(appointmentIds)});`);
  assert(sourceCount === appointmentIds.filter(Boolean).length - 1, 'RUNTIME_TRACKED_APPOINTMENT_SOURCE_COUNT_STABLE');
  pass('APPOINTMENT_REMINDER_RUNTIME_MATRIX_PASS');
};

try {
  await runFlows();
} catch (error) {
  mainError = error;
} finally {
  if (admin) {
    try {
      await cleanupFixtures();
    } catch (error) {
      if (mainError) mainError.message += `; fixture cleanup failed: ${error.message}`;
      else mainError = error;
    }
  }
  if (disposable?.tempRoot && stackStartAttempted) {
    try {
      runCli(disposable.tempRoot, ['stop', '--project-id', projectId, '--no-backup']);
      stackStarted = false;
      pass('REMINDER_DISPOSABLE_LOCAL_STACK_STOPPED', projectId);
    } catch (error) {
      if (mainError) mainError.message += `; local stack stop failed: ${redact(error.message)}`;
      else mainError = error;
    }
  }
  if (disposable?.tempRoot) {
    const tempParent = dirname(disposable.tempRoot);
    try {
      rmSync(tempParent, { recursive: true, force: true });
      assert(!existsSync(tempParent), 'REMINDER_DISPOSABLE_TEMP_RESIDUE_ZERO');
    } catch (error) {
      if (mainError) mainError.message += `; temp cleanup failed: ${error.message}`;
      else mainError = error;
    }
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
    assert(containerResidual === '' && volumeResidual === '' && networkResidual === '', 'REMINDER_DISPOSABLE_DOCKER_RESIDUE_ZERO');
  } catch (error) {
    if (mainError) mainError.message += `; Docker residue verification failed: ${redact(error.message)}`;
    else mainError = error;
  }
}

if (mainError) throw mainError;
