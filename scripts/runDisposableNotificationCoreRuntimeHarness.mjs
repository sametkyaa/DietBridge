#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';

import { createClient } from '@supabase/supabase-js';
import { materializeDisposableReplay } from './materializeDisposableSupabaseReplay.mjs';
import { LOCAL_PREREQUISITE_FILE, LOCAL_PREREQUISITE_SQL } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = join(repoRoot, 'supabase', 'migrations');
const notificationCoreMigrationName = '20260814214101_notification_core_backend.sql';
const markAllReadMigrationName = '20260816101405_mark_all_notifications_read.sql';
const appointmentReminderMigrationName = '20260816194431_appointment_reminders_backend.sql';
const pushRegistryMigrationName = '20260817120000_push_registry_outbox_backend.sql';
const supabaseVersion = '2.110.0';
const password = 'Disposable-Notification-Core-4m!';
const projectId = 'dietbridge-notification-' + process.pid + '-' + randomUUID().slice(0, 8);
const npxCli = process.env.npm_execpath
  ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');

const actorIds = [];
const relationshipIds = [];
const appointmentIds = [];
const planIds = [];
const mealIds = [];
const messageIds = [];
const conversationIds = [];
const imageIntentIds = [];
const storagePaths = [];

let disposable;
let local;
let admin;
let stackStartAttempted = false;
let stackStarted = false;
let mainError;

const pass = (label, detail = '') => {
  process.stdout.write('PASS: ' + label + (detail ? ' ' + detail : '') + '\n');
};

const assert = (condition, label, detail = '') => {
  if (!condition) {
    throw new Error(label + (detail ? ': ' + detail : ''));
  }
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

const assertDenied = (result, label) => {
  const denied = Boolean(result?.error)
    || !Array.isArray(result?.data)
    || result.data.length === 0;
  assert(denied, label, result?.error?.code ? 'denied=' + result.error.code : '');
};

const assertRpcError = (result, label) => {
  assert(Boolean(result?.error), label, result?.error?.code ? 'denied=' + result.error.code : '');
};

const assertLoopback = (url) => {
  const parsed = new URL(url);
  assert(parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'),
    'DISPOSABLE_LOOPBACK_ONLY', parsed.hostname);
};

const cleanEnvironment = (environment) => Object.fromEntries(
  Object.entries(environment).filter(([key]) => !(
    /^(?:SUPABASE|VITE_SUPABASE|EXPO_PUBLIC_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)
  )),
);

const runCli = (tempRoot, args) => {
  try {
    return execFileSync(
      process.execPath,
      [npxCli, '--yes', 'supabase@' + supabaseVersion, '--workdir', tempRoot, ...args],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...cleanEnvironment(process.env), TZ: 'Europe/Istanbul' },
        maxBuffer: 32 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
      },
    );
  } catch (error) {
    throw new Error('Supabase ' + args.join(' ') + ' failed: ' + redact(error.message)
      + '\n' + redact(String(error.stdout ?? '').slice(-6000))
      + '\n' + redact(String(error.stderr ?? '').slice(-6000)));
  }
};

const parseStatus = (value) => Object.fromEntries(
  value.split(/\r?\n/)
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
  const dockerPortMatches = execFileSync('docker', ['ps', '--format', '{{.Ports}}'], {
    encoding: 'utf8',
    timeout: 30_000,
  }).matchAll(/(?:0\.0\.0\.0:|\[::\]:)(\d+)->/g);
  const dockerPorts = new Set(Array.from(dockerPortMatches, (match) => Number(match[1])));
  const first = 58000 + (process.pid % 500);
  for (let offset = 0; offset < 5000; offset += 20) {
    const base = first + offset;
    const ports = [base, base + 1, base + 2, base + 3, base + 4, base + 7, base + 9, base + 83];
    if (ports.some((port) => dockerPorts.has(port))) continue;
    if ((await Promise.all(ports.map(isPortFree))).every(Boolean)) return base;
  }
  throw new Error('No disposable loopback port range is available.');
};

const configureDisposableProject = async (configPath) => {
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
  const result = await createAnonymousClient().auth.signInWithPassword({
    email: actor.email,
    password,
  });
  const session = assertNoError(result, actor.label + ' sign-in');
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + session.session.access_token } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const createActor = async (label, role) => {
  const result = await admin.auth.admin.createUser({
    email: 'notification-core-' + label + '-' + randomUUID() + '@example.invalid',
    password,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: 'Disposable ' + label,
      notification_core_harness: 'disposable-test-identity',
    },
  });
  const data = assertNoError(result, label + ' Auth fixture');
  assert(Boolean(data.user?.id), label.toUpperCase() + '_AUTH_CREATED');
  actorIds.push(data.user.id);
  return {
    id: data.user.id,
    email: data.user.email,
    label,
    role,
  };
};

const approveDietitian = async (actor) => {
  const row = assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: 'approved',
    is_verified: true,
    verified_at: '2026-08-15T08:00:00.000Z',
    rejection_reason: null,
  }).eq('user_id', actor.id).select('user_id,verification_status,is_verified').single(), actor.label + ' approval');
  assert(row.verification_status === 'approved' && row.is_verified === true,
    actor.label.toUpperCase() + '_APPROVED');
};

const bootstrapCore = async (actor) => {
  const row = assertNoError(await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: actor.id,
    plan_id: 'core',
    status: 'active',
    client_limit_override: null,
  }).select('dietitian_id,plan_id,status').single(), actor.label + ' subscription');
  assert(row.dietitian_id === actor.id && row.status === 'active', actor.label.toUpperCase() + '_CORE_BOOTSTRAP');
};

const insertPendingRelationship = async (dietitian, client, label) => {
  const row = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id,
    client_id: client.id,
    status: 'pending',
  }).select('id,dietitian_id,client_id,status').single(), label + ' pending relationship');
  relationshipIds.push(row.id);
  return row;
};

const updateRelationship = async (relationId, status, label) => assertNoError(
  await admin.from('dietitian_clients').update({ status }).eq('id', relationId)
    .select('id,dietitian_id,client_id,status').single(),
  label + ' relationship update',
);

const activateRelationship = async (dietitian, client, label) => {
  const pending = await insertPendingRelationship(dietitian, client, label);
  const active = await updateRelationship(pending.id, 'active', label + ' active');
  assert(active.status === 'active', label + '_ACTIVE');
  return active;
};

const readNotification = async (recipientId, aggregationKey, label) => {
  const rows = assertNoError(await admin.from('notifications')
    .select('*')
    .eq('recipient_id', recipientId)
    .eq('aggregation_key', aggregationKey), label + ' notification read');
  assert(rows.length <= 1, label + '_ONE_AGGREGATE_ROW', 'rows=' + rows.length);
  return rows[0] ?? null;
};

const deleteNotification = async (recipientId, aggregationKey, label) => {
  assertNoError(await admin.from('notifications').delete()
    .eq('recipient_id', recipientId)
    .eq('aggregation_key', aggregationKey)
    .select('id'), label + ' notification cleanup');
};

const notificationSnapshot = async (label) => {
  const rows = assertNoError(await admin.from('notifications')
    .select('id,recipient_id,category,event_type,aggregation_key,event_count,seen_at,read_at')
    .order('id'), label);
  return JSON.stringify(rows);
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

const uploadStorage = async (client, bucket, path, bytes, contentType, label) => {
  storagePaths.push({ bucket, path });
  assertNoError(await client.storage.from(bucket).upload(path, bytes, {
    contentType,
    upsert: false,
  }), label);
};

const mealDays = (targetMeal) => {
  const dates = ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'];
  return dates.map((planDate, index) => ({
    plan_date: planDate,
    notes: index === 4 ? 'Notification Core meal visibility fixture' : null,
    meals: index === 4 ? [targetMeal] : [],
  }));
};

const mealPayloadFromRow = (meal, photoUrl) => ({
  id: meal.id,
  type: meal.type,
  title: meal.title,
  description: meal.description ?? null,
  calories: meal.calories,
  macros: meal.macros,
  time: typeof meal.time === 'string' ? meal.time.slice(0, 5) : meal.time,
  sort_order: meal.sort_order,
  source: meal.source,
  recipe_id: meal.recipe_id ?? null,
  photo_url: photoUrl ?? meal.photo_url ?? null,
});

const countBySql = (sql) => Number(readSchema(sql));

const sqlUuidArray = (values) => values.length
  ? 'ARRAY[' + values.map((value) => "'" + value + "'").join(',') + ']::uuid[]'
  : 'ARRAY[]::uuid[]';

const sqlTextArray = (values) => values.length
  ? 'ARRAY[' + values.map((value) => "'" + value.replaceAll("'", "''") + "'").join(',') + ']::text[]'
  : 'ARRAY[]::text[]';

const cleanupFixtures = async () => {
  if (!admin) return;

  for (const item of storagePaths) {
    assertNoError(await admin.storage.from(item.bucket).remove([item.path]), 'storage fixture cleanup ' + item.bucket);
  }

  if (conversationIds.length) {
    assertNoError(await admin.from('chat_read_states').delete()
      .in('conversation_id', conversationIds), 'chat read-state cleanup');
    assertNoError(await admin.from('chat_attachments').delete()
      .in('message_id', messageIds), 'chat attachment cleanup');
    assertNoError(await admin.from('chat_upload_intents').delete()
      .in('id', imageIntentIds), 'chat intent cleanup');
    assertNoError(await admin.from('chat_conversations').update({
      last_message_id: null,
      last_message_at: null,
    }).in('id', conversationIds), 'chat pointer cleanup');
    assertNoError(await admin.from('chat_messages').delete()
      .in('id', messageIds), 'chat message cleanup');
    assertNoError(await admin.from('chat_conversations').delete()
      .in('id', conversationIds), 'chat conversation cleanup');
  }

  if (appointmentIds.length) {
    assertNoError(await admin.from('appointments').delete().in('id', appointmentIds), 'appointment cleanup');
  }

  if (planIds.length) {
    assertNoError(await admin.from('meal_plans').delete().in('id', planIds), 'meal plan cleanup');
  }

  if (relationshipIds.length) {
    assertNoError(await admin.from('dietitian_clients').delete().in('id', relationshipIds), 'relationship cleanup');
  }

  if (actorIds.length) {
    assertNoError(await admin.from('notifications').delete().in('recipient_id', actorIds), 'notification cleanup');
    assertNoError(await admin.from('dietitian_subscriptions').delete().in('dietitian_id', actorIds), 'subscription cleanup');
  }

  for (const actorId of [...actorIds].reverse()) {
    const result = await admin.auth.admin.deleteUser(actorId);
    assertNoError(result, 'Auth cleanup');
  }

  const actors = sqlUuidArray(actorIds);
  const storageNames = sqlTextArray(storagePaths.map((item) => item.path));
  const residue = {
    notifications: countBySql('select count(*) from public.notifications where recipient_id = any(' + actors + ');'),
    relationships: countBySql('select count(*) from public.dietitian_clients where id = any(' + sqlUuidArray(relationshipIds) + ');'),
    appointments: countBySql('select count(*) from public.appointments where id = any(' + sqlUuidArray(appointmentIds) + ');'),
    plans: countBySql('select count(*) from public.meal_plans where id = any(' + sqlUuidArray(planIds) + ');'),
    meals: countBySql('select count(*) from public.meals where id = any(' + sqlUuidArray(mealIds) + ');'),
    messages: countBySql('select count(*) from public.chat_messages where id = any(' + sqlUuidArray(messageIds) + ');'),
    conversations: countBySql('select count(*) from public.chat_conversations where id = any(' + sqlUuidArray(conversationIds) + ');'),
    auth: countBySql('select count(*) from auth.users where id = any(' + actors + ');'),
    storage: countBySql('select count(*) from storage.objects where name = any(' + storageNames + ');'),
  };
  for (const [label, value] of Object.entries(residue)) {
    assert(value === 0, 'RESIDUE_' + label.toUpperCase() + '_ZERO', 'count=' + value);
  }
  pass('DISPOSABLE_FIXTURES_CLEAN');
};

const runFlows = async () => {
  const sourceMigrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  assert(sourceMigrations.length === 50, 'CANONICAL_MIGRATION_INVENTORY_50');
  assert(sourceMigrations.at(-1) === '20260827084741_standalone_platform_admin_access.sql', 'CANONICAL_MIGRATION_TAIL', sourceMigrations.at(-1));

  const tempParent = mkdtempSync(join(tmpdir(), 'dietbridge-notification-core-'));
  const tempRoot = join(tempParent, 'project');
  const runtimeManifest = materializeDisposableReplay({ repoRoot, outputRoot: tempRoot });
  const configPath = join(tempRoot, 'supabase', 'config.toml');
  copyFileSync(join(repoRoot, 'supabase', 'config.toml'), configPath, 1);
  disposable = {
    tempRoot,
    configPath,
    disposableHistory: { repositoryMigrationCount: runtimeManifest.expectedHistory.total },
  };
  assert(disposable.disposableHistory.repositoryMigrationCount === 47, 'BASELINE_MATERIALIZED_COUNT_47');
  const runtimeMigrationDirectory = join(disposable.tempRoot, 'supabase', 'migrations');
  const destinationMigration = join(runtimeMigrationDirectory, notificationCoreMigrationName);
  if (existsSync(destinationMigration)) throw new Error('Disposable migration destination already exists.');
  copyFileSync(join(migrationDirectory, notificationCoreMigrationName), destinationMigration, 1);
  const appointmentReminderDestination = join(runtimeMigrationDirectory, appointmentReminderMigrationName);
  if (existsSync(appointmentReminderDestination)) throw new Error('Disposable reminder migration destination already exists.');
  copyFileSync(join(migrationDirectory, appointmentReminderMigrationName), appointmentReminderDestination, 1);
  const pushRegistryDestination = join(runtimeMigrationDirectory, pushRegistryMigrationName);
  if (existsSync(pushRegistryDestination)) throw new Error('Disposable Push registry migration destination already exists.');
  copyFileSync(join(migrationDirectory, pushRegistryMigrationName), pushRegistryDestination, 1);
  const prerequisitePath = join(runtimeMigrationDirectory, LOCAL_PREREQUISITE_FILE);
  writeFileSync(prerequisitePath, LOCAL_PREREQUISITE_SQL, { flag: 'wx' });
  const runtimeFiles = readdirSync(runtimeMigrationDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  assert(runtimeFiles.length === 51, 'DISPOSABLE_MIGRATION_FILES_51_WITH_ONE_LOCAL_PREREQUISITE');
  assert(runtimeFiles.includes(markAllReadMigrationName), 'DISPOSABLE_MARK_ALL_READ_MIGRATION_REPLAY');
  assert(runtimeFiles.includes(appointmentReminderMigrationName), 'DISPOSABLE_APPOINTMENT_REMINDER_MIGRATION_REPLAY');
  assert(runtimeFiles.includes(pushRegistryMigrationName), 'DISPOSABLE_PUSH_REGISTRY_MIGRATION_REPLAY');

  await configureDisposableProject(disposable.configPath);
  stackStartAttempted = true;
  runCli(disposable.tempRoot, ['start']);
  stackStarted = true;
  pass('DISPOSABLE_LOCAL_STACK_STARTED', projectId);

  runCli(disposable.tempRoot, ['db', 'reset', '--local', '--no-seed']);
  const migrationCount = countBySql('select count(*) from supabase_migrations.schema_migrations;');
  assert(migrationCount === 51, 'DISPOSABLE_SCHEMA_MIGRATION_COUNT', 'canonical=50, local-prerequisite=1');
  pass('DISPOSABLE_CANONICAL_MIGRATION_REPLAY_50');

  local = parseStatus(runCli(disposable.tempRoot, ['status', '--output', 'env']));
  assertLoopback(local.API_URL);
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'DISPOSABLE_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const publicationCount = countBySql(
    "select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications';",
  );
  assert(publicationCount === 1, 'REALTIME_PUBLICATION_RUNTIME');

  const dietitianA = await createActor('dietitian-a', 'dietitian');
  const dietitianB = await createActor('dietitian-b', 'dietitian');
  const clientA = await createActor('client-a', 'client');
  const clientB = await createActor('client-b', 'client');
  await approveDietitian(dietitianA);
  await approveDietitian(dietitianB);
  await bootstrapCore(dietitianA);
  await bootstrapCore(dietitianB);

  const relationAA = await activateRelationship(dietitianA, clientA, 'DIETITIAN_A_CLIENT_A');
  const pendingAB = await insertPendingRelationship(dietitianA, clientB, 'DIETITIAN_A_CLIENT_B');
  const api = {
    dietitianA: await createActorClient(dietitianA),
    dietitianB: await createActorClient(dietitianB),
    clientA: await createActorClient(clientA),
    clientB: await createActorClient(clientB),
    anonymous: createAnonymousClient(),
  };

  const pendingKey = 'relationship:' + pendingAB.id;
  let pendingNotification = await readNotification(clientB.id, pendingKey, 'RELATIONSHIP_INSERT_PENDING');
  assert(pendingNotification?.event_type === 'request_pending'
    && pendingNotification.actor_id === dietitianA.id
    && pendingNotification.recipient_id === clientB.id
    && pendingNotification.relationship_from_status === null
    && pendingNotification.relationship_to_status === 'pending',
  'RELATIONSHIP_INSERT_PENDING_RUNTIME');

  const activeAB = await updateRelationship(pendingAB.id, 'active', 'DIETITIAN_A_CLIENT_B_ACCEPT');
  assert(activeAB.status === 'active', 'RELATIONSHIP_ACCEPTED_RUNTIME');
  let dietitianNotification = await readNotification(dietitianA.id, pendingKey, 'RELATIONSHIP_ACCEPTED');
  assert(dietitianNotification?.event_type === 'accepted'
    && dietitianNotification.actor_id === clientB.id
    && dietitianNotification.recipient_id === dietitianA.id
    && dietitianNotification.relationship_from_status === 'pending'
    && dietitianNotification.relationship_to_status === 'active',
  'RELATIONSHIP_ACCEPTED_RUNTIME');
  const dietitianNotificationId = dietitianNotification.id;

  const relationAARow = await admin.from('dietitian_clients').select('id').eq('id', relationAA.id).single();
  assertNoError(relationAARow, 'relationship A/A fixture read');

  const ownDietitianRead = await api.dietitianA.from('notifications').select('id').eq('id', dietitianNotificationId);
  assertNoError(ownDietitianRead, 'DIETITIAN_OWN_NOTIFICATION_READ');
  assert(ownDietitianRead.data.length === 1, 'DIETITIAN_RECIPIENT_OWN_READ');
  assertDenied(await api.dietitianB.from('notifications').select('id').eq('id', dietitianNotificationId), 'DIETITIAN_FOREIGN_NOTIFICATION_DENY');
  assertDenied(await api.clientA.from('notifications').select('id').eq('id', dietitianNotificationId), 'CLIENT_FOREIGN_DIETITIAN_NOTIFICATION_DENY');
  assertDenied(await api.anonymous.from('notifications').select('id').eq('id', dietitianNotificationId), 'ANON_DIETITIAN_NOTIFICATION_DENY');

  const chatMessageOne = assertNoError(await api.dietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationAA.id,
    p_client_message_id: randomUUID(),
    p_body: 'Disposable chat message one',
  }), 'chat message one');
  messageIds.push(chatMessageOne.id);
  const conversationId = chatMessageOne.conversation_id;
  conversationIds.push(conversationId);
  const chatKey = 'chat:' + conversationId;
  let chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_ONE');
  assert(chatNotification?.event_type === 'new_message' && chatNotification.event_count === 1
    && chatNotification.seen_at === null && chatNotification.read_at === null,
  'CHAT_NOTIFICATION_ONE');

  const chatMessageTwo = assertNoError(await api.dietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationAA.id,
    p_client_message_id: randomUUID(),
    p_body: 'Disposable chat message two',
  }), 'chat message two');
  messageIds.push(chatMessageTwo.id);
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_TWO');
  assert(chatNotification?.event_count === 2 && chatNotification.id === chatNotification.id, 'CHAT_NOTIFICATION_AGGREGATES_TWO');

  assertNoError(await api.clientA.rpc('mark_notification_seen', { p_notification_id: chatNotification.id }), 'mark chat notification seen');
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_SEEN');
  assert(chatNotification?.seen_at !== null && chatNotification?.read_at === null, 'CHAT_MARK_SEEN');

  const chatMessageThree = assertNoError(await api.dietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationAA.id,
    p_client_message_id: randomUUID(),
    p_body: 'Disposable chat message three',
  }), 'chat message three');
  messageIds.push(chatMessageThree.id);
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_THREE');
  assert(chatNotification?.event_count === 3 && chatNotification.seen_at === null && chatNotification.read_at === null, 'CHAT_REARMS_AFTER_SEEN');

  assertNoError(await api.clientA.rpc('mark_notification_read', { p_notification_id: chatNotification.id }), 'mark chat notification read');
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_READ');
  assert(chatNotification?.seen_at !== null && chatNotification?.read_at !== null, 'CHAT_MARK_READ_IMPLIES_SEEN');

  const fourthMessageId = randomUUID();
  const chatMessageFour = assertNoError(await api.dietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationAA.id,
    p_client_message_id: fourthMessageId,
    p_body: 'Disposable chat message four',
  }), 'chat message four');
  messageIds.push(chatMessageFour.id);
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_FOUR');
  assert(chatNotification?.event_count === 1 && chatNotification.seen_at === null && chatNotification.read_at === null, 'CHAT_READ_RESETS_COUNT');

  const retryMessage = assertNoError(await api.dietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationAA.id,
    p_client_message_id: fourthMessageId,
    p_body: 'Disposable chat message four',
  }), 'chat retry');
  assert(retryMessage.id === chatMessageFour.id, 'CHAT_RETRY_IDEMPOTENT');
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_RETRY');
  assert(chatNotification?.event_count === 1, 'CHAT_RETRY_NO_INCREMENT');

  const concurrentMessages = await Promise.all([
    api.dietitianA.rpc('send_chat_message', {
      p_dietitian_client_id: relationAA.id,
      p_client_message_id: randomUUID(),
      p_body: 'Disposable concurrent chat one',
    }),
    api.dietitianA.rpc('send_chat_message', {
      p_dietitian_client_id: relationAA.id,
      p_client_message_id: randomUUID(),
      p_body: 'Disposable concurrent chat two',
    }),
  ]);
  for (const attempt of concurrentMessages) {
    assertNoError(attempt, 'concurrent chat send');
    messageIds.push(attempt.data.id);
  }
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_CONCURRENT');
  assert(chatNotification?.event_count === 3 && chatNotification.seen_at === null && chatNotification.read_at === null,
    'CHAT_CONCURRENT_NO_LOST_INCREMENT');

  const directInsert = await api.clientA.from('notifications').insert({
    recipient_id: clientA.id,
    category: 'chat_message',
    event_type: 'new_message',
    aggregation_key: 'chat:direct-deny',
    conversation_id: conversationId,
    summary_key: 'chat_new_message',
  }).select('id');
  assertDenied(directInsert, 'NOTIFICATION_DIRECT_INSERT_DENY');
  const directUpdate = await api.clientA.from('notifications').update({
    seen_at: new Date().toISOString(),
  }).eq('id', chatNotification.id).select('id');
  assertDenied(directUpdate, 'NOTIFICATION_DIRECT_UPDATE_DENY');
  const directDelete = await api.clientA.from('notifications').delete()
    .eq('id', chatNotification.id).select('id');
  assertDenied(directDelete, 'NOTIFICATION_DIRECT_DELETE_DENY');
  assertDenied(await api.clientB.from('notifications').select('id').eq('id', chatNotification.id), 'NOTIFICATION_FOREIGN_SELECT_DENY');
  assertDenied(await api.dietitianA.from('notifications').select('id').eq('id', chatNotification.id), 'NOTIFICATION_FOREIGN_DIETITIAN_SELECT_DENY');
  assertDenied(await api.anonymous.from('notifications').select('id').eq('id', chatNotification.id), 'NOTIFICATION_ANON_SELECT_DENY');
  assertRpcError(await api.clientB.rpc('mark_notification_seen', { p_notification_id: chatNotification.id }), 'NOTIFICATION_FOREIGN_SEEN_DENY');
  assertRpcError(await api.anonymous.rpc('mark_notification_seen', { p_notification_id: chatNotification.id }), 'NOTIFICATION_ANON_SEEN_DENY');

  const imageClientMessageId = randomUUID();
  const imageIntent = assertNoError(await api.dietitianA.rpc('create_chat_image_upload_intent', {
    p_conversation_id: conversationId,
    p_client_message_id: imageClientMessageId,
    p_expected_mime: 'image/jpeg',
  }), 'chat image intent');
  imageIntentIds.push(imageIntent.id);
  const imageBytes = Buffer.from('JFIF-disposable-notification-image');
  await uploadStorage(api.dietitianA, 'chat-images', imageIntent.object_path, imageBytes, 'image/jpeg', 'chat image upload');
  assertNoError(await admin.rpc('record_chat_image_validation', {
    p_intent_id: imageIntent.id,
    p_validated_mime: 'image/jpeg',
    p_validated_byte_size: imageBytes.length,
    p_validated_width: 10,
    p_validated_height: 10,
  }), 'chat image validation');
  const imageMessage = assertNoError(await api.dietitianA.rpc('finalize_chat_image_message', {
    p_intent_id: imageIntent.id,
    p_caption: 'Disposable image caption',
  }), 'chat image finalize');
  messageIds.push(imageMessage.id);
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_IMAGE');
  assert(chatNotification?.event_count === 4 && chatNotification.seen_at === null && chatNotification.read_at === null,
    'CHAT_IMAGE_NOTIFICATION');
  const imageRetry = assertNoError(await api.dietitianA.rpc('finalize_chat_image_message', {
    p_intent_id: imageIntent.id,
    p_caption: 'Disposable image caption',
  }), 'chat image retry');
  assert(imageRetry.id === imageMessage.id, 'CHAT_IMAGE_RETRY_IDEMPOTENT');
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_IMAGE_RETRY');
  assert(chatNotification?.event_count === 4, 'CHAT_IMAGE_RETRY_NO_INCREMENT');

  const appointmentPayload = {
    dietitian_id: dietitianA.id,
    client_id: clientA.id,
    title: 'Disposable appointment',
    date: '2099-12-10',
    time: '09:30:00',
    duration: 45,
    type: 'online',
    status: 'upcoming',
  };
  const appointment = assertNoError(await api.dietitianA.from('appointments').insert(appointmentPayload)
    .select('*').single(), 'appointment create');
  appointmentIds.push(appointment.id);
  const appointmentKey = 'appointment:' + appointment.id;
  let appointmentNotification = await readNotification(clientA.id, appointmentKey, 'APPOINTMENT_CREATE');
  assert(appointmentNotification?.event_type === 'created' && appointmentNotification.event_count === 1
    && appointmentNotification.appointment_id === appointment.id
    && appointmentNotification.appointment_date === appointment.date
    && appointmentNotification.appointment_time.startsWith('09:30'),
  'APPOINTMENT_CREATED_NOTIFICATION');

  const batchResult = await api.clientA.rpc('mark_notifications_seen', {
    p_notification_ids: [chatNotification.id, appointmentNotification.id],
  });
  assertNoError(batchResult, 'notification own batch seen');
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_BATCH_SEEN');
  appointmentNotification = await readNotification(clientA.id, appointmentKey, 'APPOINTMENT_BATCH_SEEN');
  assert(chatNotification?.seen_at !== null && appointmentNotification?.seen_at !== null
    && chatNotification.read_at === null && appointmentNotification.read_at === null,
  'NOTIFICATION_BATCH_OWN_PASS');

  const tooLargeBatch = await api.clientA.rpc('mark_notifications_seen', {
    p_notification_ids: Array.from({ length: 101 }, () => randomUUID()),
  });
  assertRpcError(tooLargeBatch, 'NOTIFICATION_BATCH_OVER_100_DENY');

  const updatedAppointment = assertNoError(await api.dietitianA.from('appointments').update({
    title: 'Disposable appointment updated',
  }).eq('id', appointment.id).select('*').single(), 'appointment meaningful update');
  assert(updatedAppointment.title === 'Disposable appointment updated', 'APPOINTMENT_MEANINGFUL_UPDATE_PERSISTED');
  appointmentNotification = await readNotification(clientA.id, appointmentKey, 'APPOINTMENT_UPDATED');
  assert(appointmentNotification?.id && appointmentNotification.event_type === 'updated'
    && appointmentNotification.event_count === 2
    && appointmentNotification.seen_at === null && appointmentNotification.read_at === null,
  'APPOINTMENT_UPDATED_SAME_REARMED_ROW');

  assertNoError(await api.clientA.rpc('mark_notification_read', { p_notification_id: appointmentNotification.id }), 'appointment mark read');
  const noOpUpdate = await api.dietitianA.from('appointments').update({
    title: 'Disposable appointment updated',
  }).eq('id', appointment.id).select('id').single();
  assertNoError(noOpUpdate, 'appointment no-op mutation');
  const noOpNotification = await readNotification(clientA.id, appointmentKey, 'APPOINTMENT_NOOP');
  assert(noOpNotification?.id === appointmentNotification.id
    && noOpNotification.event_count === 2
    && noOpNotification.read_at !== null,
  'APPOINTMENT_NOOP_NO_NEW_NOTIFICATION');

  const cancelledAppointment = assertNoError(await api.dietitianA.from('appointments').update({
    status: 'cancelled',
  }).eq('id', appointment.id).select('*').single(), 'appointment cancellation');
  assert(cancelledAppointment.status === 'cancelled', 'APPOINTMENT_CANCELLED_PERSISTED');
  appointmentNotification = await readNotification(clientA.id, appointmentKey, 'APPOINTMENT_CANCELLED');
  assert(appointmentNotification?.id === noOpNotification.id
    && appointmentNotification.event_type === 'cancelled'
    && appointmentNotification.event_count === 1
    && appointmentNotification.seen_at === null && appointmentNotification.read_at === null,
  'APPOINTMENT_CANCELLED_SAME_REARMED_ROW');

  const completedAppointment = assertNoError(await api.dietitianA.from('appointments').insert({
    ...appointmentPayload,
    title: 'Disposable completed appointment',
    client_id: clientA.id,
    date: '2099-12-11',
    time: '10:30:00',
  }).select('*').single(), 'completed appointment create');
  appointmentIds.push(completedAppointment.id);
  const completedKey = 'appointment:' + completedAppointment.id;
  const completedCreated = await readNotification(clientA.id, completedKey, 'APPOINTMENT_COMPLETED_BASELINE');
  assert(completedCreated?.event_type === 'created', 'APPOINTMENT_COMPLETED_BASELINE_CREATED');
  assertNoError(await api.dietitianA.from('appointments').update({ status: 'completed' })
    .eq('id', completedAppointment.id).select('id,status').single(), 'completed appointment update');
  const completedAfter = await readNotification(clientA.id, completedKey, 'APPOINTMENT_COMPLETED_AFTER');
  assert(completedAfter?.id === completedCreated.id
    && completedAfter.event_type === 'created'
    && completedAfter.event_count === completedCreated.event_count,
  'APPOINTMENT_COMPLETED_NO_PHASE1_EVENT');

  const reassignmentAppointment = assertNoError(await api.dietitianA.from('appointments').insert({
    ...appointmentPayload,
    title: 'Disposable reassignment appointment',
    date: '2099-12-12',
    time: '11:30:00',
  }).select('*').single(), 'reassignment appointment create');
  appointmentIds.push(reassignmentAppointment.id);
  const reassignmentKey = 'appointment:' + reassignmentAppointment.id;
  assert((await readNotification(clientA.id, reassignmentKey, 'REASSIGNMENT_BASELINE'))?.event_type === 'created',
    'REASSIGNMENT_BASELINE_CREATED');
  const reassignedAppointment = assertNoError(await api.dietitianA.from('appointments').update({
    client_id: clientB.id,
  }).eq('id', reassignmentAppointment.id).select('*').single(), 'appointment reassignment');
  assert(reassignedAppointment.client_id === clientB.id, 'APPOINTMENT_REASSIGNMENT_PERSISTED');
  const removedForA = await readNotification(clientA.id, reassignmentKey, 'APPOINTMENT_REMOVED_FROM_OLD_CLIENT');
  const assignedForB = await readNotification(clientB.id, reassignmentKey, 'APPOINTMENT_ASSIGNED_NEW_CLIENT');
  assert(removedForA?.event_type === 'removed_from_client' && removedForA.recipient_id === clientA.id,
    'APPOINTMENT_OLD_CLIENT_REMOVED_EVENT');
  assert(assignedForB?.event_type === 'assigned' && assignedForB.recipient_id === clientB.id,
    'APPOINTMENT_NEW_CLIENT_ASSIGNED_EVENT');
  assertDenied(await api.clientA.from('appointments').select('id').eq('id', reassignmentAppointment.id),
    'APPOINTMENT_OLD_CLIENT_SOURCE_READ_DENY');
  const newClientSourceRead = assertNoError(await api.clientB.from('appointments').select('id').eq('id', reassignmentAppointment.id),
    'APPOINTMENT_NEW_CLIENT_SOURCE_READ');
  assert(newClientSourceRead.length === 1, 'APPOINTMENT_NEW_CLIENT_SOURCE_READ_PASS');

  const humanBeforeMeal = await readNotification(clientA.id, chatKey, 'MEAL_HUMAN_NOTIFICATION_BEFORE');
  const notificationsBeforeMeal = await notificationSnapshot('MEAL_NOTIFICATION_SNAPSHOT_BEFORE');
  const chatCountBeforeMeal = assertNoError(await admin.from('chat_messages').select('id').eq('conversation_id', conversationId),
    'meal chat count before').length;

  const mealPlan = assertNoError(await api.dietitianA.rpc('save_weekly_meal_plan', {
    p_client_id: clientA.id,
    p_week_start: '2026-08-10',
    p_days: mealDays({
      type: 'breakfast',
      title: 'Disposable tracked breakfast',
      description: 'Notification Core meal fixture',
      calories: 420,
      macros: { protein: 30, carbs: 45, fat: 14 },
      time: '08:30',
      sort_order: 0,
      source: 'manual',
      recipe_id: null,
      photo_url: null,
    }),
  }), 'meal plan create');
  assert(Array.isArray(mealPlan.plans) && mealPlan.plans.length === 7, 'MEAL_PLAN_RUNTIME_CREATED');
  planIds.push(...mealPlan.plans.map((plan) => plan.id));
  const trackedPlan = mealPlan.plans.find((plan) => plan.plan_date === '2026-08-14');
  const trackedMeal = trackedPlan?.meals?.[0];
  assert(Boolean(trackedPlan?.id && trackedMeal?.id), 'MEAL_TRACKING_TARGET_CREATED');
  mealIds.push(trackedMeal.id);

  assertNoError(await api.clientA.rpc('set_my_meal_completion', {
    p_meal_id: trackedMeal.id,
    p_is_eaten: true,
  }), 'meal completion');
  const completedMeal = assertNoError(await admin.from('meals')
    .select('id,is_eaten,completed_at,photo_url').eq('id', trackedMeal.id).single(), 'meal completion canonical read');
  assert(completedMeal.is_eaten === true && Boolean(completedMeal.completed_at), 'MEAL_COMPLETION_PROJECTION_SOURCE_VALID');

  const photoPath = 'meal-plans/' + clientA.id + '/' + dietitianA.id + '/' + randomUUID() + '.jpg';
  const photoBytes = Buffer.from('JFIF-disposable-meal-photo');
  await uploadStorage(api.dietitianA, 'meal-photos', photoPath, photoBytes, 'image/jpeg', 'meal photo upload');
  const updateDays = mealPlan.plans.map((plan) => ({
    plan_date: plan.plan_date,
    notes: plan.notes,
    meals: (plan.meals ?? []).map((meal) => meal.id === trackedMeal.id
      ? mealPayloadFromRow(meal, photoPath)
      : mealPayloadFromRow(meal)),
  }));
  const photoPlan = assertNoError(await api.dietitianA.rpc('save_weekly_meal_plan', {
    p_client_id: clientA.id,
    p_week_start: '2026-08-10',
    p_days: updateDays,
  }), 'meal photo attach');
  assert(photoPlan.plans.some((plan) => (plan.meals ?? []).some((meal) => meal.id === trackedMeal.id
    && meal.photo_url === photoPath)), 'MEAL_PHOTO_PERSISTED');
  const photoMeal = assertNoError(await admin.from('meals')
    .select('id,is_eaten,completed_at,photo_url').eq('id', trackedMeal.id).single(), 'meal photo canonical read');
  assert(photoMeal.is_eaten === true && Boolean(photoMeal.completed_at) && photoMeal.photo_url === photoPath,
    'MEAL_PHOTO_PROJECTION_SOURCE_VALID');

  const notificationsAfterMeal = await notificationSnapshot('MEAL_NOTIFICATION_SNAPSHOT_AFTER');
  const chatCountAfterMeal = assertNoError(await admin.from('chat_messages').select('id').eq('conversation_id', conversationId),
    'meal chat count after').length;
  const humanAfterMeal = await readNotification(clientA.id, chatKey, 'MEAL_HUMAN_NOTIFICATION_AFTER');
  assert(notificationsAfterMeal === notificationsBeforeMeal, 'MEAL_ACTIVITY_NOTIFICATION_COUNT_0');
  assert(chatCountAfterMeal === chatCountBeforeMeal, 'MEAL_ACTIVITY_SYNTHETIC_CHAT_COUNT_0');
  assert(humanBeforeMeal?.id === humanAfterMeal?.id
    && humanBeforeMeal.event_count === humanAfterMeal.event_count
    && humanBeforeMeal.seen_at === humanAfterMeal.seen_at
    && humanBeforeMeal.read_at === humanAfterMeal.read_at,
  'MEAL_ACTIVITY_HUMAN_UNREAD_UNCHANGED');

  const relationKey = pendingKey;
  let relationNotification = await readNotification(clientB.id, relationKey, 'RELATIONSHIP_LIFECYCLE_BASELINE');
  await deleteNotification(clientB.id, relationKey, 'RELATIONSHIP_ACTIVE_REMOVE_PREPARE');
  await updateRelationship(pendingAB.id, 'removed', 'RELATIONSHIP_ACTIVE_REMOVE');
  relationNotification = await readNotification(clientB.id, relationKey, 'RELATIONSHIP_ACTIVE_REMOVE');
  assert(relationNotification?.event_type === 'removed'
    && relationNotification.actor_id === dietitianA.id
    && relationNotification.recipient_id === clientB.id
    && relationNotification.relationship_from_status === 'active'
    && relationNotification.relationship_to_status === 'removed',
  'RELATIONSHIP_ACTIVE_REMOVED_EVENT');

  await deleteNotification(clientB.id, relationKey, 'RELATIONSHIP_REMOVED_PENDING_PREPARE');
  await updateRelationship(pendingAB.id, 'pending', 'RELATIONSHIP_REMOVED_PENDING');
  relationNotification = await readNotification(clientB.id, relationKey, 'RELATIONSHIP_REMOVED_PENDING');
  assert(relationNotification?.event_type === 'request_pending'
    && relationNotification.relationship_from_status === 'removed'
    && relationNotification.relationship_to_status === 'pending',
  'RELATIONSHIP_REMOVED_PENDING_EVENT');

  await deleteNotification(clientB.id, relationKey, 'RELATIONSHIP_PENDING_REMOVED_PREPARE');
  await updateRelationship(pendingAB.id, 'removed', 'RELATIONSHIP_PENDING_REMOVED');
  relationNotification = await readNotification(clientB.id, relationKey, 'RELATIONSHIP_PENDING_REMOVED');
  assert(relationNotification === null, 'RELATIONSHIP_PENDING_REMOVED_NO_EVENT');

  await updateRelationship(pendingAB.id, 'pending', 'RELATIONSHIP_FRESH_PENDING');
  await deleteNotification(clientB.id, relationKey, 'RELATIONSHIP_FRESH_REJECT_PREPARE');
  await updateRelationship(pendingAB.id, 'rejected', 'RELATIONSHIP_FRESH_REJECT');
  relationNotification = await readNotification(dietitianA.id, relationKey, 'RELATIONSHIP_FRESH_REJECT');
  assert(relationNotification?.event_type === 'rejected'
    && relationNotification.actor_id === clientB.id
    && relationNotification.recipient_id === dietitianA.id
    && relationNotification.relationship_from_status === 'pending'
    && relationNotification.relationship_to_status === 'rejected',
  'RELATIONSHIP_FRESH_REJECT_EVENT');

  await updateRelationship(pendingAB.id, 'pending', 'RELATIONSHIP_REJECTED_PENDING');
  relationNotification = await readNotification(clientB.id, relationKey, 'RELATIONSHIP_REJECTED_PENDING');
  assert(relationNotification?.event_type === 'request_pending'
    && relationNotification.relationship_from_status === 'rejected'
    && relationNotification.relationship_to_status === 'pending',
  'RELATIONSHIP_REJECTED_PENDING_EVENT');

  await updateRelationship(pendingAB.id, 'active', 'RELATIONSHIP_PENDING_ACTIVE');
  relationNotification = await readNotification(dietitianA.id, relationKey, 'RELATIONSHIP_PENDING_ACTIVE');
  assert(relationNotification?.event_type === 'accepted'
    && relationNotification.actor_id === clientB.id
    && relationNotification.relationship_from_status === 'pending'
    && relationNotification.relationship_to_status === 'active',
  'RELATIONSHIP_PENDING_ACTIVE_EVENT');

  const relationNoOpBefore = relationNotification;
  assertNoError(await admin.from('dietitian_clients').update({ updated_at: new Date().toISOString() })
    .eq('id', pendingAB.id).select('id').single(), 'relationship status-preserving update');
  const relationNoOpAfter = await readNotification(dietitianA.id, relationKey, 'RELATIONSHIP_STATUS_NOOP');
  assert(relationNoOpAfter?.id === relationNoOpBefore.id
    && relationNoOpAfter.event_count === relationNoOpBefore.event_count
    && relationNoOpAfter.event_type === relationNoOpBefore.event_type,
  'RELATIONSHIP_STATUS_PRESERVING_NO_EVENT');

  const mixedBatch = await api.clientA.rpc('mark_notifications_seen', {
    p_notification_ids: [chatNotification.id, dietitianNotificationId],
  });
  assertRpcError(mixedBatch, 'NOTIFICATION_BATCH_MIXED_FOREIGN_FAIL_CLOSED');
  const chatAfterMixedBatch = await readNotification(clientA.id, chatKey, 'CHAT_MIXED_BATCH_STATE');
  assert(chatAfterMixedBatch?.seen_at === humanBeforeMeal?.seen_at
    && chatAfterMixedBatch?.read_at === humanBeforeMeal?.read_at,
  'NOTIFICATION_BATCH_MIXED_NO_PARTIAL_UPDATE');

  const directForeignRead = await api.clientB.rpc('mark_notification_read', {
    p_notification_id: dietitianNotificationId,
  });
  assertRpcError(directForeignRead, 'DIETITIAN_FOREIGN_READ_DENY');

  assertNoError(await api.clientA.rpc('mark_all_notifications_read'), 'mark-all baseline reconciliation');
  const markAllTimestamp = new Date().toISOString();
  const markAllFixture = (recipientId, id, aggregationKey, seenAt, readAt) => ({
    id,
    recipient_id: recipientId,
    category: 'chat_message',
    event_type: 'new_message',
    aggregation_key: aggregationKey,
    actor_id: dietitianA.id,
    actor_display_name: 'Disposable dietitian-a',
    conversation_id: conversationId,
    summary_key: 'chat_new_message',
    event_count: 1,
    occurred_at: markAllTimestamp,
    seen_at: seenAt,
    read_at: readAt,
    created_at: markAllTimestamp,
    updated_at: markAllTimestamp,
  });
  const markAllOwnUnseenId = randomUUID();
  const markAllOwnSeenId = randomUUID();
  const markAllOwnReadId = randomUUID();
  const markAllForeignId = randomUUID();
  const markAllOwnReadAt = markAllTimestamp;
  assertNoError(await admin.from('notifications').insert([
    markAllFixture(clientA.id, markAllOwnUnseenId, 'mark-all:own-unseen:' + markAllOwnUnseenId, null, null),
    markAllFixture(clientA.id, markAllOwnSeenId, 'mark-all:own-seen:' + markAllOwnSeenId, markAllTimestamp, null),
    markAllFixture(clientA.id, markAllOwnReadId, 'mark-all:own-read:' + markAllOwnReadId, markAllTimestamp, markAllOwnReadAt),
    markAllFixture(clientB.id, markAllForeignId, 'mark-all:foreign:' + markAllForeignId, null, null),
  ]), 'mark-all fixture insert');
  const foreignBefore = assertNoError(await admin.from('notifications')
    .select('id,seen_at,read_at,updated_at').eq('id', markAllForeignId).single(), 'mark-all foreign before');
  const ownReadBefore = assertNoError(await admin.from('notifications')
    .select('id,seen_at,read_at,updated_at').eq('id', markAllOwnReadId).single(), 'mark-all own read before');

  const markAllCount = assertNoError(await api.clientA.rpc('mark_all_notifications_read'), 'mark-all own notifications');
  assert(markAllCount === 2, 'MARK_ALL_READ_OWN_AFFECTED_COUNT');
  const ownAfter = assertNoError(await admin.from('notifications')
    .select('id,seen_at,read_at,updated_at').in('id', [markAllOwnUnseenId, markAllOwnSeenId, markAllOwnReadId]), 'mark-all own after');
  const ownAfterById = new Map(ownAfter.map((row) => [row.id, row]));
  assert(ownAfterById.get(markAllOwnUnseenId)?.seen_at !== null
    && ownAfterById.get(markAllOwnUnseenId)?.read_at !== null, 'MARK_ALL_READ_UNSEEN_TO_READ');
  assert(ownAfterById.get(markAllOwnSeenId)?.seen_at !== null
    && ownAfterById.get(markAllOwnSeenId)?.read_at !== null, 'MARK_ALL_READ_SEEN_TO_READ');
  assert(ownAfterById.get(markAllOwnReadId)?.read_at === ownReadBefore.read_at
    && ownAfterById.get(markAllOwnReadId)?.updated_at === ownReadBefore.updated_at, 'MARK_ALL_READ_ALREADY_READ_UNCHANGED');
  const foreignAfter = assertNoError(await admin.from('notifications')
    .select('id,seen_at,read_at,updated_at').eq('id', markAllForeignId).single(), 'mark-all foreign after');
  assert(foreignAfter.seen_at === foreignBefore.seen_at
    && foreignAfter.read_at === foreignBefore.read_at
    && foreignAfter.updated_at === foreignBefore.updated_at, 'MARK_ALL_READ_CROSS_RECIPIENT_UNCHANGED');
  assert(assertNoError(await api.clientA.rpc('mark_all_notifications_read'), 'mark-all empty') === 0, 'MARK_ALL_READ_EMPTY_ZERO');
  assertRpcError(await api.anonymous.rpc('mark_all_notifications_read'), 'MARK_ALL_READ_ANONYMOUS_DENY');

  const rearmMessage = assertNoError(await api.dietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationAA.id,
    p_client_message_id: randomUUID(),
    p_body: 'Disposable mark-all re-arm event',
  }), 'mark-all re-arm message');
  messageIds.push(rearmMessage.id);
  const rearmedNotification = await readNotification(clientA.id, chatKey, 'MARK_ALL_READ_REARM');
  assert(rearmedNotification?.event_count === 1
    && rearmedNotification.seen_at === null
    && rearmedNotification.read_at === null, 'MARK_ALL_READ_NEW_EVENT_REARMS');

  pass('NOTIFICATION_CORE_RUNTIME_MATRIX_PASS');
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
      if (mainError) mainError.message += '; fixture cleanup failed: ' + error.message;
      else mainError = error;
    }
  }
  if (disposable?.tempRoot && stackStartAttempted) {
    try {
      runCli(disposable.tempRoot, ['stop', '--project-id', projectId, '--no-backup']);
      stackStarted = false;
      pass('DISPOSABLE_LOCAL_STACK_STOPPED', projectId);
    } catch (error) {
      if (mainError) mainError.message += '; local stack stop failed: ' + redact(error.message);
      else mainError = error;
    }
  }
  if (disposable?.tempRoot) {
    const tempParent = dirname(disposable.tempRoot);
    rmSync(tempParent, { recursive: true, force: true });
    assert(!existsSync(tempParent), 'DISPOSABLE_TEMP_RESIDUE_ZERO');
  }
  try {
    const containerResidual = execFileSync('docker', [
      'ps', '-a', '--filter', 'name=^supabase_.*_' + projectId + '$', '--format', '{{.ID}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    const volumeResidual = execFileSync('docker', [
      'volume', 'ls', '--filter', 'name=' + projectId, '--format', '{{.Name}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    const networkResidual = execFileSync('docker', [
      'network', 'ls', '--filter', 'name=' + projectId, '--format', '{{.Name}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    assert(containerResidual === '' && volumeResidual === '' && networkResidual === '',
      'DISPOSABLE_DOCKER_RESIDUE_ZERO');
  } catch (error) {
    if (mainError) mainError.message += '; Docker residue verification failed: ' + redact(error.message);
    else mainError = error;
  }
}

if (mainError) throw mainError;
