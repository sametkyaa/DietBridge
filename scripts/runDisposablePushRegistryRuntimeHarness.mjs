#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
const appointmentReminderMigrationName = '20260817084531_appointment_reminders_backend.sql';
const pushRegistryMigrationName = '20260817120000_push_registry_outbox_backend.sql';
const supabaseVersion = '2.110.0';
const password = 'Disposable-Push-Registry-6b!';
const projectId = 'dietbridge-push-registry-' + process.pid + '-' + randomUUID().slice(0, 8);
const npxCli = process.env.npm_execpath
  ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');

const actorIds = [];
const relationshipIds = [];
const appointmentIds = [];
const mealPlanIds = [];
const mealIds = [];
const messageIds = [];
const conversationIds = [];
const installationIds = new Set();

let disposable;
let local;
let admin;
let stackStartAttempted = false;
let mainError;

const pass = (label, detail = '') => {
  process.stdout.write('PASS: ' + label + (detail ? ' ' + detail : '') + '\n');
};

const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(label + (detail ? ': ' + detail : ''));
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

const assertRpcError = (result, label) => {
  assert(Boolean(result?.error), label, result?.error?.code ?? 'denied');
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
    throw new Error('Supabase ' + args.join(' ') + ' failed: ' + redact(error.message)
      + '\n' + redact(String(error.stdout ?? '').slice(-8000))
      + '\n' + redact(String(error.stderr ?? '').slice(-8000)));
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

const createAnonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActorClient = async (actor) => {
  const sessionResult = await createAnonymousClient().auth.signInWithPassword({
    email: actor.email,
    password,
  });
  const session = assertNoError(sessionResult, actor.label + ' sign-in');
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + session.session.access_token } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const createActor = async (label, role) => {
  const result = await admin.auth.admin.createUser({
    email: `push-6b-${label}-${randomUUID()}@example.invalid`,
    password,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: 'Disposable Push ' + label,
      push_registry_harness: 'phase-6b',
    },
  });
  const data = assertNoError(result, label + ' Auth fixture');
  assert(Boolean(data.user?.id), label.toUpperCase() + '_AUTH_CREATED');
  actorIds.push(data.user.id);
  return { id: data.user.id, email: data.user.email, label, role };
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

const runSchema = (sql) => execFileSync('docker', [
  'exec', '-i', 'supabase_db_' + projectId,
  'psql', '-U', 'postgres', '-d', 'postgres',
  '-v', 'ON_ERROR_STOP=1', '-Atc', sql,
], { encoding: 'utf8', timeout: 30_000 }).trim();

const runSchemaExpectFailure = (sql) => {
  try {
    runSchema(sql);
  } catch (error) {
    return redact(error.message);
  }
  throw new Error('Expected disposable SQL failure but statement succeeded.');
};

const countBySql = (sql) => Number(readSchema(sql));

const sqlLiteral = (value) => `'${String(value).replaceAll("'", "''")}'`;

const syntheticToken = (suffix) => `ExponentPushToken[phase6b-${suffix}-${randomUUID().slice(0, 8)}]`;

const register = async (client, installationId, token, label, platform = 'android') => {
  installationIds.add(installationId);
  const result = await client.rpc('register_push_installation', {
    p_installation_id: installationId,
    p_expo_push_token: token,
    p_platform: platform,
    p_project_id: projectIdUuid,
    p_app_version: '6b-test',
    p_native_build_version: '6b-build',
  });
  const rows = assertNoError(result, label);
  assert(Array.isArray(rows) && rows.length === 1, label + '_SAFE_METADATA_ONLY');
  assert(!Object.prototype.hasOwnProperty.call(rows[0], 'expo_push_token'), label + '_TOKEN_NOT_RETURNED');
  return rows[0];
};

const readNotification = async (recipientId, aggregationKey, label) => {
  const rows = assertNoError(await admin.from('notifications')
    .select('*')
    .eq('recipient_id', recipientId)
    .eq('aggregation_key', aggregationKey), label);
  assert(rows.length <= 1, label + '_ONE_AGGREGATE_ROW', 'rows=' + rows.length);
  return rows[0] ?? null;
};

const occurrenceIdForNotification = (notificationId) => readSchema(
  `select id from private.push_occurrences where notification_id = ${sqlLiteral(notificationId)} order by created_at desc, id desc limit 1;`,
);

const occurrenceCountForNotification = (notificationId) => countBySql(
  `select count(*) from private.push_occurrences where notification_id = ${sqlLiteral(notificationId)};`,
);

const deliveryCountForOccurrence = (occurrenceId) => countBySql(
  `select count(*) from private.push_deliveries where occurrence_id = ${sqlLiteral(occurrenceId)};`,
);

const installationRowId = (installationId, enabledOnly = false) => readSchema(
  `select id from private.push_installations where installation_id = ${sqlLiteral(installationId)}${enabledOnly ? ' and enabled' : ''} order by created_at desc, id desc limit 1;`,
);

const deliveryIdFor = (occurrenceId, installationId) => readSchema(
  `select d.id
     from private.push_deliveries d
     join private.push_installations i on i.id = d.installation_id
    where d.occurrence_id = ${sqlLiteral(occurrenceId)}
      and i.installation_id = ${sqlLiteral(installationId)}
    order by d.id desc limit 1;`,
);

const currentOwnerEligible = (deliveryId) => countBySql(
  `select count(*)
     from private.push_deliveries d
     join private.push_installations i on i.id = d.installation_id
    where d.id = ${sqlLiteral(deliveryId)}
      and d.status in ('pending', 'claimed', 'retryable')
      and i.enabled
      and i.user_id = d.recipient_id;`,
);

const cleanupFixtures = async () => {
  if (!admin) return;

  if (messageIds.length) {
    if (conversationIds.length) {
      assertNoError(await admin.from('chat_conversations').update({
        last_message_id: null,
        last_message_at: null,
      }).in('id', conversationIds), 'chat pointer cleanup');
    }
    assertNoError(await admin.from('chat_messages').delete().in('id', messageIds), 'chat message cleanup');
  }
  if (conversationIds.length) {
    assertNoError(await admin.from('chat_conversations').delete().in('id', conversationIds), 'chat conversation cleanup');
  }
  if (mealIds.length) assertNoError(await admin.from('meals').delete().in('id', mealIds), 'meal cleanup');
  if (mealPlanIds.length) assertNoError(await admin.from('meal_plans').delete().in('id', mealPlanIds), 'meal plan cleanup');
  if (appointmentIds.length) assertNoError(await admin.from('appointments').delete().in('id', appointmentIds), 'appointment cleanup');
  if (relationshipIds.length) assertNoError(await admin.from('dietitian_clients').delete().in('id', relationshipIds), 'relationship cleanup');
  if (actorIds.length) {
    const dietitianIds = actorIds.filter((id) => id === dietitianAId || id === dietitianBId);
    if (dietitianIds.length) {
      assertNoError(await admin.from('dietitian_subscriptions').delete().in('dietitian_id', dietitianIds), 'subscription cleanup');
    }
  }
  if (actorIds.length) assertNoError(await admin.from('notifications').delete().in('recipient_id', actorIds), 'notification cleanup');

  for (const actorId of [...actorIds].reverse()) {
    assertNoError(await admin.auth.admin.deleteUser(actorId), 'Auth cleanup');
  }

  const actors = actorIds.length
    ? `array[${actorIds.map(sqlLiteral).join(',')}]::uuid[]`
    : 'array[]::uuid[]';
  assert(countBySql(`select count(*) from public.notifications where recipient_id = any(${actors});`) === 0, 'RESIDUE_NOTIFICATIONS_ZERO');
  assert(countBySql(`select count(*) from auth.users where id = any(${actors});`) === 0, 'RESIDUE_AUTH_ZERO');
  assert(countBySql('select count(*) from private.push_installations;') === 0, 'RESIDUE_PUSH_INSTALLATIONS_ZERO');
  assert(countBySql('select count(*) from private.push_occurrences;') === 0, 'RESIDUE_PUSH_OCCURRENCES_ZERO');
  assert(countBySql('select count(*) from private.push_deliveries;') === 0, 'RESIDUE_PUSH_DELIVERIES_ZERO');
  assert(countBySql('select count(*) from public.appointments;') === 0, 'RESIDUE_APPOINTMENTS_ZERO');
  assert(countBySql('select count(*) from public.dietitian_clients;') === 0, 'RESIDUE_RELATIONSHIPS_ZERO');
  assert(countBySql('select count(*) from public.meal_plans;') === 0, 'RESIDUE_MEAL_PLANS_ZERO');
  assert(countBySql('select count(*) from public.meals;') === 0, 'RESIDUE_MEALS_ZERO');
  pass('DISPOSABLE_DATABASE_RESIDUE_ZERO');
};

const projectIdUuid = randomUUID();
let dietitianAId;
let dietitianBId;

const runFlows = async () => {
  const sourceMigrations = readdirSync(migrationDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  assert(sourceMigrations.length === 54, 'CANONICAL_MIGRATION_INVENTORY_54');
  assert(sourceMigrations.at(-1) === '20260831071948_meal_plan_new_recipe_custom_snapshot_contract.sql', 'CANONICAL_MEAL_PLAN_SAVE_MIGRATION_TAIL');

  const tempParent = mkdtempSync(join(tmpdir(), 'dietbridge-push-registry-'));
  const tempRoot = join(tempParent, 'project');
  const runtimeManifest = materializeDisposableReplay({ repoRoot, outputRoot: tempRoot });
  const configPath = join(tempRoot, 'supabase', 'config.toml');
  copyFileSync(join(repoRoot, 'supabase', 'config.toml'), configPath, 1);
  disposable = { tempParent, tempRoot, configPath, runtimeManifest };

  const runtimeMigrationDirectory = join(tempRoot, 'supabase', 'migrations');
  for (const migrationName of [notificationCoreMigrationName, appointmentReminderMigrationName, pushRegistryMigrationName]) {
    const destination = join(runtimeMigrationDirectory, migrationName);
    if (existsSync(destination)) throw new Error('Disposable migration destination already exists: ' + migrationName);
    copyFileSync(join(migrationDirectory, migrationName), destination, 1);
  }
  const prerequisitePath = join(runtimeMigrationDirectory, LOCAL_PREREQUISITE_FILE);
  writeFileSync(prerequisitePath, LOCAL_PREREQUISITE_SQL, { flag: 'wx' });
  const runtimeFiles = readdirSync(runtimeMigrationDirectory)
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  assert(runtimeFiles.length === 55, 'DISPOSABLE_MIGRATION_FILES_55');

  await configureDisposableProject(configPath);
  stackStartAttempted = true;
  runCli(tempRoot, ['start']);
  pass('DISPOSABLE_LOCAL_STACK_STARTED', projectId);
  runCli(tempRoot, ['db', 'reset', '--local', '--no-seed']);
  assert(countBySql('select count(*) from supabase_migrations.schema_migrations;') === 55, 'DISPOSABLE_MIGRATION_REPLAY_54_PLUS_PREREQUISITE');
  runCli(tempRoot, ['db', 'advisors', '--local', '--type', 'security', '--level', 'error', '--fail-on', 'error']);
  pass('LOCAL_SECURITY_ADVISORS_NO_ERROR');
  runCli(tempRoot, ['db', 'lint', '--local', '--schema', 'private,public', '--fail-on', 'error']);
  pass('LOCAL_DATABASE_LINT_NO_ERROR');
  local = parseStatus(runCli(tempRoot, ['status', '--output', 'env']));
  assert(local.API_URL.startsWith('http://127.0.0.1:'), 'DISPOSABLE_LOOPBACK_ONLY');
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'DISPOSABLE_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  assert(countBySql("select count(*) from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'private';") === 0, 'PRIVATE_PUSH_NOT_REALTIME_PUBLISHED');
  assert(countBySql("select count(*) from pg_proc where pronamespace = 'public'::regnamespace and proname in ('register_push_installation', 'revoke_push_installation');") === 2, 'PUSH_RPC_SCHEMA_PRESENT');

  const dietitianA = await createActor('dietitian-a', 'dietitian');
  const dietitianB = await createActor('dietitian-b', 'dietitian');
  dietitianAId = dietitianA.id;
  dietitianBId = dietitianB.id;
  const clientA = await createActor('client-a', 'client');
  const clientB = await createActor('client-b', 'client');
  const clientC = await createActor('client-c', 'client');
  const api = {
    dietitianA: await createActorClient(dietitianA),
    dietitianB: await createActorClient(dietitianB),
    clientA: await createActorClient(clientA),
    clientB: await createActorClient(clientB),
    clientC: await createActorClient(clientC),
    anonymous: createAnonymousClient(),
  };

  for (const dietitian of [dietitianA, dietitianB]) {
    const approval = await admin.from('dietitian_profiles').update({
      verification_status: 'approved',
      is_verified: true,
      verified_at: '2026-08-15T08:00:00.000Z',
      rejection_reason: null,
    }).eq('user_id', dietitian.id).select('user_id,verification_status,is_verified').single();
    assertNoError(approval, dietitian.label + ' approval');
    const subscription = await admin.from('dietitian_subscriptions').upsert({
      dietitian_id: dietitian.id,
      plan_id: 'core',
      status: 'active',
      client_limit_override: null,
    }).select('dietitian_id,plan_id,status').single();
    assertNoError(subscription, dietitian.label + ' subscription');
  }

  const installationX = randomUUID();
  const installationY = randomUUID();
  const installationD = randomUUID();
  const tokenX1 = syntheticToken('x1');
  const tokenX2 = syntheticToken('x2');
  const tokenY = syntheticToken('y');
  const tokenD = syntheticToken('d');

  assertRpcError(await api.anonymous.rpc('register_push_installation', {
    p_installation_id: installationX,
    p_expo_push_token: tokenX1,
    p_platform: 'android',
    p_project_id: projectIdUuid,
    p_app_version: null,
    p_native_build_version: null,
  }), 'ANON_REGISTER_DENY');
  assertRpcError(await api.clientA.rpc('register_push_installation', {
    p_installation_id: randomUUID(),
    p_expo_push_token: 'not-a-push-token',
    p_platform: 'android',
    p_project_id: projectIdUuid,
    p_app_version: null,
    p_native_build_version: null,
  }), 'INVALID_TOKEN_DENY');
  assertRpcError(await api.clientA.rpc('register_push_installation', {
    p_installation_id: randomUUID(),
    p_expo_push_token: syntheticToken('no-project'),
    p_platform: 'android',
    p_project_id: null,
    p_app_version: null,
    p_native_build_version: null,
  }), 'MISSING_PROJECT_ID_DENY');
  assertRpcError(await api.clientA.rpc('register_push_installation', {
    p_installation_id: randomUUID(),
    p_expo_push_token: syntheticToken('platform'),
    p_platform: 'windows',
    p_project_id: projectIdUuid,
    p_app_version: null,
    p_native_build_version: null,
  }), 'INVALID_PLATFORM_DENY');
  assert(Boolean((await api.clientA.from('push_installations').select('*')).error), 'DIRECT_REGISTRY_API_DENY');
  assert(Boolean((await api.clientA.from('push_occurrences').select('*')).error), 'DIRECT_OCCURRENCE_API_DENY');
  assert(Boolean((await api.clientA.from('push_deliveries').select('*')).error), 'DIRECT_DELIVERY_API_DENY');

  await register(api.clientA, installationX, tokenX1, 'CLIENT_A_X_FIRST');
  await register(api.clientA, installationX, tokenX1, 'CLIENT_A_X_REREGISTER');
  assert(countBySql(`select count(*) from private.push_installations where installation_id = ${sqlLiteral(installationX)} and enabled;`) === 1, 'REREGISTRATION_ONE_ACTIVE_INSTALLATION');
  await register(api.clientA, installationX, tokenX2, 'CLIENT_A_X_TOKEN_ROTATION');
  assert(countBySql(`select count(*) from private.push_installations where expo_push_token = ${sqlLiteral(tokenX1)} and enabled;`) === 0, 'TOKEN_ROTATION_OLD_TOKEN_DISABLED');
  assert(countBySql(`select count(*) from private.push_installations where expo_push_token = ${sqlLiteral(tokenX2)} and enabled;`) === 1, 'TOKEN_ROTATION_NEW_TOKEN_ACTIVE');
  await register(api.clientA, installationY, tokenY, 'CLIENT_A_Y_REGISTER');
  await register(api.dietitianA, installationD, tokenD, 'DIETITIAN_A_REGISTER');
  assert(countBySql(`select count(*) from private.push_installations where user_id = ${sqlLiteral(clientA.id)} and enabled;`) === 2, 'MULTI_DEVICE_REGISTRY_TWO_ACTIVE');

  const sameUserInstallationA = randomUUID();
  const sameUserInstallationB = randomUUID();
  const concurrentSameUser = await Promise.all([
    register(api.clientA, sameUserInstallationA, syntheticToken('same-user-a'), 'CONCURRENT_SAME_USER_A'),
    register(api.clientA, sameUserInstallationB, syntheticToken('same-user-b'), 'CONCURRENT_SAME_USER_B'),
  ]);
  assert(concurrentSameUser.length === 2, 'CONCURRENT_SAME_USER_COMPLETED');
  await api.clientA.rpc('revoke_push_installation', { p_installation_id: sameUserInstallationA });
  await api.clientA.rpc('revoke_push_installation', { p_installation_id: sameUserInstallationB });

  const concurrentInstall = randomUUID();
  await Promise.all([
    register(api.clientA, concurrentInstall, syntheticToken('rebind-a'), 'CONCURRENT_REBIND_A'),
    register(api.clientB, concurrentInstall, syntheticToken('rebind-b'), 'CONCURRENT_REBIND_B'),
  ]);
  assert(countBySql(`select count(*) from private.push_installations where installation_id = ${sqlLiteral(concurrentInstall)} and enabled;`) === 1, 'CONCURRENT_INSTALLATION_ONE_ACTIVE_OWNER');
  await api.clientA.rpc('revoke_push_installation', { p_installation_id: concurrentInstall });
  await api.clientB.rpc('revoke_push_installation', { p_installation_id: concurrentInstall });

  const collisionToken = syntheticToken('collision');
  const collisionInstallationA = randomUUID();
  const collisionInstallationB = randomUUID();
  await Promise.all([
    register(api.clientA, collisionInstallationA, collisionToken, 'CONCURRENT_TOKEN_COLLISION_A'),
    register(api.clientB, collisionInstallationB, collisionToken, 'CONCURRENT_TOKEN_COLLISION_B'),
  ]);
  assert(countBySql(`select count(*) from private.push_installations where expo_push_token = ${sqlLiteral(collisionToken)} and enabled;`) === 1, 'CONCURRENT_TOKEN_ONE_ACTIVE_OWNER');
  await api.clientA.rpc('revoke_push_installation', { p_installation_id: collisionInstallationA });
  await api.clientB.rpc('revoke_push_installation', { p_installation_id: collisionInstallationB });

  const relationAA = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitianA.id,
    client_id: clientA.id,
    status: 'pending',
  }).select('id,dietitian_id,client_id,status').single(), 'relationship A/A insert');
  relationshipIds.push(relationAA.id);
  assert(countBySql(`select count(*) from private.push_installations where user_id = ${sqlLiteral(clientA.id)} and enabled;`) === 2, 'RELATIONSHIP_PENDING_ACTIVE_INSTALLATIONS_BEFORE_FANOUT');
  const pendingAA = await readNotification(clientA.id, 'relationship:' + relationAA.id, 'RELATIONSHIP_PENDING');
  assert(pendingAA?.event_type === 'request_pending', 'RELATIONSHIP_PENDING_OCCURRENCE_SOURCE');
  const pendingOccurrence = occurrenceIdForNotification(pendingAA.id);
  assert(Boolean(pendingOccurrence), 'RELATIONSHIP_PENDING_OCCURRENCE');
  assert(deliveryCountForOccurrence(pendingOccurrence) === 2, 'RELATIONSHIP_PENDING_TWO_ACTIVE_DELIVERIES');

  const pendingDeliveryForX = deliveryIdFor(pendingOccurrence, installationX);
  assert(Boolean(pendingDeliveryForX), 'PENDING_DELIVERY_FOR_X');
  assert(currentOwnerEligible(pendingDeliveryForX) === 1, 'PENDING_DELIVERY_CURRENT_OWNER_ELIGIBLE');

  await register(api.clientB, installationX, syntheticToken('rebound-to-b'), 'ACCOUNT_REBIND_A_TO_B');
  assert(countBySql(`select count(*) from private.push_installations where installation_id = ${sqlLiteral(installationX)} and enabled and user_id = ${sqlLiteral(clientB.id)};`) === 1, 'ACCOUNT_REBIND_ACTIVE_OWNER_B');
  assert(currentOwnerEligible(pendingDeliveryForX) === 0, 'ACCOUNT_REBIND_OLD_DELIVERY_SKIPPED');
  assert(countBySql(`select count(*) from public.notifications where id = ${sqlLiteral(pendingAA.id)};`) === 1, 'ACCOUNT_REBIND_NOTIFICATION_PRESERVED');
  await register(api.clientA, installationX, syntheticToken('rebound-back-a'), 'ACCOUNT_REBIND_BACK_FOR_TESTS');

  const activeRelationship = assertNoError(await admin.from('dietitian_clients').update({ status: 'active' })
    .eq('id', relationAA.id).select('id,status').single(), 'relationship A/A activate');
  assert(activeRelationship.status === 'active', 'RELATIONSHIP_ACTIVE');
  const acceptedNotification = await readNotification(dietitianA.id, 'relationship:' + relationAA.id, 'RELATIONSHIP_ACCEPTED');
  assert(acceptedNotification?.event_type === 'accepted', 'RELATIONSHIP_ACCEPTED_OCCURRENCE_SOURCE');
  assert(Boolean(occurrenceIdForNotification(acceptedNotification.id)), 'RELATIONSHIP_ACCEPTED_OCCURRENCE');

  const chatOne = assertNoError(await api.dietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationAA.id,
    p_client_message_id: randomUUID(),
    p_body: 'Phase 6B disposable chat one',
  }), 'chat message one');
  messageIds.push(chatOne.id);
  conversationIds.push(chatOne.conversation_id);
  const chatKey = 'chat:' + chatOne.conversation_id;
  let chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_ONE_NOTIFICATION');
  assert(chatNotification?.event_type === 'new_message' && chatNotification.event_count === 1, 'CHAT_NOTIFICATION_SOURCE');
  let chatOccurrence = occurrenceIdForNotification(chatNotification.id);
  assert(Boolean(chatOccurrence), 'CHAT_OCCURRENCE_ONE');
  assert(deliveryCountForOccurrence(chatOccurrence) === 2, 'CHAT_TWO_DEVICE_FANOUT');
  const chatDelivery = deliveryIdFor(chatOccurrence, installationX);
  const chatAvailabilitySeconds = Number(readSchema(
    `select round(extract(epoch from (available_at - created_at))) from private.push_deliveries where id = ${sqlLiteral(chatDelivery)};`,
  ));
  assert(chatAvailabilitySeconds >= 59, 'CHAT_60_SECOND_COALESCING_DELAY', String(chatAvailabilitySeconds));

  const beforeSeenOccurrenceCount = occurrenceCountForNotification(chatNotification.id);
  assertNoError(await api.clientA.rpc('mark_notification_seen', { p_notification_id: chatNotification.id }), 'mark chat seen');
  assert(occurrenceCountForNotification(chatNotification.id) === beforeSeenOccurrenceCount, 'SEEN_ONLY_ZERO_NEW_OCCURRENCE');
  assertNoError(await api.clientA.rpc('mark_notification_read', { p_notification_id: chatNotification.id }), 'mark chat read');
  assert(occurrenceCountForNotification(chatNotification.id) === beforeSeenOccurrenceCount, 'READ_ONLY_ZERO_NEW_OCCURRENCE');
  assertNoError(await api.clientA.rpc('mark_all_notifications_read'), 'mark all read');
  assert(occurrenceCountForNotification(chatNotification.id) === beforeSeenOccurrenceCount, 'MARK_ALL_READ_ZERO_NEW_OCCURRENCE');

  const chatTwo = assertNoError(await api.dietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationAA.id,
    p_client_message_id: randomUUID(),
    p_body: 'Phase 6B disposable chat rearm',
  }), 'chat message rearm');
  messageIds.push(chatTwo.id);
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_REARM_NOTIFICATION');
  assert(chatNotification?.event_count === 1 && chatNotification.read_at === null, 'READ_AGGREGATE_REARM_SOURCE');
  assert(occurrenceCountForNotification(chatNotification.id) === beforeSeenOccurrenceCount + 1, 'READ_AGGREGATE_REARM_OCCURRENCE');

  const appointment = assertNoError(await api.dietitianA.from('appointments').insert({
    dietitian_id: dietitianA.id,
    client_id: clientA.id,
    title: 'Phase 6B disposable appointment',
    date: '2099-12-10',
    time: '09:30:00',
    duration: 45,
    type: 'online',
    status: 'upcoming',
  }).select('*').single(), 'appointment create');
  appointmentIds.push(appointment.id);
  const appointmentKey = 'appointment:' + appointment.id;
  let appointmentNotification = await readNotification(clientA.id, appointmentKey, 'APPOINTMENT_CREATED');
  assert(appointmentNotification?.event_type === 'created', 'APPOINTMENT_CREATED_OCCURRENCE_SOURCE');
  const appointmentOccurrenceOne = occurrenceIdForNotification(appointmentNotification.id);
  assert(deliveryCountForOccurrence(appointmentOccurrenceOne) === 2, 'APPOINTMENT_TWO_DEVICE_FANOUT');
  await assertNoError(await api.dietitianA.from('appointments').update({ title: 'Phase 6B disposable appointment updated' })
    .eq('id', appointment.id).select('*').single(), 'appointment update');
  appointmentNotification = await readNotification(clientA.id, appointmentKey, 'APPOINTMENT_UPDATED');
  assert(appointmentNotification?.event_type === 'updated' && appointmentNotification.event_count === 2, 'APPOINTMENT_MEANINGFUL_UPDATE_OCCURRENCE');
  const appointmentOccurrencesBeforeRearm = occurrenceCountForNotification(appointmentNotification.id);
  assertNoError(await api.clientA.rpc('mark_notification_read', { p_notification_id: appointmentNotification.id }), 'appointment notification read');
  await assertNoError(await api.dietitianA.from('appointments').update({ title: 'Phase 6B disposable appointment rearmed' })
    .eq('id', appointment.id).select('*').single(), 'appointment rearm update');
  appointmentNotification = await readNotification(clientA.id, appointmentKey, 'APPOINTMENT_REARM');
  assert(appointmentNotification?.event_count === 1, 'APPOINTMENT_READ_REARM_SOURCE');
  assert(occurrenceCountForNotification(appointmentNotification.id) === appointmentOccurrencesBeforeRearm + 1, 'APPOINTMENT_READ_REARM_OCCURRENCE');
  await assertNoError(await api.dietitianA.from('appointments').update({ status: 'cancelled' })
    .eq('id', appointment.id).select('*').single(), 'appointment cancellation');
  appointmentNotification = await readNotification(clientA.id, appointmentKey, 'APPOINTMENT_CANCELLED');
  assert(appointmentNotification?.event_type === 'cancelled', 'APPOINTMENT_CANCELLED_OCCURRENCE');

  const relationAB = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitianA.id,
    client_id: clientB.id,
    status: 'pending',
  }).select('id,dietitian_id,client_id,status').single(), 'relationship A/B insert');
  relationshipIds.push(relationAB.id);
  const relationABPending = await readNotification(clientB.id, 'relationship:' + relationAB.id, 'RELATIONSHIP_B_PENDING');
  assert(relationABPending?.event_type === 'request_pending', 'RELATIONSHIP_B_PENDING_OCCURRENCE');
  await assertNoError(await admin.from('dietitian_clients').update({ status: 'rejected' })
    .eq('id', relationAB.id).select('id,status').single(), 'relationship A/B reject');
  const relationABRejected = await readNotification(dietitianA.id, 'relationship:' + relationAB.id, 'RELATIONSHIP_B_REJECTED');
  assert(relationABRejected?.event_type === 'rejected', 'RELATIONSHIP_REJECTED_OCCURRENCE');
  await assertNoError(await admin.from('dietitian_clients').update({ status: 'pending' })
    .eq('id', relationAB.id).select('id,status').single(), 'relationship A/B reopen');
  await assertNoError(await admin.from('dietitian_clients').update({ status: 'active' })
    .eq('id', relationAB.id).select('id,status').single(), 'relationship A/B activate');
  const relationABAccepted = await readNotification(dietitianA.id, 'relationship:' + relationAB.id, 'RELATIONSHIP_B_ACCEPTED');
  assert(relationABAccepted?.event_type === 'accepted', 'RELATIONSHIP_REOPEN_ACCEPTED_OCCURRENCE');
  await assertNoError(await admin.from('dietitian_clients').update({ status: 'removed' })
    .eq('id', relationAB.id).select('id,status').single(), 'relationship A/B remove');
  const relationABRemoved = await readNotification(clientB.id, 'relationship:' + relationAB.id, 'RELATIONSHIP_B_REMOVED');
  assert(relationABRemoved?.event_type === 'removed', 'RELATIONSHIP_REMOVED_OCCURRENCE');

  const reminderAppointmentId = randomUUID();
  const reminder24Key = `appointment_reminder:${reminderAppointmentId}:2099-12-10:09:30:24h`;
  const reminder1Key = `appointment_reminder:${reminderAppointmentId}:2099-12-10:09:30:1h`;
  const reminderSqlBase = `select private.insert_appointment_reminder_once(${sqlLiteral(clientA.id)}, ${sqlLiteral(reminderAppointmentId)},`;
  const reminder24Result = readSchema(`${reminderSqlBase} 'reminder_24h', 'appointment_reminder_24h', 'Phase 6B reminder', '2099-12-10', '09:30:00', '24h', now());`);
  assert(reminder24Result === 't', 'REMINDER_24H_CANONICAL_PRODUCER');
  const reminder24 = await readNotification(clientA.id, reminder24Key, 'REMINDER_24H_NOTIFICATION');
  assert(reminder24?.event_type === 'reminder_24h', 'REMINDER_24H_OCCURRENCE_SOURCE');
  assert(deliveryCountForOccurrence(occurrenceIdForNotification(reminder24.id)) >= 1, 'REMINDER_24H_DELIVERY');
  const reminder24Occurrences = occurrenceCountForNotification(reminder24.id);
  const reminder24Retry = readSchema(`${reminderSqlBase} 'reminder_24h', 'appointment_reminder_24h', 'Phase 6B reminder', '2099-12-10', '09:30:00', '24h', now());`);
  assert(reminder24Retry === 'f', 'REMINDER_24H_INSERT_ONCE');
  assert(occurrenceCountForNotification(reminder24.id) === reminder24Occurrences, 'REMINDER_RETRY_NO_DUPLICATE_OCCURRENCE');
  readSchema(`${reminderSqlBase} 'reminder_1h', 'appointment_reminder_1h', 'Phase 6B reminder', '2099-12-10', '09:30:00', '1h', now());`);
  const reminder1 = await readNotification(clientA.id, reminder1Key, 'REMINDER_1H_NOTIFICATION');
  assert(reminder1?.event_type === 'reminder_1h', 'REMINDER_1H_OCCURRENCE_SOURCE');

  const clientCNotificationBefore = countBySql(`select count(*) from private.push_occurrences where recipient_id = ${sqlLiteral(clientC.id)};`);
  const relationAC = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitianA.id,
    client_id: clientC.id,
    status: 'pending',
  }).select('id,dietitian_id,client_id,status').single(), 'relationship A/C zero-device insert');
  relationshipIds.push(relationAC.id);
  const relationACPending = await readNotification(clientC.id, 'relationship:' + relationAC.id, 'RELATIONSHIP_C_PENDING');
  assert(Boolean(relationACPending), 'ZERO_DEVICE_NOTIFICATION_PERSISTED');
  const relationACOccurrence = occurrenceIdForNotification(relationACPending.id);
  assert(occurrenceCountForNotification(relationACPending.id) === 1, 'ZERO_DEVICE_ONE_OCCURRENCE');
  assert(deliveryCountForOccurrence(relationACOccurrence) === 0, 'ZERO_DEVICE_ZERO_DELIVERIES');
  assert(countBySql(`select count(*) from private.push_occurrences where recipient_id = ${sqlLiteral(clientC.id)};`) === clientCNotificationBefore + 1, 'ZERO_DEVICE_NO_SOURCE_LOSS');

  const newDevice = randomUUID();
  const beforeNewDevice = deliveryCountForOccurrence(chatOccurrence);
  await register(api.clientA, newDevice, syntheticToken('historical'), 'NEW_DEVICE_AFTER_OCCURRENCE');
  const newDeviceRowId = installationRowId(newDevice, true);
  assert(countBySql(`select count(*) from private.push_deliveries where occurrence_id = ${sqlLiteral(chatOccurrence)} and installation_id = ${sqlLiteral(newDeviceRowId)};`) === 0, 'NEW_DEVICE_NO_HISTORICAL_DELIVERY');
  assert(deliveryCountForOccurrence(chatOccurrence) === beforeNewDevice, 'NEW_DEVICE_NO_EXISTING_FANOUT_CHANGE');
  assertNoError(await api.clientA.rpc('revoke_push_installation', { p_installation_id: newDevice }), 'NEW_DEVICE_REVOKE');

  const yRowId = installationRowId(installationY, true);
  assert(Boolean(yRowId), 'SECOND_DEVICE_ROW_PRESENT');
  assertNoError(await api.clientA.rpc('revoke_push_installation', { p_installation_id: installationY }), 'SECOND_DEVICE_REVOKE');
  const chatThree = assertNoError(await api.dietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationAA.id,
    p_client_message_id: randomUUID(),
    p_body: 'Phase 6B disabled device fanout',
  }), 'chat disabled-device signal');
  messageIds.push(chatThree.id);
  chatNotification = await readNotification(clientA.id, chatKey, 'CHAT_DISABLED_DEVICE_NOTIFICATION');
  const disabledDeviceOccurrence = occurrenceIdForNotification(chatNotification.id);
  assert(deliveryCountForOccurrence(disabledDeviceOccurrence) === 1, 'DISABLED_SECOND_DEVICE_EXCLUDED');
  await register(api.clientA, installationY, syntheticToken('y-reenabled'), 'SECOND_DEVICE_REENABLE');

  const pendingForRevoke = occurrenceIdForNotification(chatNotification.id);
  const revokeDelivery = deliveryIdFor(pendingForRevoke, installationX);
  assert(Boolean(revokeDelivery), 'REVOKE_PENDING_DELIVERY_PRESENT');
  assertNoError(await api.clientA.rpc('revoke_push_installation', { p_installation_id: installationX }), 'SELF_REVOKE');
  assert(currentOwnerEligible(revokeDelivery) === 0, 'REVOKED_PENDING_DELIVERY_SKIPPED');
  assert(countBySql(`select count(*) from public.notifications where id = ${sqlLiteral(chatNotification.id)};`) === 1, 'REVOKE_NOTIFICATION_PRESERVED');
  await register(api.clientA, installationX, syntheticToken('x-current'), 'X_RESTORE_AFTER_REVOKE');

  const tokenRotationChat = assertNoError(await api.dietitianA.rpc('send_chat_message', {
    p_dietitian_client_id: relationAA.id,
    p_client_message_id: randomUUID(),
    p_body: 'Phase 6B queued token rotation',
  }), 'chat token-rotation signal');
  messageIds.push(tokenRotationChat.id);
  const tokenRotationNotification = await readNotification(clientA.id, chatKey, 'CHAT_TOKEN_ROTATION_NOTIFICATION');
  const tokenRotationOccurrence = occurrenceIdForNotification(tokenRotationNotification.id);
  const tokenRotationDelivery = deliveryIdFor(tokenRotationOccurrence, installationX);
  const tokenBeforeRotation = syntheticToken('rotation-before');
  await register(api.clientA, installationX, tokenBeforeRotation, 'X_TOKEN_ROTATION_PENDING');
  await register(api.clientA, installationX, syntheticToken('rotation-after'), 'X_TOKEN_ROTATION_CURRENT');
  assert(countBySql(`select count(*) from private.push_installations where expo_push_token = ${sqlLiteral(tokenBeforeRotation)} and enabled;`) === 0, 'QUEUED_TOKEN_ROTATION_OLD_TOKEN_DISABLED');
  assert(currentOwnerEligible(tokenRotationDelivery) === 1, 'QUEUED_TOKEN_ROTATION_CURRENT_OWNER_ELIGIBLE');
  assert(countBySql(`select count(*) from private.push_deliveries where occurrence_id = ${sqlLiteral(tokenRotationOccurrence)} and installation_id = ${sqlLiteral(installationRowId(installationX))};`) === 1, 'QUEUED_TOKEN_ROTATION_NO_DUPLICATE_DELIVERY');

  const statusFailure = runSchemaExpectFailure(`update private.push_deliveries set status = 'receipt_ok' where id = ${sqlLiteral(tokenRotationDelivery)}; update private.push_deliveries set status = 'pending' where id = ${sqlLiteral(tokenRotationDelivery)};`);
  assert(/Invalid Push delivery status transition/.test(statusFailure), 'TERMINAL_STATUS_CANNOT_REOPEN');

  const mealPlan = assertNoError(await admin.from('meal_plans').insert({
    client_id: clientA.id,
    dietitian_id: dietitianA.id,
    plan_date: '2099-12-10',
    notes: 'Push exclusion fixture',
  }).select('id').single(), 'meal exclusion plan');
  mealPlanIds.push(mealPlan.id);
  const meal = assertNoError(await admin.from('meals').insert({
    plan_id: mealPlan.id,
    type: 'breakfast',
    title: 'Push exclusion meal',
    is_eaten: true,
    source: 'manual',
  }).select('id').single(), 'meal exclusion row');
  mealIds.push(meal.id);
  assert(countBySql(`select count(*) from private.push_occurrences where notification_id is not null and recipient_id = ${sqlLiteral(clientA.id)};`) > 0, 'MEAL_EXCLUSION_BASELINE_EXISTS');
  assert(countBySql(`select count(*) from public.notifications where recipient_id = ${sqlLiteral(clientA.id)} and category not in ('chat_message','appointment','relationship');`) === 0, 'MEAL_ACTIVITY_NO_NOTIFICATION');

  const foreignRevoke = await api.clientB.rpc('revoke_push_installation', { p_installation_id: installationX });
  assertNoError(foreignRevoke, 'FOREIGN_REVOKE_SAFE_RESULT');
  assert(Array.isArray(foreignRevoke.data) && foreignRevoke.data.length === 0, 'FOREIGN_REVOKE_NO_EFFECT');
  assert(countBySql(`select count(*) from private.push_installations where installation_id = ${sqlLiteral(installationX)} and enabled and user_id = ${sqlLiteral(clientA.id)};`) === 1, 'FOREIGN_REVOKE_OWNER_PRESERVED');

  const directAuthSelectFailure = runSchemaExpectFailure(`begin; set local role authenticated; select set_config('request.jwt.claim.sub', ${sqlLiteral(clientA.id)}, true); select * from private.push_installations; rollback;`);
  assert(/permission denied|relation|not exist/i.test(directAuthSelectFailure), 'AUTHENTICATED_DIRECT_PRIVATE_SELECT_DENY');
  assert(countBySql(`select count(*) from private.push_deliveries where recipient_id = ${sqlLiteral(clientA.id)} and expo_ticket_id is not null;`) === 0, 'NO_PHASE6B_EXPO_TICKETS');
  pass('NO_EXPO_NETWORK_CALLS');
  pass('PUSH_REGISTRY_RUNTIME_MATRIX_PASS');
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
      pass('DISPOSABLE_LOCAL_STACK_STOPPED', projectId);
    } catch (error) {
      if (mainError) mainError.message += '; local stack stop failed: ' + redact(error.message);
      else mainError = error;
    }
  }
  if (disposable?.tempParent) {
    try {
      rmSync(disposable.tempParent, { recursive: true, force: true });
      assert(!existsSync(disposable.tempParent), 'DISPOSABLE_TEMP_RESIDUE_ZERO');
    } catch (error) {
      if (mainError) mainError.message += '; temp cleanup failed: ' + error.message;
      else mainError = error;
    }
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
    assert(containerResidual === '' && volumeResidual === '' && networkResidual === '', 'DISPOSABLE_DOCKER_RESIDUE_ZERO');
  } catch (error) {
    if (mainError) mainError.message += '; Docker residue verification failed: ' + redact(error.message);
    else mainError = error;
  }
}

if (mainError) throw mainError;
