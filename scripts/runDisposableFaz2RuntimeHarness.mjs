#!/usr/bin/env node

// Disposable-only runtime harness for the Faz 2 backend migrations
// (20261006090000 .. 20261006090600). It replays the full repository migration
// chain into a throwaway local Supabase stack, runs the SQL contract matrix
// (supabase/tests/faz2_backend_contract.sql), then exercises every new contract
// through Auth + PostgREST exactly as the Web panel and the store mobile build
// call it. Nothing touches a remote database.

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';
import { addCurrentIsolatedMigrations, addFaz2Migrations, addAutomaticTaskDismissalMigration, AUTOMATIC_TASK_DISMISSAL_MIGRATION, FAZ2_MIGRATIONS } from './addCurrentIsolatedMigrations.mjs';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-Faz2-Runtime-9k!';
const projectId = `dietbridge-faz2-${process.pid}-${randomUUID().slice(0, 8)}`;
const sqlContractPath = join(repoRoot, 'supabase', 'tests', 'faz2_backend_contract.sql');

const npxCandidates = [
  process.env.npm_execpath ? join(dirname(process.env.npm_execpath), 'npx-cli.js') : null,
  process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js') : null,
  join('C:\\Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
const npxCli = npxCandidates.find((candidate) => existsSync(candidate));
if (!npxCli) throw new Error('Pinned local npx CLI entry point is unavailable.');

let disposable;
let local;
let admin;
let stackStartAttempted = false;
let mainError;

assertCiSafeEnvironment();

const pass = (label, detail = '') => process.stdout.write(`PASS: ${label}${detail ? ` ${detail}` : ''}\n`);
const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  pass(label, detail);
};
const assertNoError = (result, label) => {
  if (!result || result.error) throw new Error(`${label}: ${result?.error ? JSON.stringify(result.error) : 'missing result'}`);
  return result.data;
};
const cleanEnvironment = (environment) => Object.fromEntries(
  Object.entries(environment).filter(([key]) => !(
    /^(?:SUPABASE|VITE_SUPABASE|EXPO_PUBLIC_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)
  )),
);

const runCli = (tempRoot, args) => {
  try {
    return execFileSync(process.execPath, [
      npxCli,
      '--yes',
      `supabase@${SUPABASE_VERSION}`,
      '--workdir',
      tempRoot,
      ...args,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...cleanEnvironment(process.env), TZ: 'Europe/Istanbul' },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
  } catch (error) {
    throw new Error(`Supabase ${args.join(' ')} failed: ${error.message}\n${String(error.stdout ?? '').slice(-6000)}\n${String(error.stderr ?? '').slice(-6000)}`);
  }
};

const runSql = (statement) => execFileSync('docker', [
  'exec', `supabase_db_${projectId}`, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atc', statement,
], { encoding: 'utf8', env: cleanEnvironment(process.env), timeout: 30_000 }).trim();

const runSqlFile = (path) => {
  try {
    return execFileSync('docker', [
      'exec', '-i', `supabase_db_${projectId}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', '-v', 'ON_ERROR_STOP=1', '-f', '-',
    ], {
      input: readFileSync(path),
      encoding: 'utf8',
      env: cleanEnvironment(process.env),
      timeout: 5 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`SQL contract failed: ${error.message}\n${String(error.stdout ?? '').slice(-6000)}\n${String(error.stderr ?? '').slice(-6000)}`);
  }
};

const parseStatus = (value) => Object.fromEntries(value.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
  .filter(Boolean)
  .map((match) => [match[1], match[2]]));

const isPortFree = (port) => new Promise((resolvePromise) => {
  const server = createServer();
  server.once('error', () => resolvePromise(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)));
});

const choosePortBase = async () => {
  const first = 55000 + (process.pid % 400);
  for (let offset = 0; offset < 4000; offset += 20) {
    const base = first + offset;
    const ports = [base, base + 1, base + 2, base + 3, base + 4, base + 7, base + 9, base + 83];
    if ((await Promise.all(ports.map(isPortFree))).every(Boolean)) return base;
  }
  throw new Error('No disposable loopback port range is available.');
};

const configureDisposableProject = async (configPath) => {
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

const clientOptions = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const createAnonymousClient = () => createClient(local.API_URL, local.ANON_KEY, clientOptions);

const createActor = async (label, role) => {
  const email = `faz2-${label}-${randomUUID()}@example.invalid`;
  const result = assertNoError(await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { account_type: role, role, full_name: `Disposable ${label}` },
  }), `${label} Auth fixture`);
  assert(Boolean(result.user?.id), `${label.toUpperCase()}_AUTH_CREATED`);
  return { id: result.user.id, email, label };
};

const signIn = async (actor) => {
  const session = assertNoError(
    await createAnonymousClient().auth.signInWithPassword({ email: actor.email, password: PASSWORD }),
    `${actor.label} sign-in`,
  );
  return createClient(local.API_URL, local.ANON_KEY, {
    ...clientOptions,
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
  });
};

const approveDietitian = async (actor) => {
  const row = assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: 'approved',
    is_verified: true,
    verified_at: '2026-10-05T09:00:00.000Z',
  }).eq('user_id', actor.id).select('user_id,verification_status,is_verified').single(), `${actor.label} approval`);
  assert(row.verification_status === 'approved' && row.is_verified === true, `${actor.label.toUpperCase()}_APPROVED`);
};

const bootstrapDietitian = async (actor) => {
  const row = assertNoError(await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: actor.id,
    plan_id: 'core',
    status: 'active',
    client_limit_override: null,
  }).select('dietitian_id,plan_id,status').single(), `${actor.label} subscription`);
  assert(row.plan_id === 'core' && row.status === 'active', `${actor.label.toUpperCase()}_CORE_SUBSCRIPTION`);
};

const activateRelationship = async (dietitian, client) => {
  const row = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id,
    client_id: client.id,
    status: 'pending',
  }).select('id').single(), `${dietitian.label}/${client.label} relationship`);
  const updated = assertNoError(await admin.from('dietitian_clients').update({
    status: 'active',
    accepted_at: '2026-10-05T09:00:00.000Z',
  }).eq('id', row.id).select('id,status').single(), `${dietitian.label}/${client.label} activation`);
  assert(updated.status === 'active', `${dietitian.label.toUpperCase()}_${client.label.toUpperCase()}_ACTIVE_RELATION`);
};

const expectDenied = (result, label, codes = ['42501']) => {
  assert(Boolean(result.error) && codes.includes(result.error.code), label, result.error?.code ?? 'no error');
};

const signUpViaAuth = async (label, metadata) => {
  const email = `faz2-${label}-${randomUUID()}@example.invalid`;
  const result = assertNoError(await createAnonymousClient().auth.signUp({
    email,
    password: PASSWORD,
    options: { data: metadata },
  }), `${label} sign-up`);
  assert(Boolean(result.user?.id), `${label.toUpperCase()}_SIGNUP_CREATED`);
  return { id: result.user.id, email, label };
};

const runRestFlows = async () => {
  // Legal acceptance through the real Auth sign-up path.
  const webClient = await signUpViaAuth('legal-new', {
    account_type: 'client', full_name: 'Yeni Kayıt', terms_accepted: true, kvkk_accepted: true,
  });
  const storeClient = await signUpViaAuth('legal-store', { account_type: 'client', full_name: 'Mağaza Sürümü' });
  const legal = assertNoError(await admin.from('profiles').select('id,terms_accepted_at,kvkk_accepted_at')
    .in('id', [webClient.id, storeClient.id]), 'legal profile read');
  const byId = Object.fromEntries(legal.map((row) => [row.id, row]));
  assert(Boolean(byId[webClient.id]?.terms_accepted_at && byId[webClient.id]?.kvkk_accepted_at), 'REST_SIGNUP_WITH_FLAGS_STAMPS_SERVER_TIME');
  assert(byId[storeClient.id]?.terms_accepted_at === null && byId[storeClient.id]?.kvkk_accepted_at === null, 'REST_STORE_BUILD_SIGNUP_STILL_SUCCEEDS');
  const storeApi = await signIn(storeClient);
  expectDenied(await storeApi.from('profiles').update({ terms_accepted_at: '2020-01-01T00:00:00Z' }).eq('id', storeClient.id), 'REST_CLIENT_CANNOT_WRITE_ACCEPTANCE');
  const accepted = assertNoError(await storeApi.rpc('accept_legal_terms'), 'accept_legal_terms');
  assert(Array.isArray(accepted) && accepted[0]?.terms_accepted_at && accepted[0]?.kvkk_accepted_at, 'REST_ACCEPT_LEGAL_TERMS_RPC');

  const dietitianA = await createActor('dietitian-a', 'dietitian');
  const dietitianB = await createActor('dietitian-b', 'dietitian');
  const clientA = await createActor('client-a', 'client');
  await approveDietitian(dietitianA);
  await approveDietitian(dietitianB);
  await bootstrapDietitian(dietitianA);
  await bootstrapDietitian(dietitianB);
  await activateRelationship(dietitianA, clientA);
  const relation = assertNoError(await admin.from('dietitian_clients').select('id')
    .eq('dietitian_id', dietitianA.id).eq('client_id', clientA.id).single(), 'relation read');

  const today = runSql("select ((now() at time zone 'Europe/Istanbul')::date)::text");
  const clientApi = await signIn(clientA);
  const dietitianAApi = await signIn(dietitianA);
  const dietitianBApi = await signIn(dietitianB);

  const dismissal = { dietitian_id: dietitianA.id, client_id: clientA.id,
    task_key: `measurement_due:${clientA.id}`, task_revision: 'first' };
  for (const revision of ['first', 'second']) {
    const saved = assertNoError(await dietitianAApi.from('automatic_task_dismissals')
      .upsert({ ...dismissal, task_revision: revision }, { onConflict: 'dietitian_id,task_key' })
      .select('dietitian_id,task_key,task_revision').maybeSingle(), 'automatic dismissal upsert');
    assert(saved?.dietitian_id === dietitianA.id && saved.task_revision === revision, `REST_AUTOMATIC_DISMISSAL_${revision.toUpperCase()}`);
  }
  const foreignDismissals = assertNoError(await dietitianBApi.from('automatic_task_dismissals').select('task_key'), 'foreign preferences read');
  assert(foreignDismissals.length === 0, 'REST_AUTOMATIC_DISMISSAL_OWNER_ISOLATION');
  expectDenied(await clientApi.from('automatic_task_dismissals').upsert(dismissal,
    { onConflict: 'dietitian_id,task_key' }), 'REST_AUTOMATIC_DISMISSAL_CLIENT_WRITE_DENIED');

  // Meal change request: the exact insert of the store mobile build.
  const request = assertNoError(await clientApi.from('meal_change_requests').insert({
    client_id: clientA.id,
    dietitian_id: dietitianA.id,
    plan_date: today,
    meal_slot: 'lunch',
    requested_meals: { alternatives: ['lunch'] },
    notes: 'Öğle yemeğini değiştirebilir miyiz?',
    status: 'pending',
  }).select().single(), 'mobile-shaped change request insert');
  assert(request.status === 'pending' && request.reviewed_at === null, 'REST_MOBILE_CHANGE_REQUEST_INSERT_COMPATIBLE');
  expectDenied(await clientApi.from('meal_change_requests').insert({
    client_id: clientA.id, dietitian_id: dietitianB.id, plan_date: today, meal_slot: 'lunch', status: 'pending',
  }), 'REST_CHANGE_REQUEST_FOREIGN_DIETITIAN_DENIED');
  expectDenied(await clientApi.from('meal_change_requests').update({ status: 'approved' }).eq('id', request.id), 'REST_CLIENT_STATUS_UPDATE_DENIED');
  expectDenied(await dietitianBApi.rpc('review_meal_change_request', { p_request_id: request.id, p_decision: 'approved' }), 'REST_FOREIGN_DIETITIAN_REVIEW_DENIED');
  const pending = assertNoError(await dietitianAApi.from('meal_change_requests')
    .select('id,status,client_id,plan_date,meal_slot,requested_meals,notes,created_at').eq('status', 'pending'), 'dietitian pending list');
  assert(pending.some((row) => row.id === request.id), 'REST_DIETITIAN_SEES_PENDING_REQUEST');
  const reviewed = assertNoError(await dietitianAApi.rpc('review_meal_change_request', {
    p_request_id: request.id, p_decision: 'approved', p_response_note: 'Planı güncelledim.',
  }), 'review RPC');
  assert(reviewed.status === 'approved' && reviewed.reviewed_by === dietitianA.id, 'REST_ASSIGNED_DIETITIAN_APPROVES');

  // Notification visible through the Web select list.
  const notifications = assertNoError(await dietitianAApi.from('notifications')
    .select('id,category,event_type,summary_key,actor_id,actor_display_name,dietitian_client_id')
    .eq('category', 'client_activity'), 'dietitian notifications');
  assert(notifications.length === 1 && notifications[0].event_type === 'meal_change_requested'
    && notifications[0].actor_id === clientA.id && notifications[0].dietitian_client_id === relation.id, 'REST_CHANGE_REQUEST_NOTIFICATION_ONCE');
  const foreignNotifications = assertNoError(await dietitianBApi.from('notifications').select('id').eq('category', 'client_activity'), 'foreign notifications');
  assert(foreignNotifications.length === 0, 'REST_NOTIFICATION_CROSS_DIETITIAN_ISOLATION');

  // Unread counts.
  const sent = assertNoError(await clientApi.rpc('send_chat_message', {
    p_dietitian_client_id: relation.id, p_client_message_id: randomUUID(), p_body: 'Merhaba hocam',
  }), 'client chat send');
  let counts = assertNoError(await dietitianAApi.rpc('get_dietitian_unread_counts'), 'unread counts');
  assert(counts.length === 1 && counts[0].conversation_id === sent.conversation_id && counts[0].unread_count === 1, 'REST_UNREAD_COUNT_AFTER_CLIENT_MESSAGE');
  assertNoError(await dietitianAApi.rpc('mark_chat_conversation_read', {
    p_conversation_id: sent.conversation_id, p_last_read_message_id: sent.id,
  }), 'mark read');
  counts = assertNoError(await dietitianAApi.rpc('get_dietitian_unread_counts'), 'unread counts after read');
  assert(counts[0].unread_count === 0, 'REST_UNREAD_COUNT_ZERO_AFTER_OPEN');
  const foreignCounts = assertNoError(await dietitianBApi.rpc('get_dietitian_unread_counts'), 'foreign unread counts');
  assert(foreignCounts.length === 0, 'REST_UNREAD_COUNT_CROSS_DIETITIAN_ISOLATION');
  expectDenied(await clientApi.rpc('get_dietitian_unread_counts'), 'REST_UNREAD_COUNT_CLIENT_DENIED');

  // Nutrition target.
  const target = assertNoError(await dietitianAApi.rpc('set_client_nutrition_target', {
    p_client_id: clientA.id, p_min_kcal: 1500, p_max_kcal: 1700,
  }), 'set target');
  assert(target.min_kcal === 1500 && target.max_kcal === 1700, 'REST_DIETITIAN_SETS_TARGET');
  const clientTarget = assertNoError(await clientApi.from('client_nutrition_targets').select('min_kcal,max_kcal').eq('client_id', clientA.id), 'client target read');
  assert(clientTarget.length === 1 && clientTarget[0].max_kcal === 1700, 'REST_CLIENT_READS_TARGET');
  expectDenied(await clientApi.from('client_nutrition_targets').update({ max_kcal: 4000 }).eq('client_id', clientA.id), 'REST_CLIENT_TARGET_UPDATE_DENIED');
  expectDenied(await dietitianBApi.rpc('set_client_nutrition_target', { p_client_id: clientA.id, p_min_kcal: 1500, p_max_kcal: 1700 }), 'REST_FOREIGN_TARGET_DENIED');

  // Slot label save + client read.
  const weekStart = runSql("select (date_trunc('week', (now() at time zone 'Europe/Istanbul')::date)::date + 7)::text");
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(`${weekStart}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + index);
    return {
      plan_date: date.toISOString().slice(0, 10),
      notes: null,
      meals: index === 0 ? [{
        type: 'snack', title: 'Muz', time: '17:30', sort_order: 0, source: 'manual', calories: 105,
        macros: { protein: 1, carbs: 27, fat: 0 }, slot_label: 'Antrenman öncesi',
      }] : [],
    };
  });
  const saved = assertNoError(await dietitianAApi.rpc('save_weekly_meal_plan', {
    p_client_id: clientA.id, p_week_start: weekStart, p_days: days,
  }), 'save weekly plan');
  assert(saved.plans[0].meals[0].slot_label === 'Antrenman öncesi', 'REST_SLOT_LABEL_SAVED');
  const clientMeals = assertNoError(await clientApi.from('meals').select('id,type,title,slot_label')
    .eq('id', saved.plans[0].meals[0].id), 'client meal read');
  assert(clientMeals[0]?.slot_label === 'Antrenman öncesi' && clientMeals[0]?.type === 'snack', 'REST_CLIENT_READS_SLOT_LABEL');
  const clientPlanNotifications = assertNoError(await clientApi.from('notifications').select('id').eq('category', 'meal_plan'), 'client plan notifications');
  assert(clientPlanNotifications.length === 0, 'REST_PLAN_UPDATED_GATED_OFF');
};

const run = async () => {
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  addCurrentIsolatedMigrations({ repoRoot, tempRoot: disposable.tempRoot });
  addFaz2Migrations({ repoRoot, tempRoot: disposable.tempRoot });
  addAutomaticTaskDismissalMigration({ repoRoot, tempRoot: disposable.tempRoot });
  const migrationFiles = readdirSync(join(disposable.tempRoot, 'supabase', 'migrations'))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  assert(migrationFiles.at(-1) === AUTOMATIC_TASK_DISMISSAL_MIGRATION, 'DASHBOARD_PREFERENCE_MIGRATION_IS_DISPOSABLE_TAIL');
  assert(migrationFiles.length === 63 + FAZ2_MIGRATIONS.length, `DISPOSABLE_MIGRATION_CHAIN_${63 + FAZ2_MIGRATIONS.length}`);
  await configureDisposableProject(disposable.configPath);
  stackStartAttempted = true;
  runCli(disposable.tempRoot, ['start']);
  pass('DISPOSABLE_LOCAL_STACK_STARTED', projectId);
  runCli(disposable.tempRoot, ['db', 'reset', '--local', '--no-seed']);
  pass('DISPOSABLE_MIGRATIONS_APPLIED_LOCAL_ONLY');
  local = parseStatus(runCli(disposable.tempRoot, ['status', '--output', 'env']));
  assertCiSafeEnvironment({ SUPABASE_URL: local.API_URL }, { requireLoopback: true });
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? ''), 'LOOPBACK_API_ONLY');
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'DISPOSABLE_KEYS_PRESENT');
  assert(runSql('select count(*) from supabase_migrations.schema_migrations') === String(63 + FAZ2_MIGRATIONS.length), 'SCHEMA_MIGRATION_REPLAY_COMPLETE');

  const sqlOutput = runSqlFile(sqlContractPath);
  assert(sqlOutput.includes('FAZ2_BACKEND_CONTRACT_PASS'), 'SQL_CONTRACT_MATRIX_PASS');

  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, clientOptions);
  await runRestFlows();
  pass('FAZ2_RUNTIME_PASS');
};

try {
  await run();
} catch (error) {
  mainError = error;
} finally {
  if (stackStartAttempted && disposable?.tempRoot) {
    try {
      runCli(disposable.tempRoot, ['stop', '--no-backup']);
      pass('DISPOSABLE_LOCAL_STACK_STOPPED', projectId);
    } catch (stopError) {
      mainError = mainError
        ? new Error(`${mainError.message}; local stack stop failed: ${stopError.message}`)
        : stopError;
    }
  }
  if (disposable?.tempRoot) {
    try {
      rmSync(dirname(disposable.tempRoot), { recursive: true, force: true });
    } catch (removeError) {
      mainError = mainError
        ? new Error(`${mainError.message}; disposable workdir cleanup failed: ${removeError.message}`)
        : removeError;
    }
  }
}

if (mainError) {
  process.stderr.write(`[faz2-runtime] ${mainError.message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('FAZ2_RUNTIME_HARNESS_PASS\n');
}
