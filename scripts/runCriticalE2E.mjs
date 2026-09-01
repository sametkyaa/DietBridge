#!/usr/bin/env node

import { execFileSync, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supabaseVersion = '2.110.0';
const password = 'Disposable-E2E-Only-11m!';
const diplomaBucket = 'dietitian-diplomas';
const isolatedMigrations = [
  '20260814214101_notification_core_backend.sql',
  '20260817084531_appointment_reminders_backend.sql',
  '20260817120000_push_registry_outbox_backend.sql',
  '20260901165402_client_account_deletion_backend.sql',
  '20260901193000_client_account_deletion_hardening.sql',
];
const actorIds = [];
const relationshipIds = [];
const diplomaPaths = [];
let disposable;
let local;
let admin;
let appProcess;
let stackStarted = false;
let mainError;

const pass = (label, detail = '') => process.stdout.write(`PASS: ${label}${detail ? ` ${detail}` : ''}\n`);
const assert = (condition, label) => { if (!condition) throw new Error(label); pass(label); };
const assertNoError = (result, label) => {
  if (result?.error) throw new Error(`${label}: ${result.error.message}`);
  return result?.data;
};
const ensureDiplomaBucket = async () => {
  const current = await admin.storage.getBucket(diplomaBucket);
  if (current.error && current.error.status !== 404) {
    throw new Error(`dietitian diploma bucket lookup failed: ${current.error.message}`);
  }
  if (current.error?.status === 404 || !current.data) {
    assertNoError(await admin.storage.createBucket(diplomaBucket, {
      public: false,
      fileSizeLimit: 10485760,
      allowedMimeTypes: ['application/pdf'],
    }), 'dietitian diploma bucket fixture');
  }
  const verified = assertNoError(await admin.storage.getBucket(diplomaBucket), 'dietitian diploma bucket contract lookup');
  assert(verified.name === diplomaBucket
    && verified.public === false
    && verified.file_size_limit === 10485760
    && Array.isArray(verified.allowed_mime_types)
    && verified.allowed_mime_types.length === 1
    && verified.allowed_mime_types[0] === 'application/pdf', 'E2E_DIPLOMA_BUCKET_PRIVATE_PDF_10_MIB');
};
const redact = (value) => String(value)
  .replace(/\b(sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)\b/g, '[redacted]');

const npxCli = process.env.npm_execpath
  ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');

const cleanEnvironment = (environment) => Object.fromEntries(Object.entries(environment).filter(([key]) => !(
  /^(?:SUPABASE|VITE_SUPABASE|EXPO_PUBLIC_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)
)));

const cli = (args) => {
  try {
    return execFileSync(process.execPath, [npxCli, '--yes', `supabase@${supabaseVersion}`, '--workdir', disposable.tempRoot, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...cleanEnvironment(process.env), TZ: 'Europe/Istanbul' },
      timeout: 15 * 60 * 1000,
      maxBuffer: 32 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(`Supabase ${args.join(' ')} failed: ${redact(error.message)}\n${redact(error.stderr ?? '')}`);
  }
};

const parseStatus = (value) => Object.fromEntries(value.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
  .filter(Boolean)
  .map((match) => [match[1], match[2]]));

const freePort = () => new Promise((resolvePort, rejectPort) => {
  const server = createServer();
  server.once('error', rejectPort);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close((error) => error ? rejectPort(error) : resolvePort(address.port));
  });
});

const configurePorts = async (configPath) => {
  const ports = await Promise.all(Array.from({ length: 8 }, freePort));
  const replacements = new Map([[54321, ports[0]], [54322, ports[1]], [54320, ports[2]], [54329, ports[3]], [54323, ports[4]], [54324, ports[5]], [54327, ports[6]], [8083, ports[7]]]);
  const config = readFileSync(configPath, 'utf8')
    .replace(/^project_id\s*=\s*"[^"]+"$/m, `project_id = "dietbridge-e2e-${process.pid}-${randomUUID().slice(0, 8)}"`)
    .replace(/^port\s*=\s*(\d+)$/gm, (line, value) => replacements.has(Number(value)) ? `port = ${replacements.get(Number(value))}` : line)
    .replace(/^shadow_port\s*=\s*54320$/m, `shadow_port = ${ports[2]}`);
  writeFileSync(configPath, config, 'utf8');
};

const waitForHttp = async (url, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  throw new Error(`Timed out waiting for local Web app: ${url}`);
};

const createActor = async (label, role) => {
  const email = `mvp11-${label}-${randomUUID()}@example.invalid`;
  const created = assertNoError(await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { account_type: role, role, full_name: `Disposable ${label}`, mvp11_e2e: true },
  }), `${label} Auth fixture`);
  actorIds.push(created.user.id);
  return { id: created.user.id, email, label, role };
};

const setDietitianStatus = async (actor, status) => {
  assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: status,
    is_verified: status === 'approved',
    verified_at: status === 'approved' ? '2026-08-23T08:00:00.000Z' : null,
    rejection_reason: status === 'rejected' ? 'Disposable E2E rejection' : null,
  }).eq('user_id', actor.id).select('user_id').single(), `${actor.label} status`);
};

const makeCompletePending = async (actor) => {
  const diplomaPath = `diplomas/${actor.id}/diploma.pdf`;
  assertNoError(await admin.storage.from(diplomaBucket).upload(
    diplomaPath,
    Buffer.from('%PDF-1.4 disposable critical access diploma'),
    { contentType: 'application/pdf', upsert: false },
  ), `${actor.label} diploma fixture`);
  diplomaPaths.push(diplomaPath);

  assertNoError(await admin.from('profiles').update({
    full_name: `Disposable ${actor.label}`,
    email: actor.email,
  }).eq('id', actor.id).select('id').single(), `${actor.label} base profile fixture`);
  assertNoError(await admin.from('dietitian_profiles').update({
    phone: '+905551234567',
    university: 'Disposable Üniversitesi',
    graduation_year: 2018,
    experience_years: 4,
    specialization: 'Klinik beslenme',
    bio: 'Disposable critical access başvurusu.',
    diploma_url: diplomaPath,
  }).eq('user_id', actor.id).select('user_id').single(), `${actor.label} onboarding fixture`);
};

const cleanupFixtures = async () => {
  if (!admin) return;
  if (relationshipIds.length) assertNoError(await admin.from('dietitian_clients').delete().in('id', relationshipIds), 'relationship cleanup');
  if (actorIds.length) assertNoError(await admin.from('dietitian_subscriptions').delete().in('dietitian_id', actorIds), 'subscription cleanup');
  if (diplomaPaths.length) assertNoError(await admin.storage.from(diplomaBucket).remove(diplomaPaths), 'diploma cleanup');
  for (const id of [...actorIds].reverse()) assertNoError(await admin.auth.admin.deleteUser(id), 'Auth cleanup');
  const residue = await admin.from('profiles').select('id', { count: 'exact', head: true }).in('id', actorIds);
  assertNoError(residue, 'profile residue query');
  assert(residue.count === 0, 'E2E_FIXTURE_RESIDUE_ZERO');
};

try {
  assertCiSafeEnvironment();
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  const migrationDirectory = join(disposable.tempRoot, 'supabase', 'migrations');
  for (const migration of isolatedMigrations) copyFileSync(join(repoRoot, 'supabase', 'migrations', migration), join(migrationDirectory, migration), 1);
  assert(readdirSync(migrationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).length === 59, 'E2E_DISPOSABLE_MIGRATION_COUNT_59');
  await configurePorts(disposable.configPath);
  cli(['start']);
  stackStarted = true;
  cli(['db', 'reset', '--local', '--no-seed']);
  local = parseStatus(cli(['status', '--output', 'env']));
  assertCiSafeEnvironment({ SUPABASE_URL: local.API_URL }, { requireLoopback: true });
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  await ensureDiplomaBucket();
  pass('E2E_DIPLOMA_BUCKET_READY');

  const client = await createActor('client-role', 'client');
  const pending = await createActor('pending-dietitian', 'dietitian');
  const rejected = await createActor('rejected-dietitian', 'dietitian');
  const approved = await createActor('approved-dietitian', 'dietitian');
  const linkedClient = await createActor('linked-client', 'client');
  await makeCompletePending(pending);
  await makeCompletePending(rejected);
  await setDietitianStatus(pending, 'pending');
  await setDietitianStatus(rejected, 'rejected');
  await setDietitianStatus(approved, 'approved');
  assertNoError(await admin.from('dietitian_subscriptions').upsert({ dietitian_id: approved.id, plan_id: 'core', status: 'active' }), 'approved subscription');
  const relation = assertNoError(await admin.from('dietitian_clients').insert({ dietitian_id: approved.id, client_id: linkedClient.id, status: 'pending' }).select('id').single(), 'linked client relation');
  relationshipIds.push(relation.id);
  assertNoError(await admin.from('dietitian_clients').update({ status: 'active', accepted_at: '2026-08-23T08:00:00.000Z' }).eq('id', relation.id).select('id').single(), 'activate linked client');

  const appPort = await freePort();
  const baseUrl = `http://127.0.0.1:${appPort}`;
  appProcess = spawn(process.execPath, [join(repoRoot, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(appPort)], {
    cwd: repoRoot,
    env: { ...cleanEnvironment(process.env), VITE_SUPABASE_URL: local.API_URL, VITE_SUPABASE_ANON_KEY: local.ANON_KEY, TZ: 'Europe/Istanbul' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHttp(baseUrl);

  const e2e = spawn(process.execPath, [join(repoRoot, 'node_modules', '@playwright', 'test', 'cli.js'), 'test'], {
    cwd: repoRoot,
    env: {
      ...cleanEnvironment(process.env),
      CI: process.env.CI ?? '',
      E2E_BASE_URL: baseUrl,
      E2E_PASSWORD: password,
      E2E_CLIENT_EMAIL: client.email,
      E2E_PENDING_EMAIL: pending.email,
      E2E_REJECTED_EMAIL: rejected.email,
      E2E_APPROVED_EMAIL: approved.email,
      E2E_LINKED_CLIENT_NAME: 'Disposable linked-client',
      TZ: 'Europe/Istanbul',
    },
    stdio: 'inherit',
  });
  const code = await new Promise((resolveCode, rejectCode) => {
    e2e.once('error', rejectCode);
    e2e.once('close', (value) => resolveCode(value ?? 1));
  });
  if (code !== 0) throw new Error(`Playwright exited with ${code}.`);
  pass('CRITICAL_BROWSER_E2E_PASS');
} catch (error) {
  mainError = error;
} finally {
  if (appProcess && !appProcess.killed) appProcess.kill();
  try { await cleanupFixtures(); } catch (error) { mainError = mainError ? new Error(`${mainError.message}; cleanup failed: ${error.message}`) : error; }
  if (stackStarted) {
    try { cli(['stop', '--no-backup']); pass('E2E_DISPOSABLE_STACK_STOPPED'); } catch (error) { mainError = mainError ? new Error(`${mainError.message}; stack stop failed: ${error.message}`) : error; }
  }
  if (disposable?.tempRoot) {
    const tempParent = dirname(disposable.tempRoot);
    try { rmSync(tempParent, { recursive: true, force: true }); assert(!existsSync(tempParent), 'E2E_TEMP_RESIDUE_ZERO'); } catch (error) { mainError = mainError ? new Error(`${mainError.message}; temp cleanup failed: ${error.message}`) : error; }
  }
}

if (mainError) throw mainError;
