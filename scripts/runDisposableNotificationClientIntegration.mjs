#!/usr/bin/env node

import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { materializeDisposableReplay } from './materializeDisposableSupabaseReplay.mjs';
import { LOCAL_PREREQUISITE_FILE, LOCAL_PREREQUISITE_SQL } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = join(repoRoot, 'supabase', 'migrations');
const notificationCoreMigrationName = '20260814214101_notification_core_backend.sql';
const markAllReadMigrationName = '20260816101405_mark_all_notifications_read.sql';
const appointmentReminderMigrationName = '20260817084531_appointment_reminders_backend.sql';
const supabaseVersion = '2.110.0';
const projectId = `db-notify-${process.pid}-${randomUUID().slice(0, 6)}`;
const password = 'Disposable-Notification-Client-4m!';
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const actorIds = [];
let tempParent;
let tempRoot;
let local;
let admin;
let stackStartAttempted = false;
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
const cleanEnvironment = (environment) => Object.fromEntries(
  Object.entries(environment).filter(([key]) => !/^(?:SUPABASE|VITE_SUPABASE|EXPO_PUBLIC_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)),
);
const runCli = (tempRoot, args) => {
  try {
    return execFileSync(process.execPath, [npxCli, '--yes', `supabase@${supabaseVersion}`, '--workdir', tempRoot, ...args], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...cleanEnvironment(process.env), TZ: 'Europe/Istanbul' },
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
  } catch (error) {
    throw new Error(`Supabase ${args.join(' ')} failed: ${redact(error.message)}\n${redact(String(error.stdout ?? '').slice(-6000))}\n${redact(String(error.stderr ?? '').slice(-6000))}`);
  }
};
const parseStatus = (value) => Object.fromEntries(
  value.split(/\r?\n/).map((line) => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map((match) => [match[1], match[2]]),
);
const isPortFree = (port) => new Promise((resolvePromise) => {
  const server = createServer();
  server.once('error', () => resolvePromise(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)));
});
const choosePortBase = async () => {
  const first = 56000 + (process.pid % 500);
  for (let offset = 0; offset < 5000; offset += 20) {
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
const compileClient = (outputRoot) => {
  const tscCli = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  const compile = spawnSync(process.execPath, [
    tscCli,
    'features/notifications/types/notification.ts',
    'features/notifications/services/notificationService.ts',
    'shared/utils/uuid.ts',
    '--module', 'commonjs',
    '--target', 'es2022',
    '--lib', 'es2022,dom',
    '--skipLibCheck',
    '--noResolve',
    '--outDir', outputRoot,
  ], { cwd: repoRoot, encoding: 'utf8' });
  const diagnostics = `${compile.stdout ?? ''}${compile.stderr ?? ''}`
    .split(/\r?\n/).map((line) => line.trim()).filter(Boolean).filter((line) => !line.includes('error TS2307'));
  if (diagnostics.length > 0) throw new Error(`Notification client compile failed:\n${diagnostics.join('\n')}`);

  const libRoot = join(outputRoot, 'lib');
  mkdirSync(libRoot, { recursive: true });
  const supabasePackage = join(repoRoot, 'node_modules', '@supabase', 'supabase-js');
  writeFileSync(join(libRoot, 'supabaseClient.js'), `'use strict';\nconst { createClient } = require(${JSON.stringify(supabasePackage)});\nexports.supabase = createClient(process.env.DIETBRIDGE_LOCAL_URL, process.env.DIETBRIDGE_LOCAL_ANON_KEY, { global: { headers: { Authorization: 'Bearer ' + process.env.DIETBRIDGE_LOCAL_ACCESS_TOKEN } }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });\n`, 'utf8');
};

const run = async () => {
  const sourceMigrations = readdirSync(migrationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  assert(sourceMigrations.includes(appointmentReminderMigrationName), 'CLIENT_RUNTIME_REMINDER_MIGRATION_PRESENT');
  assert(sourceMigrations.at(-1) === '20260901193000_client_account_deletion_hardening.sql', 'CLIENT_RUNTIME_NOTIFICATION_MIGRATION_TAIL');

  tempParent = mkdtempSync(join(tmpdir(), 'dietbridge-notification-client-runtime-'));
  tempRoot = join(tempParent, 'project');
  const clientBuild = join(tempParent, 'client-build');
  try {
    const manifest = materializeDisposableReplay({ repoRoot, outputRoot: tempRoot });
    const configPath = join(tempRoot, 'supabase', 'config.toml');
    copyFileSync(join(repoRoot, 'supabase', 'config.toml'), configPath);
    const runtimeMigrationDirectory = join(tempRoot, 'supabase', 'migrations');
    copyFileSync(join(migrationDirectory, notificationCoreMigrationName), join(runtimeMigrationDirectory, notificationCoreMigrationName));
    copyFileSync(join(migrationDirectory, appointmentReminderMigrationName), join(runtimeMigrationDirectory, appointmentReminderMigrationName));
    writeFileSync(join(runtimeMigrationDirectory, LOCAL_PREREQUISITE_FILE), LOCAL_PREREQUISITE_SQL, { flag: 'wx' });
    assert(manifest.expectedHistory.total === 53, 'CLIENT_RUNTIME_BASELINE_53');
    await configureProject(configPath);
    stackStartAttempted = true;
    runCli(tempRoot, ['start']);
    runCli(tempRoot, ['db', 'reset', '--local', '--no-seed']);
    local = parseStatus(runCli(tempRoot, ['status', '--output', 'env']));
    assert(new URL(local.API_URL).hostname === '127.0.0.1', 'CLIENT_RUNTIME_LOOPBACK_ONLY');
    admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

    const actor = assertNoError(await admin.auth.admin.createUser({
      email: `notification-client-${randomUUID()}@example.invalid`,
      password,
      email_confirm: true,
      user_metadata: { account_type: 'dietitian', role: 'dietitian', full_name: 'Disposable Notification Client' },
    }), 'CLIENT_RUNTIME_AUTH_CREATE');
    actorIds.push(actor.user.id);
    const profile = assertNoError(await admin.from('profiles').select('id').eq('id', actor.user.id).maybeSingle(), 'CLIENT_RUNTIME_PROFILE');
    assert(profile?.id === actor.user.id, 'CLIENT_RUNTIME_PROFILE_PRESENT');

    const firstId = randomUUID();
    const secondId = randomUUID();
    const conversationId = randomUUID();
    const common = {
      recipient_id: actor.user.id,
      category: 'chat_message',
      event_type: 'new_message',
      actor_id: actor.user.id,
      actor_display_name: 'Disposable Notification Client',
      conversation_id: conversationId,
      summary_key: 'chat_new_message',
      event_count: 1,
      occurred_at: '2026-08-15T10:00:00.000Z',
      created_at: '2026-08-15T10:00:00.000Z',
      updated_at: '2026-08-15T10:00:00.000Z',
    };
    assertNoError(await admin.from('notifications').insert([
      { ...common, id: firstId, aggregation_key: `client-smoke:${firstId}` },
      { ...common, id: secondId, aggregation_key: `client-smoke:${secondId}` },
    ]), 'CLIENT_RUNTIME_NOTIFICATION_INSERT');

    process.env.DIETBRIDGE_LOCAL_URL = local.API_URL;
    process.env.DIETBRIDGE_LOCAL_ANON_KEY = local.ANON_KEY;
    const signIn = assertNoError(await createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } }).auth.signInWithPassword({ email: actor.user.email, password }), 'CLIENT_RUNTIME_SIGN_IN');
    process.env.DIETBRIDGE_LOCAL_ACCESS_TOKEN = signIn.session.access_token;
    compileClient(clientBuild);
    const clientService = await import(pathToFileURL(join(clientBuild, 'features', 'notifications', 'services', 'notificationService.js')).href);

    const pageOne = await clientService.listNotifications({ pageSize: 1 });
    assert(pageOne.notifications.length === 1 && pageOne.hasMore, 'CLIENT_RUNTIME_PAGE_ONE');
    const pageTwo = await clientService.listNotifications({ pageSize: 1, cursor: pageOne.nextCursor });
    assert(pageTwo.notifications.length === 1 && pageTwo.notifications[0].id !== pageOne.notifications[0].id, 'CLIENT_RUNTIME_KEYSET_EQUAL_TIMESTAMP');
    assert(await clientService.getNotificationUnseenCount() === 2, 'CLIENT_RUNTIME_UNSEEN_COUNT');
    const seen = await clientService.markNotificationSeen(pageOne.notifications[0].id);
    assert(seen.seenAt !== null && seen.readAt === null, 'CLIENT_RUNTIME_MARK_SEEN');
    const read = await clientService.markNotificationRead(pageTwo.notifications[0].id);
    assert(read.seenAt !== null && read.readAt !== null, 'CLIENT_RUNTIME_MARK_READ');
    assert(await clientService.markNotificationsSeen([pageOne.notifications[0].id]) === 1, 'CLIENT_RUNTIME_BATCH_SEEN');
    const unread = await clientService.listNotifications({ unreadOnly: true });
    assert(unread.notifications.length === 1 && unread.notifications[0].id === pageOne.notifications[0].id, 'CLIENT_RUNTIME_UNREAD_FILTER');
    await clientService.markNotificationRead(pageOne.notifications[0].id);
    assert((await clientService.listNotifications({ unreadOnly: true })).notifications.length === 0, 'CLIENT_RUNTIME_UNREAD_EMPTY_AFTER_READ');
    const markAllFirstId = randomUUID();
    const markAllSecondId = randomUUID();
    assertNoError(await admin.from('notifications').insert([
      { ...common, id: markAllFirstId, aggregation_key: `client-mark-all:${markAllFirstId}` },
      { ...common, id: markAllSecondId, aggregation_key: `client-mark-all:${markAllSecondId}` },
    ]), 'CLIENT_RUNTIME_MARK_ALL_FIXTURE');
    assert(await clientService.getNotificationUnseenCount() === 2, 'CLIENT_RUNTIME_MARK_ALL_UNSEEN_BEFORE');
    assert(await clientService.markAllNotificationsRead() === 2, 'CLIENT_RUNTIME_MARK_ALL_AFFECTED_COUNT');
    const markedAllRows = assertNoError(await admin.from('notifications')
      .select('id,seen_at,read_at').in('id', [markAllFirstId, markAllSecondId]), 'CLIENT_RUNTIME_MARK_ALL_CANONICAL_READ');
    assert(markedAllRows.length === 2 && markedAllRows.every((row) => row.seen_at !== null && row.read_at !== null), 'CLIENT_RUNTIME_MARK_ALL_RECONCILED');
    assert(await clientService.markAllNotificationsRead() === 0, 'CLIENT_RUNTIME_MARK_ALL_EMPTY');
    pass('NOTIFICATION_CLIENT_DISPOSABLE_INTEGRATION_PASS');
  } finally {
    try {
      if (admin && actorIds.length) {
        await admin.from('notifications').delete().in('recipient_id', actorIds);
        for (const actorId of [...actorIds].reverse()) await admin.auth.admin.deleteUser(actorId);
      }
    } catch (error) {
      if (mainError) mainError.message += `; fixture cleanup failed: ${redact(error.message)}`;
      else mainError = error;
    }
    if (tempRoot && stackStartAttempted) {
      try {
        runCli(tempRoot, ['stop', '--project-id', projectId, '--no-backup']);
        pass('CLIENT_RUNTIME_LOCAL_STACK_STOPPED');
      } catch (error) {
        if (mainError) mainError.message += `; stack stop failed: ${redact(error.message)}`;
        else mainError = error;
      }
    }
    if (tempParent) {
      rmSync(tempParent, { recursive: true, force: true });
      assert(!existsSync(tempParent), 'CLIENT_RUNTIME_TEMP_RESIDUE_ZERO');
    }
    try {
      const residual = execFileSync('docker', ['ps', '-a', '--filter', `name=^supabase_.*_${projectId}$`, '--format', '{{.ID}}'], { encoding: 'utf8' }).trim();
      assert(residual === '', 'CLIENT_RUNTIME_DOCKER_RESIDUE_ZERO');
    } catch (error) {
      if (mainError) mainError.message += `; Docker residue check failed: ${redact(error.message)}`;
      else mainError = error;
    }
    delete process.env.DIETBRIDGE_LOCAL_URL;
    delete process.env.DIETBRIDGE_LOCAL_ANON_KEY;
    delete process.env.DIETBRIDGE_LOCAL_ACCESS_TOKEN;
  }
};

try {
  await run();
} catch (error) {
  mainError = error;
}

if (mainError) throw mainError;
