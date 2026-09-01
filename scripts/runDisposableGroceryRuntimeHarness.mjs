#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
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
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  LOCAL_PREREQUISITE_FILE,
  LOCAL_PREREQUISITE_SQL,
} from './runDisposableSupabaseLocalReplay.mjs';
import { materializeDisposableReplay } from './materializeDisposableSupabaseReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const supabaseVersion = '2.110.0';
const projectId = `dietbridge-grocery-${process.pid}-${randomUUID().slice(0, 8)}`;
const isolatedMigrations = [
  '20260814214101_notification_core_backend.sql',
  '20260817084531_appointment_reminders_backend.sql',
  '20260817120000_push_registry_outbox_backend.sql',
];
const npxCli = process.env.npm_execpath
  ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');

const cleanEnvironment = (environment) => Object.fromEntries(
  Object.entries(environment).filter(([key]) => !/^(?:SUPABASE|VITE_SUPABASE|EXPO_PUBLIC_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)),
);

const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close((error) => error ? reject(error) : resolvePort(address.port));
  });
});

const configureProject = async (configPath) => {
  const ports = await Promise.all(Array.from({ length: 8 }, freePort));
  const replacements = new Map([
    [54321, ports[0]],
    [54322, ports[1]],
    [54320, ports[2]],
    [54323, ports[3]],
    [54324, ports[4]],
    [54327, ports[5]],
    [54329, ports[6]],
    [8083, ports[7]],
  ]);
  const configured = readFileSync(configPath, 'utf8')
    .replace(/^project_id\s*=\s*"[^"]+"$/m, `project_id = "${projectId}"`)
    .replace(/^port\s*=\s*(\d+)$/gm, (line, value) => (
      replacements.has(Number(value)) ? `port = ${replacements.get(Number(value))}` : line
    ))
    .replace(/^shadow_port\s*=\s*54320$/m, `shadow_port = ${ports[2]}`);
  writeFileSync(configPath, configured, 'utf8');
};

const runCli = (tempRoot, args) => execFileSync(
  process.execPath,
  [npxCli, '--yes', `supabase@${supabaseVersion}`, '--workdir', tempRoot, ...args],
  {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...cleanEnvironment(process.env), TZ: 'Europe/Istanbul' },
    timeout: 15 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
  },
);

const runPsqlFile = (tempRoot, relativePath) => execFileSync(
  'docker',
  [
    'exec',
    '-i',
    `supabase_db_${projectId}`,
    'psql',
    '-U', 'postgres',
    '-d', 'postgres',
    '-X',
    '-v', 'ON_ERROR_STOP=1',
    '-f', '-',
  ],
  {
    cwd: repoRoot,
    input: readFileSync(join(tempRoot, relativePath)),
    encoding: 'utf8',
    env: cleanEnvironment(process.env),
    timeout: 5 * 60 * 1000,
    maxBuffer: 32 * 1024 * 1024,
  },
);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
  process.stdout.write(`PASS: ${message}\n`);
};

let tempParent;
let tempRoot;
let stackStarted = false;
let mainError = null;

try {
  tempParent = mkdtempSync(join(resolve(tmpdir()), 'dietbridge-grocery-runtime-'));
  tempRoot = join(tempParent, 'project');
  const manifest = materializeDisposableReplay({ repoRoot, outputRoot: tempRoot });
  const configPath = join(tempRoot, 'supabase', 'config.toml');
  copyFileSync(join(repoRoot, 'supabase', 'config.toml'), configPath);
  const testDirectory = join(tempRoot, 'supabase', 'tests');
  mkdirSync(testDirectory, { recursive: true });
  copyFileSync(
    join(repoRoot, 'supabase', 'tests', 'grocery_items_contract.sql'),
    join(testDirectory, 'grocery_items_contract.sql'),
  );
  const localPrerequisitePath = join(tempRoot, 'supabase', 'migrations', LOCAL_PREREQUISITE_FILE);
  writeFileSync(localPrerequisitePath, LOCAL_PREREQUISITE_SQL, { flag: 'wx' });
  for (const migrationName of isolatedMigrations) {
    copyFileSync(
      join(repoRoot, 'supabase', 'migrations', migrationName),
      join(tempRoot, 'supabase', 'migrations', migrationName),
      1,
    );
  }

  const migrationFiles = readdirSync(join(tempRoot, 'supabase', 'migrations'))
    .filter((name) => /^\d+_.+\.sql$/.test(name));
  assert(manifest.expectedHistory.total === 53, 'GROCERY_REPLAY_CANONICAL_53');
  assert(migrationFiles.length === 57, 'GROCERY_REPLAY_WITH_ISOLATED_MIGRATIONS_57');
  await configureProject(configPath);

  runCli(tempRoot, ['start']);
  stackStarted = true;
  process.stdout.write(`PASS: GROCERY_DISPOSABLE_STACK_STARTED ${projectId}\n`);
  runCli(tempRoot, ['db', 'reset', '--local', '--no-seed']);
  process.stdout.write('PASS: GROCERY_DISPOSABLE_MIGRATIONS_APPLIED_LOCAL_ONLY\n');
  runPsqlFile(tempRoot, 'supabase/tests/grocery_items_contract.sql');
  process.stdout.write('PASS: GROCERY_RLS_RUNTIME_MATRIX\n');
} catch (error) {
  mainError = error;
} finally {
  if (stackStarted && tempRoot) {
    try {
      runCli(tempRoot, ['stop', '--no-backup']);
      process.stdout.write(`PASS: GROCERY_DISPOSABLE_STACK_STOPPED ${projectId}\n`);
    } catch (error) {
      mainError = mainError
        ? new Error(`${mainError.message}; local stack stop failed: ${error.message}`)
        : error;
    }
  }
  if (tempParent) {
    try {
      rmSync(tempParent, { recursive: true, force: true });
      assert(!existsSync(tempParent), 'GROCERY_DISPOSABLE_TEMP_RESIDUE_ZERO');
    } catch (error) {
      mainError = mainError
        ? new Error(`${mainError.message}; temp cleanup failed: ${error.message}`)
        : error;
    }
  }
}

if (mainError) throw mainError;
