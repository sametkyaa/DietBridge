#!/usr/bin/env node

// Disposable-only runtime harness for the Faz 0 migrations:
//   20261005120000_realtime_publication_core_tables.sql
//   20261005120100_save_active_client_weight_canonical.sql
// It replays the full repository migration chain into a throwaway local
// Supabase stack, runs the SQL contract matrix, then exercises the RPC through
// PostgREST exactly as the Web client calls it. Nothing touches a remote DB.

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';
import { addCurrentIsolatedMigrations } from './addCurrentIsolatedMigrations.mjs';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-RealtimeWeight-5m!';
const projectId = `dietbridge-rtweight-${process.pid}-${randomUUID().slice(0, 8)}`;
const realtimeMigrationName = '20261005120000_realtime_publication_core_tables.sql';
const weightMigrationName = '20261005120100_save_active_client_weight_canonical.sql';
const sqlContractPath = join(repoRoot, 'supabase', 'tests', 'realtime_weight_contract.sql');
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const measurementNumericKeys = [
  'weight', 'waist', 'hip', 'arm', 'right_arm', 'left_arm', 'chest', 'thigh', 'calf', 'right_calf', 'left_calf', 'neck',
];

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
  const email = `realtime-weight-${label}-${randomUUID()}@example.invalid`;
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

// Mirrors features/clients/services/clientService.ts isCanonicalMeasurementRow.
const isCanonicalMeasurementRow = (row, clientId, measuredAt) => Boolean(row)
  && typeof row === 'object'
  && !Array.isArray(row)
  && typeof row.id === 'string' && uuidPattern.test(row.id)
  && row.client_id === clientId
  && row.measured_at === measuredAt
  && (row.notes === null || typeof row.notes === 'string')
  && typeof row.created_at === 'string'
  && typeof row.updated_at === 'string'
  && measurementNumericKeys.every((key) => row[key] === null || (typeof row[key] === 'number' && Number.isFinite(row[key])));

const runRestFlows = async () => {
  const dietitianA = await createActor('dietitian-a', 'dietitian');
  const dietitianB = await createActor('dietitian-b', 'dietitian');
  const clientA = await createActor('client-a', 'client');
  await approveDietitian(dietitianA);
  await approveDietitian(dietitianB);
  await bootstrapDietitian(dietitianA);
  await bootstrapDietitian(dietitianB);
  await activateRelationship(dietitianA, clientA);

  const istanbulToday = runSql("select ((now() at time zone 'Europe/Istanbul')::date)::text");
  assert(/^\d{4}-\d{2}-\d{2}$/.test(istanbulToday), 'ISTANBUL_TODAY_RESOLVED', istanbulToday);

  const dietitianAApi = await signIn(dietitianA);
  const saved = assertNoError(await dietitianAApi.rpc('save_active_client_weight', {
    p_client_id: clientA.id,
    p_measured_at: istanbulToday,
    p_weight: 68.5,
    p_notes: 'REST harness',
  }), 'Active dietitian weight RPC');
  assert(isCanonicalMeasurementRow(saved, clientA.id, istanbulToday), 'REST_RPC_RETURNS_WEB_CANONICAL_ROW', JSON.stringify(saved));
  assert(saved.weight === 68.5 && saved.notes === 'REST harness', 'REST_RPC_PERSISTS_REQUESTED_WEIGHT_AND_NOTE');
  assert(runSql(`select (current_weight = 68.5)::text from public.client_profiles where user_id = '${clientA.id}'`) === 'true', 'REST_TODAY_UPDATES_CURRENT_WEIGHT');

  const dietitianBApi = await signIn(dietitianB);
  const foreign = await dietitianBApi.rpc('save_active_client_weight', {
    p_client_id: clientA.id, p_measured_at: istanbulToday, p_weight: 99, p_notes: null,
  });
  assert(Boolean(foreign.error) && foreign.error.code === '42501', 'REST_FOREIGN_DIETITIAN_DENIED', foreign.error?.code);

  const clientAApi = await signIn(clientA);
  const self = await clientAApi.rpc('save_active_client_weight', {
    p_client_id: clientA.id, p_measured_at: istanbulToday, p_weight: 99, p_notes: null,
  });
  assert(Boolean(self.error) && self.error.code === '42501', 'REST_CLIENT_SELF_CALL_DENIED', self.error?.code);

  const anonymous = await createAnonymousClient().rpc('save_active_client_weight', {
    p_client_id: clientA.id, p_measured_at: istanbulToday, p_weight: 99, p_notes: null,
  });
  assert(Boolean(anonymous.error), 'REST_ANON_DENIED', anonymous.error?.code);

  assert(runSql(`select count(*) from public.measurements where client_id = '${clientA.id}' and weight = 99`) === '0', 'REST_DENIED_CALLS_WROTE_NOTHING');
};

const run = async () => {
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  addCurrentIsolatedMigrations({ repoRoot, tempRoot: disposable.tempRoot });
  const migrationFiles = readdirSync(join(disposable.tempRoot, 'supabase', 'migrations'))
    .filter((name) => /^\d+_.+\.sql$/.test(name))
    .sort();
  assert(migrationFiles.includes(realtimeMigrationName), 'REALTIME_PUBLICATION_MIGRATION_MATERIALIZED');
  assert(migrationFiles.at(-1) === weightMigrationName, 'WEIGHT_RPC_MIGRATION_IS_DISPOSABLE_TAIL');
  assert(migrationFiles.length === 62, 'DISPOSABLE_MIGRATION_CHAIN_62');
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
  assert(runSql('select count(*) from supabase_migrations.schema_migrations') === '62', 'SCHEMA_MIGRATION_REPLAY_62');

  const sqlOutput = runSqlFile(sqlContractPath);
  process.stdout.write(sqlOutput.split(/\r?\n/).filter((line) => /^(?:PASS:|REALTIME_WEIGHT_CONTRACT_)/.test(line)).join('\n') + '\n');
  assert(sqlOutput.includes('REALTIME_WEIGHT_CONTRACT_PASS'), 'SQL_CONTRACT_MATRIX_PASS');

  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, clientOptions);
  await runRestFlows();
  pass('REALTIME_WEIGHT_RUNTIME_PASS');
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
  process.stderr.write(`[realtime-weight-runtime] ${mainError.message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('REALTIME_WEIGHT_RUNTIME_HARNESS_PASS\n');
}
