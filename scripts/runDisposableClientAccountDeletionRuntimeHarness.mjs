#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { createClient } from '@supabase/supabase-js';

import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supabaseVersion = '2.110.0';
const password = 'Disposable-ClientDeletion-11m!';
const projectId = `dietbridge-client-delete-${process.pid}-${randomUUID().slice(0, 8)}`;
const migrationName = '20260901165402_client_account_deletion_backend.sql';
const hardeningMigrationName = '20260901193000_client_account_deletion_hardening.sql';
const scopeTighteningMigrationName = '20260901200413_client_account_deletion_scope_tightening.sql';
const notificationMigrationName = '20260814214101_notification_core_backend.sql';
const fixturePrefix = `client-delete-${randomUUID()}`;
const imageBytes = Buffer.from('JFIF-disposable-client-account-deletion-image');

const npxCandidates = [
  process.env.npm_execpath ? join(dirname(process.env.npm_execpath), 'npx-cli.js') : null,
  process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js') : null,
  join('C:\\Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
const npxCli = npxCandidates.find((candidate) => existsSync(candidate));
if (!npxCli) throw new Error('Pinned local npx CLI entry point is unavailable.');

const actorIds = [];
const relationshipIds = [];
const appointmentIds = [];
const dailyTaskIds = [];
const noteIds = [];
const changeRequestIds = [];
const planIds = [];
const mealIds = [];
const recipeIds = [];
const conversationIds = [];
const messageIds = [];
const intentIds = [];
const attachmentIds = [];
const notificationIds = [];
const catalogConditionIds = [];
const catalogMedicationIds = [];
const storageDescriptors = [];

let disposable;
let local;
let admin;
let stackStartAttempted = false;
let mainError;

assertCiSafeEnvironment();

const pass = (label, detail = '') => {
  process.stdout.write(`PASS: ${label}${detail ? ` ${detail}` : ''}\n`);
};

const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  pass(label, detail);
};

const redact = (value) => String(value)
  .replace(/\b(sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)\b/g, '[redacted]')
  .replace(/\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*[=:]\s*\S+/g, '[redacted]');

const assertNoError = (result, label) => {
  if (!result || result.error) {
    throw new Error(`${label}: ${redact(result?.error?.message ?? 'missing result')}`);
  }
  return result.data;
};

const addClientAccountDeletionMigrations = ({ repoRoot: sourceRoot, tempRoot }) => {
  const sourceDirectory = join(sourceRoot, 'supabase', 'migrations');
  const destinationDirectory = join(tempRoot, 'supabase', 'migrations');
  for (const migration of [notificationMigrationName, migrationName, hardeningMigrationName, scopeTighteningMigrationName]) {
    const destination = join(destinationDirectory, migration);
    if (existsSync(destination)) throw new Error(`Disposable migration already exists: ${migration}`);
    copyFileSync(join(sourceDirectory, migration), destination, 1);
  }
  const count = readdirSync(destinationDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name)).length;
  if (count !== 58) throw new Error(`Client account disposable migration count must be 58, received ${count}.`);
  return count;
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
    throw new Error(`Supabase ${args.join(' ')} failed: ${redact(error.message)}\n${redact(String(error.stdout ?? '').slice(-8000))}\n${redact(String(error.stderr ?? '').slice(-8000))}`);
  }
};

const parseStatus = (value) => Object.fromEntries(
  value.split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

const isPortFree = (port) => new Promise((resolvePort) => {
  const server = createServer();
  server.once('error', () => resolvePort(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolvePort(true)));
});

const choosePortBase = async () => {
  const first = 59000 + (process.pid % 400);
  for (let offset = 0; offset < 4000; offset += 20) {
    const base = first + offset;
    const ports = [base, base + 1, base + 2, base + 3, base + 4, base + 7, base + 9, base + 83];
    if ((await Promise.all(ports.map(isPortFree))).every(Boolean)) return base;
  }
  throw new Error('No disposable loopback port range is available.');
};

const configureProject = async (configPath) => {
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

const runSql = (sql) => execFileSync(
  'docker',
  [
    'exec', `supabase_db_${projectId}`, 'psql',
    '-U', 'postgres', '-d', 'postgres', '-X',
    '-v', 'ON_ERROR_STOP=1', '-Atc', sql,
  ],
  { cwd: repoRoot, encoding: 'utf8', env: cleanEnvironment(process.env), timeout: 30_000 },
).trim();

const runDeletionSqlHarness = (dietitianId, clientAId, clientBId) => {
  const harness = readFileSync(
    join(repoRoot, 'supabase', 'tests', 'client_account_deletion_harness.sql'),
    'utf8',
  );
  const sql = [
    `\\set dietitian_a '${dietitianId}'`,
    `\\set client_a '${clientAId}'`,
    `\\set client_b '${clientBId}'`,
    harness,
  ].join('\n');
  return execFileSync(
    'docker',
    [
      'exec', '-i', `supabase_db_${projectId}`, 'psql',
      '-U', 'postgres', '-d', 'postgres', '-X',
      '-v', 'ON_ERROR_STOP=1', '-f', '-',
    ],
    {
      cwd: repoRoot,
      input: sql,
      encoding: 'utf8',
      env: cleanEnvironment(process.env),
      maxBuffer: 32 * 1024 * 1024,
      timeout: 5 * 60 * 1000,
    },
  );
};

const runDeletionTransactionRollbackProbe = (clientId) => {
  runSql(`
begin;
set local role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', true);
do $$
begin
  begin
    perform public.prepare_client_account_deletion(
      ${sqlLiteral(clientId)}::uuid,
      jsonb_build_array(jsonb_build_object(
        'bucket_id', 'avatars',
        'object_path', 'not-a-client-path.jpg'
      ))
    );
    raise exception 'FAIL: TRANSACTION_ROLLBACK_PROBE_NOT_REJECTED';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
end
$$;
reset role;
commit;
`);
};

const createAnonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActorClient = async (actor) => {
  const signedIn = assertNoError(
    await createAnonymousClient().auth.signInWithPassword({ email: actor.email, password }),
    `${actor.label} sign-in`,
  );
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${signedIn.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const createActor = async (label, role) => {
  const email = `${fixturePrefix}-${label}-${randomUUID()}@example.invalid`;
  const created = assertNoError(await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: `Disposable ${label}`,
      client_account_deletion_harness: 'local-only',
    },
  }), `${label} Auth fixture`);
  assert(Boolean(created.user?.id), `${label.toUpperCase()}_AUTH_CREATED`);
  actorIds.push(created.user.id);
  return { id: created.user.id, email, label, role };
};

const activateRelationship = async (dietitian, client) => {
  const inserted = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id,
    client_id: client.id,
    status: 'pending',
  }).select('id').single(), `${dietitian.label}/${client.label} relationship`);
  relationshipIds.push(inserted.id);
  const active = assertNoError(await admin.from('dietitian_clients').update({
    status: 'active',
    accepted_at: '2026-08-31T12:00:00.000Z',
    removed_at: null,
  }).eq('id', inserted.id).select('id,dietitian_id,client_id,status').single(), `${dietitian.label}/${client.label} relationship activation`);
  assert(active.status === 'active', `${dietitian.label.toUpperCase()}_${client.label.toUpperCase()}_RELATION_ACTIVE`);
  return active;
};

const uploadFixture = async (bucket, objectPath, label, client = admin) => {
  const result = await client.storage.from(bucket).upload(objectPath, imageBytes, {
    contentType: 'image/jpeg',
    upsert: false,
  });
  assertNoError(result, label);
  storageDescriptors.push({ bucket, path: objectPath });
  return objectPath;
};

const insertOne = async (table, row, label, select = '*') => {
  return assertNoError(await admin.from(table).insert(row).select(select).single(), label);
};

const storageObjectExists = async (bucket, objectPath) => {
  const slash = objectPath.lastIndexOf('/');
  const prefix = slash === -1 ? '' : objectPath.slice(0, slash + 1);
  const name = slash === -1 ? objectPath : objectPath.slice(slash + 1);
  const listed = assertNoError(await admin.storage.from(bucket).list(prefix, {
    limit: 100,
    offset: 0,
    sortBy: { column: 'name', order: 'asc' },
  }), `Storage list ${bucket}/${prefix}`);
  return listed.some((entry) => entry.name === name);
};

const removeStorageDescriptors = async (descriptors) => {
  const byBucket = new Map();
  for (const { bucket, path } of descriptors) {
    const paths = byBucket.get(bucket) ?? [];
    paths.push(path);
    byBucket.set(bucket, paths);
  }
  for (const [bucket, paths] of byBucket) {
    if (paths.length) assertNoError(await admin.storage.from(bucket).remove([...new Set(paths)]), `${bucket} exact fixture cleanup`);
  }
};

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

const setupFixtures = async () => {
  const dietitianA = await createActor('dietitian-a', 'dietitian');
  const clientA = await createActor('client-a', 'client');
  const clientB = await createActor('client-b', 'client');
  assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: 'approved',
    is_verified: true,
    verified_at: '2026-08-31T12:00:00.000Z',
  }).eq('user_id', dietitianA.id), 'Dietitian A independent profile fixture');
  assertNoError(await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: dietitianA.id,
    plan_id: 'core',
    status: 'active',
    client_limit_override: null,
  }), 'Dietitian A subscription capacity fixture');

  const relationA = await activateRelationship(dietitianA, clientA);
  const relationB = await activateRelationship(dietitianA, clientB);
  assertNoError(await admin.from('platform_admins').insert({
    user_id: clientB.id,
    granted_by: dietitianA.id,
  }), 'Client B active admin entitlement fixture');

  const clientAApi = await createActorClient(clientA);
  const clientBApi = await createActorClient(clientB);
  const dietitianAApi = await createActorClient(dietitianA);

  const condition = await insertOne('medical_conditions', {
    name: `Client deletion fixture condition ${fixturePrefix}`,
    category: 'fixture',
  }, 'Global medical condition fixture', 'id,name');
  catalogConditionIds.push(condition.id);
  const medication = await insertOne('medications_catalog', {
    name: `Client deletion fixture medication ${fixturePrefix}`,
    category: 'fixture',
  }, 'Global medication fixture', 'id,name');
  catalogMedicationIds.push(medication.id);

  assertNoError(await admin.from('client_profiles').update({
    goal: 'fixture-health-goal',
    current_weight: 82,
    target_weight: 74,
    height_cm: 178,
    chronic_conditions: ['fixture condition'],
    medications: ['fixture medication'],
    food_intolerances: ['fixture intolerance'],
    disliked_foods: ['fixture disliked food'],
    daily_water_goal_ml: 2200,
    sleep_hours_min: 7,
    sleep_hours_max: 8,
  }).eq('user_id', clientA.id), 'Client A health profile fixture');
  assertNoError(await admin.from('client_medical_conditions').insert({
    client_id: clientA.id,
    condition_id: condition.id,
    notes: 'Client A private medical note',
    diagnosed_at: '2026-08-01',
  }), 'Client A medical condition fixture');
  assertNoError(await admin.from('client_medications').insert({
    client_id: clientA.id,
    medication_id: medication.id,
    dosage: '10 mg',
    frequency: 'daily',
    notes: 'Client A private medication note',
    started_at: '2026-08-01',
  }), 'Client A medication fixture');
  assertNoError(await admin.from('measurements').insert({
    client_id: clientA.id,
    measured_at: '2099-12-10',
    weight: 82,
    waist: 90,
    notes: 'Client A private measurement',
  }), 'Client A measurement fixture');
  assertNoError(await admin.from('body_measurements').insert({
    client_id: clientA.id,
    date: '2099-12-10',
    waist_cm: 90,
    hip_cm: 104,
    arm_cm: 32,
  }), 'Client A body measurement fixture');
  assertNoError(await admin.from('daily_logs').insert([
    { client_id: clientA.id, date: '2099-12-10', current_weight: 82, water_intake: 2.2, mood: 'private' },
    { client_id: clientB.id, date: '2099-12-10', current_weight: 70, water_intake: 1.8, mood: 'preserved' },
  ]), 'Client A and B daily log fixtures');

  const task = await insertOne('daily_tasks', {
    dietitian_id: dietitianA.id,
    client_id: clientA.id,
    title: 'Client A private task',
    description: 'Delete with client account',
    due_date: '2099-12-10',
    priority: 'high',
    status: 'pending',
  }, 'Client A daily task fixture', 'id');
  dailyTaskIds.push(task.id);
  const note = await insertOne('dietitian_notes', {
    dietitian_id: dietitianA.id,
    client_id: clientA.id,
    title: 'Client A private note',
    content: 'Delete this client-associated note.',
  }, 'Client A dietitian note fixture', 'id');
  noteIds.push(note.id);
  const changeRequest = await insertOne('meal_change_requests', {
    client_id: clientA.id,
    dietitian_id: dietitianA.id,
    plan_date: '2099-12-10',
    meal_slot: 'breakfast',
    requested_meals: [{ title: 'Private replacement' }],
    notes: 'Client A private meal change request',
  }, 'Client A meal change request fixture', 'id');
  changeRequestIds.push(changeRequest.id);
  await insertOne('grocery_items', { client_id: clientA.id, name: 'Client A private grocery' }, 'Client A grocery fixture', 'id');
  await insertOne('grocery_items', { client_id: clientB.id, name: 'Client B preserved grocery' }, 'Client B grocery fixture', 'id');

  const appointmentA = await insertOne('appointments', {
    dietitian_id: dietitianA.id,
    client_id: clientA.id,
    title: 'Client A private appointment',
    date: '2099-12-10',
    time: '09:00:00',
    duration: 30,
    type: 'online',
    status: 'upcoming',
  }, 'Client A appointment fixture', 'id');
  appointmentIds.push(appointmentA.id);
  const appointmentB = await insertOne('appointments', {
    dietitian_id: dietitianA.id,
    client_id: clientB.id,
    title: 'Client B preserved appointment',
    date: '2099-12-11',
    time: '10:00:00',
    duration: 30,
    type: 'online',
    status: 'upcoming',
  }, 'Client B appointment fixture', 'id');
  appointmentIds.push(appointmentB.id);
  const appointmentNotification = await insertOne('notifications', {
    recipient_id: clientA.id,
    category: 'appointment',
    event_type: 'created',
    aggregation_key: `${fixturePrefix}:appointment-client`,
    actor_id: dietitianA.id,
    appointment_id: appointmentA.id,
    summary_key: 'appointment_created',
    appointment_title_snapshot: 'Client A private appointment',
    appointment_date: '2099-12-10',
    appointment_time: '09:00:00',
    appointment_status: 'upcoming',
  }, 'Client A notification fixture', 'id');
  notificationIds.push(appointmentNotification.id);
  const dietitianNotification = await insertOne('notifications', {
    recipient_id: dietitianA.id,
    category: 'appointment',
    event_type: 'created',
    aggregation_key: `${fixturePrefix}:appointment-dietitian`,
    actor_id: clientA.id,
    appointment_id: appointmentA.id,
    summary_key: 'appointment_created',
    appointment_title_snapshot: 'Client A private appointment',
    appointment_date: '2099-12-10',
    appointment_time: '09:00:00',
    appointment_status: 'upcoming',
  }, 'Dietitian notification with Client A actor fixture', 'id');
  notificationIds.push(dietitianNotification.id);

  const recipeId = randomUUID();
  const recipeObjectId = randomUUID();
  const recipePath = `recipes/${dietitianA.id}/${recipeId}/${recipeObjectId}.jpg`;
  recipeIds.push(recipeId);
  await insertOne('recipes', {
    id: recipeId,
    dietitian_id: dietitianA.id,
    name: 'Dietitian A independent recipe',
    description: 'Must survive Client A deletion.',
    meal_type: 'breakfast',
    calories: 420,
    protein: 30,
    carbs: 45,
    fat: 14,
    image_path: recipePath,
  }, 'Dietitian A recipe fixture', 'id');
  await uploadFixture('recipe-images', recipePath, 'Dietitian A recipe image fixture');

  const planAId = randomUUID();
  const planBId = randomUUID();
  planIds.push(planAId, planBId);
  await assertNoError(await admin.from('meal_plans').insert([
    { id: planAId, client_id: clientA.id, dietitian_id: dietitianA.id, plan_date: '2099-12-10', notes: 'Client A private meal plan' },
    { id: planBId, client_id: clientB.id, dietitian_id: dietitianA.id, plan_date: '2099-12-11', notes: 'Client B preserved meal plan' },
  ]), 'Client A and B meal plan fixtures');

  const mealAId = randomUUID();
  const mealBId = randomUUID();
  mealIds.push(mealAId, mealBId);
  const mealObjectId = randomUUID();
  const completionObjectId = randomUUID();
  const mealSnapshotPath = `meal-plans/${clientA.id}/${dietitianA.id}/${mealObjectId}.jpg`;
  const completionPath = `${clientA.id}/${mealAId}/${completionObjectId}.jpg`;
  await uploadFixture('meal-photos', mealSnapshotPath, 'Dietitian meal snapshot fixture');
  await uploadFixture('meal-completion-photos', completionPath, 'Client A completion photo fixture');
  await assertNoError(await admin.from('meals').insert([
    {
      id: mealAId,
      plan_id: planAId,
      type: 'breakfast',
      title: 'Client A private meal',
      calories: 420,
      macros: { protein: 30, carbs: 45, fat: 14 },
      is_eaten: true,
      completion_photo_url: completionPath,
      photo_url: mealSnapshotPath,
      time: '08:00:00',
      sort_order: 0,
      source: 'manual',
    },
    {
      id: mealBId,
      plan_id: planBId,
      type: 'lunch',
      title: 'Client B preserved meal',
      calories: 500,
      macros: { protein: 32, carbs: 50, fat: 16 },
      is_eaten: false,
      photo_url: null,
      time: '13:00:00',
      sort_order: 0,
      source: 'manual',
    },
  ]), 'Client A and B meal fixtures');
  runSql(`insert into public.meal_completion_photo_cleanup_queue (client_id, meal_id, bucket_id, object_path, reason) values (${sqlLiteral(clientA.id)}::uuid, ${sqlLiteral(mealAId)}::uuid, 'meal-completion-photos', ${sqlLiteral(completionPath)}, 'failed_save');`);
  pass('CLIENT_A_COMPLETION_CLEANUP_QUEUE_FIXTURE');

  const conversationId = randomUUID();
  const preservedConversationId = randomUUID();
  conversationIds.push(conversationId, preservedConversationId);
  await insertOne('chat_conversations', {
    id: conversationId,
    dietitian_client_id: relationA.id,
    dietitian_id: dietitianA.id,
    client_id: clientA.id,
  }, 'Client A chat conversation fixture', 'id');
  const clientMessageId = randomUUID();
  const intent = assertNoError(await clientAApi.rpc('create_chat_image_upload_intent', {
    p_conversation_id: conversationId,
    p_client_message_id: clientMessageId,
    p_expected_mime: 'image/jpeg',
  }), 'Client A chat upload intent');
  intentIds.push(intent.id);
  const chatPath = intent.object_path;
  await uploadFixture('chat-images', chatPath, 'Client A chat image fixture', clientAApi);
  assertNoError(await admin.rpc('record_chat_image_validation', {
    p_intent_id: intent.id,
    p_validated_mime: 'image/jpeg',
    p_validated_byte_size: imageBytes.length,
    p_validated_width: 10,
    p_validated_height: 10,
  }), 'Client A chat image validation');
  const message = assertNoError(await clientAApi.rpc('finalize_chat_image_message', {
    p_intent_id: intent.id,
    p_caption: 'Client A private chat image',
  }), 'Client A chat image finalization');
  messageIds.push(message.id);
  const attachmentId = runSql(`select id::text from public.chat_attachments where message_id = ${sqlLiteral(message.id)}::uuid;`);
  assert(Boolean(attachmentId), 'CLIENT_A_CHAT_ATTACHMENT_FIXTURE');
  attachmentIds.push(attachmentId);
  runSql(`insert into public.chat_image_cleanup_queue (intent_id, attachment_id, bucket_id, object_path, reason, available_at) values (${sqlLiteral(intent.id)}::uuid, ${sqlLiteral(attachmentId)}::uuid, 'chat-images', ${sqlLiteral(chatPath)}, 'message_tombstone', '2099-12-10T12:00:00.000Z');`);
  pass('CLIENT_A_CHAT_CLEANUP_QUEUE_FIXTURE');
  runSql(`insert into public.chat_read_states (conversation_id, user_id, last_read_message_id, last_delivered_message_id) values (${sqlLiteral(conversationId)}::uuid, ${sqlLiteral(clientA.id)}::uuid, ${sqlLiteral(message.id)}::uuid, ${sqlLiteral(message.id)}::uuid);`);
  pass('CLIENT_A_CHAT_READ_STATE_FIXTURE');

  await insertOne('chat_conversations', {
    id: preservedConversationId,
    dietitian_client_id: relationB.id,
    dietitian_id: dietitianA.id,
    client_id: clientB.id,
  }, 'Client B preserved chat conversation fixture', 'id');

  const dietitianMessageId = randomUUID();
  const dietitianIntent = assertNoError(await dietitianAApi.rpc('create_chat_image_upload_intent', {
    p_conversation_id: conversationId,
    p_client_message_id: dietitianMessageId,
    p_expected_mime: 'image/jpeg',
  }), 'Dietitian A chat upload intent in Client A conversation');
  intentIds.push(dietitianIntent.id);
  const dietitianChatPath = dietitianIntent.object_path;
  await uploadFixture('chat-images', dietitianChatPath, 'Dietitian A chat image in Client A conversation', dietitianAApi);
  assertNoError(await admin.rpc('record_chat_image_validation', {
    p_intent_id: dietitianIntent.id,
    p_validated_mime: 'image/jpeg',
    p_validated_byte_size: imageBytes.length,
    p_validated_width: 10,
    p_validated_height: 10,
  }), 'Dietitian A chat image validation');
  const dietitianMessage = assertNoError(await dietitianAApi.rpc('finalize_chat_image_message', {
    p_intent_id: dietitianIntent.id,
    p_caption: 'Dietitian A private chat image',
  }), 'Dietitian A chat image finalization');
  messageIds.push(dietitianMessage.id);
  const dietitianAttachmentId = runSql(`select id::text from public.chat_attachments where message_id = ${sqlLiteral(dietitianMessage.id)}::uuid;`);
  assert(Boolean(dietitianAttachmentId), 'DIETITIAN_CHAT_ATTACHMENT_FIXTURE');
  attachmentIds.push(dietitianAttachmentId);
  runSql(`insert into public.chat_image_cleanup_queue (intent_id, attachment_id, bucket_id, object_path, reason, available_at) values (${sqlLiteral(dietitianIntent.id)}::uuid, ${sqlLiteral(dietitianAttachmentId)}::uuid, 'chat-images', ${sqlLiteral(dietitianChatPath)}, 'message_tombstone', '2099-12-10T12:00:00.000Z');`);
  pass('DIETITIAN_CHAT_CLEANUP_QUEUE_FIXTURE');

  const preservedClientMessageId = randomUUID();
  const preservedIntent = assertNoError(await clientBApi.rpc('create_chat_image_upload_intent', {
    p_conversation_id: preservedConversationId,
    p_client_message_id: preservedClientMessageId,
    p_expected_mime: 'image/jpeg',
  }), 'Client B chat upload intent');
  intentIds.push(preservedIntent.id);
  const preservedChatPath = preservedIntent.object_path;
  await uploadFixture('chat-images', preservedChatPath, 'Client B preserved chat image', clientBApi);
  assertNoError(await admin.rpc('record_chat_image_validation', {
    p_intent_id: preservedIntent.id,
    p_validated_mime: 'image/jpeg',
    p_validated_byte_size: imageBytes.length,
    p_validated_width: 10,
    p_validated_height: 10,
  }), 'Client B chat image validation');
  const preservedMessage = assertNoError(await clientBApi.rpc('finalize_chat_image_message', {
    p_intent_id: preservedIntent.id,
    p_caption: 'Client B preserved chat image',
  }), 'Client B chat image finalization');
  messageIds.push(preservedMessage.id);
  const preservedAttachmentId = runSql(`select id::text from public.chat_attachments where message_id = ${sqlLiteral(preservedMessage.id)}::uuid;`);
  assert(Boolean(preservedAttachmentId), 'CLIENT_B_CHAT_ATTACHMENT_FIXTURE');
  attachmentIds.push(preservedAttachmentId);
  pass('CLIENT_B_CHAT_PRESERVED_FIXTURE');

  const clientAvatarPath = `${clientA.id}/avatar.jpg`;
  const clientBAvatarPath = `${clientB.id}/avatar.jpg`;
  const dietitianAvatarPath = `${dietitianA.id}/avatar.jpg`;
  await uploadFixture('avatars', clientAvatarPath, 'Client A avatar fixture');
  await uploadFixture('avatars', clientBAvatarPath, 'Client B avatar fixture');
  await uploadFixture('avatars', dietitianAvatarPath, 'Dietitian A avatar fixture');

  return {
    dietitianA,
    clientA,
    clientB,
    relationA,
    relationB,
    mealSnapshotPath,
    completionPath,
    chatPath,
    dietitianChatPath,
    preservedChatPath,
    clientAvatarPath,
    clientBAvatarPath,
    dietitianAvatarPath,
    recipePath,
    planBId,
    mealBId,
    appointmentBId: appointmentB.id,
  };
};

const deleteClientOwnedStorage = async (fixtures) => {
  const owned = storageDescriptors.filter(({ bucket, path }) => (
    (bucket === 'avatars' && path === fixtures.clientAvatarPath)
    || (bucket === 'meal-completion-photos' && path === fixtures.completionPath)
    || (bucket === 'chat-images' && path === fixtures.chatPath)
    || (bucket === 'chat-images' && path === fixtures.dietitianChatPath)
  ));
  assert(owned.length === 4, 'CLIENT_OWNED_STORAGE_FIXTURE_COUNT');
  await removeStorageDescriptors(owned);
  for (const { bucket, path } of owned) {
    assert(!(await storageObjectExists(bucket, path)), 'CLIENT_OWNED_STORAGE_EXACTLY_REMOVED', `${bucket}/${path}`);
  }
  for (const { bucket, path } of [
    { bucket: 'avatars', path: fixtures.clientBAvatarPath },
    { bucket: 'avatars', path: fixtures.dietitianAvatarPath },
    { bucket: 'meal-photos', path: fixtures.mealSnapshotPath },
    { bucket: 'recipe-images', path: fixtures.recipePath },
    { bucket: 'chat-images', path: fixtures.preservedChatPath },
  ]) {
    assert(await storageObjectExists(bucket, path), 'UNRELATED_STORAGE_PRESERVED', `${bucket}/${path}`);
  }
};

const deleteRemainingFixtureRows = async (fixtures = {}) => {
  if (!admin) return;
  const deleteRows = async (table, column, values, label) => {
    const present = values.filter(Boolean);
    if (!present.length) return;
    const result = await admin.from(table).delete().in(column, present);
    if (result.error) throw new Error(`${label}: ${redact(result.error.message)}`);
  };

  if (fixtures.chatPath) runSql(`delete from public.chat_image_cleanup_queue where object_path = ${sqlLiteral(fixtures.chatPath)};`);
  if (attachmentIds.length || intentIds.length) {
    const predicates = [];
    if (attachmentIds.length) predicates.push(`attachment_id in (${attachmentIds.map(sqlLiteral).join(',')})`);
    if (intentIds.length) predicates.push(`intent_id in (${intentIds.map(sqlLiteral).join(',')})`);
    runSql(`delete from public.chat_image_cleanup_queue where ${predicates.join(' or ')};`);
  }
  if (attachmentIds.length) await deleteRows('chat_attachments', 'id', attachmentIds, 'chat attachment cleanup');
  if (intentIds.length) await deleteRows('chat_upload_intents', 'id', intentIds, 'chat intent cleanup');
  if (conversationIds.length) {
    runSql(`delete from public.chat_read_states where conversation_id in (${conversationIds.map(sqlLiteral).join(',')});`);
    const pointer = await admin.from('chat_conversations').update({ last_message_id: null, last_message_at: null }).in('id', conversationIds);
    if (pointer.error) throw new Error(`chat pointer cleanup: ${redact(pointer.error.message)}`);
  }
  if (messageIds.length) await deleteRows('chat_messages', 'id', messageIds, 'chat message cleanup');
  if (conversationIds.length) await deleteRows('chat_conversations', 'id', conversationIds, 'chat conversation cleanup');
  if (actorIds.length) {
    runSql(`delete from public.meal_completion_photo_cleanup_queue where client_id in (${actorIds.map(sqlLiteral).join(',')});`);
    runSql(`delete from public.meal_photo_cleanup_queue where client_id in (${actorIds.map(sqlLiteral).join(',')});`);
  }
  if (mealIds.length) await deleteRows('meals', 'id', mealIds, 'meal cleanup');
  if (planIds.length) await deleteRows('meal_plans', 'id', planIds, 'meal plan cleanup');
  if (appointmentIds.length) await deleteRows('appointments', 'id', appointmentIds, 'appointment cleanup');
  if (changeRequestIds.length) await deleteRows('meal_change_requests', 'id', changeRequestIds, 'meal change request cleanup');
  if (dailyTaskIds.length) await deleteRows('daily_tasks', 'id', dailyTaskIds, 'daily task cleanup');
  if (noteIds.length) await deleteRows('dietitian_notes', 'id', noteIds, 'note cleanup');
  await deleteRows('daily_logs', 'client_id', actorIds, 'daily log cleanup');
  await deleteRows('dietitian_clients', 'id', relationshipIds, 'relationship cleanup');
  if (notificationIds.length) await deleteRows('notifications', 'id', notificationIds, 'notification cleanup');
  await deleteRows('recipes', 'id', recipeIds, 'recipe cleanup');
  await deleteRows('medical_conditions', 'id', catalogConditionIds, 'condition catalog cleanup');
  await deleteRows('medications_catalog', 'id', catalogMedicationIds, 'medication catalog cleanup');
};

const cleanup = async (fixtures) => {
  if (!admin) return;
  let cleanupError;
  try {
    await deleteRemainingFixtureRows(fixtures);
  } catch (error) {
    cleanupError = error;
  }
  try {
    await removeStorageDescriptors(storageDescriptors);
  } catch (error) {
    cleanupError ??= error;
  }
  for (const actorId of [...actorIds].reverse()) {
    const result = await admin.auth.admin.deleteUser(actorId, false);
    if (result.error && !/not found|user not found/i.test(result.error.message)) {
      cleanupError ??= new Error(`Auth cleanup: ${redact(result.error.message)}`);
    }
  }
  if (cleanupError) throw cleanupError;
};

const run = async () => {
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  const isolatedCount = addClientAccountDeletionMigrations({ repoRoot, tempRoot: disposable.tempRoot });
  const migrationDirectory = join(disposable.tempRoot, 'supabase', 'migrations');
  const migrationFiles = readdirSync(migrationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name));
  assert(migrationFiles.includes(migrationName), 'CLIENT_DELETE_MIGRATION_MATERIALIZED');
  assert(migrationFiles.includes(hardeningMigrationName), 'CLIENT_DELETE_HARDENING_MIGRATION_MATERIALIZED');
  assert(migrationFiles.includes(scopeTighteningMigrationName), 'CLIENT_DELETE_SCOPE_TIGHTENING_MIGRATION_MATERIALIZED');
  assert(migrationFiles.length === 58, 'CLIENT_DELETE_DISPOSABLE_MIGRATION_CHAIN_58');
  assert(isolatedCount === 58, 'CLIENT_DELETE_CURRENT_CHAIN_METADATA');
  assert(!migrationFiles.includes('20260817120000_push_registry_outbox_backend.sql'), 'CLIENT_DELETE_DEFERRED_PUSH_NOT_MATERIALIZED');

  await configureProject(disposable.configPath);
  const functionSource = join(repoRoot, 'supabase', 'functions', 'delete-client-account');
  const functionTarget = join(disposable.tempRoot, 'supabase', 'functions', 'delete-client-account');
  mkdirSync(functionTarget, { recursive: true });
  for (const file of readdirSync(functionSource)) {
    if (!/^(?:index|handler)(?:\.test)?\.ts$/.test(file) && file !== 'deno.json') continue;
    copyFileSync(join(functionSource, file), join(functionTarget, file));
  }
  stackStartAttempted = true;
  runCli(disposable.tempRoot, ['start']);
  pass('CLIENT_DELETE_DISPOSABLE_LOCAL_STACK_STARTED', projectId);
  runCli(disposable.tempRoot, ['db', 'reset', '--local', '--no-seed']);
  local = parseStatus(runCli(disposable.tempRoot, ['status', '--output', 'env']));
  assertCiSafeEnvironment({ SUPABASE_URL: local.API_URL }, { requireLoopback: true });
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? ''), 'CLIENT_DELETE_LOOPBACK_API_ONLY');
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'CLIENT_DELETE_LOCAL_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  assert(runSql('select count(*) from supabase_migrations.schema_migrations') === '58', 'CLIENT_DELETE_SCHEMA_MIGRATION_REPLAY_58');
  runCli(disposable.tempRoot, ['db', 'advisors', '--local', '--type', 'security', '--level', 'error', '--fail-on', 'error']);
  pass('CLIENT_DELETE_LOCAL_SECURITY_ADVISORS_NO_ERROR');
  runCli(disposable.tempRoot, ['db', 'lint', '--local', '--schema', 'private,public', '--fail-on', 'error']);
  pass('CLIENT_DELETE_LOCAL_DATABASE_LINT_NO_ERROR');

  const fixtures = await setupFixtures();
  assert(runSql(`select count(*) from public.profiles where id in (${sqlLiteral(fixtures.dietitianA.id)},${sqlLiteral(fixtures.clientA.id)},${sqlLiteral(fixtures.clientB.id)})`) === '3', 'CLIENT_DELETE_PROFILE_FIXTURES_PRESENT');
  runDeletionTransactionRollbackProbe(fixtures.clientA.id);
  for (const { bucket, path } of storageDescriptors.filter(({ bucket, path }) => (
    (bucket === 'avatars' && path === fixtures.clientAvatarPath)
    || (bucket === 'meal-completion-photos' && path === fixtures.completionPath)
    || (bucket === 'chat-images' && (path === fixtures.chatPath || path === fixtures.dietitianChatPath))
  ))) {
    assert(await storageObjectExists(bucket, path), 'CLIENT_DELETE_ROLLBACK_LEFT_STORAGE_PRESENT', `${bucket}/${path}`);
  }
  pass('CLIENT_DELETE_SQL_FAILURE_ROLLBACK_AND_STORAGE_NOT_TOUCHED');
  runDeletionSqlHarness(fixtures.dietitianA.id, fixtures.clientA.id, fixtures.clientB.id);
  pass('CLIENT_DELETE_RELATIONAL_SQL_HARNESS_PASS');

  await deleteClientOwnedStorage(fixtures);
  assertNoError(await admin.rpc('mark_client_account_storage_cleaned', { p_client_id: fixtures.clientA.id }), 'Client A Storage completion marker');
  assert(runSql(`select count(*) from public.client_account_deletion_tombstones where user_id = ${sqlLiteral(fixtures.clientA.id)} and relational_cleanup_at is not null and storage_cleanup_at is not null`) === '1', 'CLIENT_A_PROFILE_FREE_STORAGE_COMPLETE_RETRY_STATE');
  const clientAProfileBeforeAuthDelete = assertNoError(await admin.from('profiles').select('id').eq('id', fixtures.clientA.id), 'Client A profile lookup before Auth final step');
  assert(clientAProfileBeforeAuthDelete.length === 0, 'CLIENT_A_PROFILE_REMOVED_BEFORE_AUTH');
  pass('CLIENT_DELETE_STORAGE_FAILURE_AND_AUTH_RETRY_STATE');
  assertNoError(await admin.auth.admin.deleteUser(fixtures.clientA.id, false), 'Client A final Auth deletion');
  const clientAProfileAfterAuthDelete = assertNoError(await admin.from('profiles').select('id').eq('id', fixtures.clientA.id), 'Client A final profile lookup');
  assert(clientAProfileAfterAuthDelete.length === 0, 'CLIENT_A_PROFILE_REMOVED_BY_AUTH_CASCADE');
  const clientAAuth = await admin.auth.admin.getUserById(fixtures.clientA.id);
  assert(Boolean(clientAAuth.error), 'CLIENT_A_AUTH_ACCOUNT_REMOVED');
  assert(runSql(`select count(*) from public.client_account_deletion_tombstones where user_id = ${sqlLiteral(fixtures.clientA.id)}`) === '0', 'CLIENT_A_TOMBSTONE_CASCADE_REMOVED');
  assert(runSql(`select count(*) from public.client_account_deletion_storage_manifest where user_id = ${sqlLiteral(fixtures.clientA.id)}`) === '0', 'CLIENT_A_MANIFEST_CASCADE_REMOVED');
  assert(await storageObjectExists('avatars', fixtures.clientBAvatarPath), 'CLIENT_B_AVATAR_REMAINS');
  assert(await storageObjectExists('avatars', fixtures.dietitianAvatarPath), 'DIETITIAN_AVATAR_REMAINS');
  assert(await storageObjectExists('meal-photos', fixtures.mealSnapshotPath), 'DIETITIAN_MEAL_PHOTO_REMAINS');
  assert(await storageObjectExists('recipe-images', fixtures.recipePath), 'DIETITIAN_RECIPE_IMAGE_REMAINS');
  assert(runSql(`select count(*) from public.recipes where id = ${sqlLiteral(recipeIds[0])}`) === '1', 'DIETITIAN_RECIPE_ROW_REMAINS');
  assert(runSql(`select count(*) from public.grocery_items where client_id = ${sqlLiteral(fixtures.clientB.id)}`) === '1', 'CLIENT_B_GROCERY_REMAINS');
  assert(await storageObjectExists('chat-images', fixtures.preservedChatPath), 'CLIENT_B_CHAT_IMAGE_REMAINS');
  assert(runSql(`select count(*) from public.chat_upload_intents as i join public.chat_conversations as c on c.id = i.conversation_id where c.client_id = ${sqlLiteral(fixtures.clientB.id)}`) === '1', 'CLIENT_B_CHAT_ROW_REMAINS');
  assert(runSql(`select count(*) from public.platform_admins where user_id = ${sqlLiteral(fixtures.clientB.id)} and revoked_at is null`) === '1', 'CLIENT_B_ADMIN_ENTITLEMENT_REMAINS');
  pass('CLIENT_DELETE_AUTH_FINAL_STEP_AND_TENANT_ISOLATION_PASS');
};

let fixtures;
try {
  fixtures = await run();
} catch (error) {
  mainError = error;
} finally {
  try {
    await cleanup(fixtures ?? {});
  } catch (error) {
    mainError = mainError
      ? new Error(`${mainError.message}; fixture cleanup failed: ${redact(error.message)}`)
      : error;
  }
  if (stackStartAttempted && disposable?.tempRoot) {
    try {
      runCli(disposable.tempRoot, ['stop']);
    } catch (error) {
      mainError = mainError
        ? new Error(`${mainError.message}; local stack stop failed: ${redact(error.message)}`)
        : error;
    }
  }
  if (disposable?.tempRoot) {
    try {
      rmSync(dirname(disposable.tempRoot), { recursive: true, force: true });
    } catch (error) {
      mainError = mainError
        ? new Error(`${mainError.message}; disposable workdir cleanup failed: ${redact(error.message)}`)
        : error;
    }
  }
}

if (mainError) {
  process.stderr.write(`[client-account-deletion-runtime] ${redact(mainError.message)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('CLIENT_ACCOUNT_DELETION_RUNTIME_HARNESS_PASS\n');
}
