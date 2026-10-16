// Disposable local-only runtime check for the dietitian directory migration.
// Replays the canonical chain plus the invite and directory migrations on a
// throwaway Supabase stack, applies the directory migration twice and runs the
// SQL contract matrix. It never reads or writes a remote project.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFileSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';
import { addCurrentIsolatedMigrations } from './addCurrentIsolatedMigrations.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = [
  '20261005120859_dietitian_invite_codes.sql',
  '20261013121103_short_dietitian_invite_codes.sql',
  '20261016130000_dietitian_directory_inquiries.sql',
];
const directoryMigration = migrations.at(-1);
const contract = 'supabase/tests/dietitian_directory_contract.sql';
const projectId = `dietbridge-directory-${process.pid}-${randomUUID().slice(0, 8)}`;
const npxCli = process.env.npm_execpath ? join(dirname(process.env.npm_execpath), 'npx-cli.js') : join(dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');
const environment = Object.fromEntries(Object.entries(process.env).filter(([name]) => !/^(SUPABASE|VITE_SUPABASE|DATABASE_URL|POSTGRES_|PG)/.test(name)));
let disposable; let attemptedStart = false; let failure; let checks = 0;
const pass = (name) => { checks++; process.stdout.write(`PASS ${name}\n`); };
const cli = (args) => execFileSync(process.execPath, [npxCli, '--yes', 'supabase@2.110.0', '--workdir', disposable.tempRoot, ...args], {
  env: environment, cwd: repoRoot, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout: 600000, windowsHide: true,
});
const psql = (input) => execFileSync('docker', ['exec', '-i', `supabase_db_${projectId}`, 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
});
const freePort = () => new Promise((resolvePort, reject) => {
  const server = createServer(); server.on('error', reject); server.listen(0, '127.0.0.1', () => {
    const port = server.address().port; server.close((error) => (error ? reject(error) : resolvePort(port)));
  });
});
try {
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  addCurrentIsolatedMigrations({ repoRoot, tempRoot: disposable.tempRoot });
  for (const name of migrations) copyFileSync(join(repoRoot, 'supabase/migrations', name), join(disposable.tempRoot, 'supabase/migrations', name));
  const ports = await Promise.all(Array.from({ length: 8 }, freePort));
  let config = readFileSync(disposable.configPath, 'utf8').replace(/^project_id\s*=.*$/m, `project_id = "${projectId}"`);
  [54321, 54322, 54320, 54329, 54323, 54324, 54327, 8083].forEach((port, index) => { config = config.replace(new RegExp(`\\b${port}\\b`, 'g'), String(ports[index])); });
  writeFileSync(disposable.configPath, config);
  attemptedStart = true;
  cli(['start', '--exclude', 'studio,imgproxy,mailpit,logflare,vector,supavisor,edge-runtime']);
  pass('clean canonical migration apply with directory migration');
  psql(readFileSync(join(repoRoot, 'supabase/migrations', directoryMigration)));
  pass('repeat apply is idempotent');
  const output = psql(readFileSync(join(repoRoot, contract)));
  assert.match(output, /DIETITIAN_DIRECTORY_CONTRACT_PASS/);
  pass('DIETITIAN_DIRECTORY_RUNTIME_MATRIX');
} catch (error) { failure = error; } finally {
  if (disposable?.tempRoot) {
    try {
      if (attemptedStart) cli(['stop', '--project-id', projectId, '--no-backup']);
      const parent = resolve(dirname(disposable.tempRoot)); const systemTemp = resolve(tmpdir());
      assert.ok(parent.startsWith(systemTemp + sep) && parent !== systemTemp && !repoRoot.startsWith(parent + sep));
      rmSync(parent, { recursive: true, force: true }); assert.equal(existsSync(parent), false);
      assert.equal(execFileSync('docker', ['ps', '-a', '--filter', `name=${projectId}`, '--format', '{{.ID}}'], { encoding: 'utf8' }).trim(), '');
      pass('disposable container and temp residue zero');
    } catch (error) { failure ??= error; }
  }
}
if (failure) { process.stderr.write(`${failure.stack}\n`); process.exitCode = 1; } else process.stdout.write(`DIETITIAN_DIRECTORY_RUNTIME_PASS checks=${checks}\n`);
