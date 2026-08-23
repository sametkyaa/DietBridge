/**
 * Focused Notification Center UI contract runner.
 *
 * The repository intentionally has no browser-test dependency. Compile the
 * pure notification presentation helpers with the repository TypeScript
 * compiler, run deterministic formatter/deep-link/visibility tests, then run
 * source-level UI boundary assertions against the actual React components.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = mkdtempSync(join(tmpdir(), 'dietbridge-notification-ui-'));
const sources = [
  'features/notifications/types/notification.ts',
  'features/notifications/utils/notificationFormatter.ts',
  'features/notifications/utils/notificationNavigation.ts',
  'features/notifications/utils/notificationVisibility.ts',
  'shared/utils/uuid.ts',
];
const expectedOutputs = [
  'features/notifications/utils/notificationFormatter.js',
  'features/notifications/utils/notificationNavigation.js',
  'features/notifications/utils/notificationVisibility.js',
];

const fail = (message) => {
  console.error(`[notification-ui-contract-tests] ${message}`);
  rmSync(buildDir, { recursive: true, force: true });
  process.exit(1);
};

const tscCli = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tscCli)) fail('TypeScript compiler not found. Run `npm ci` first.');

const compile = spawnSync(process.execPath, [
  tscCli,
  ...sources,
  '--module', 'commonjs',
  '--target', 'es2022',
  '--lib', 'es2022,dom',
  '--skipLibCheck',
  '--noResolve',
  '--outDir', buildDir,
], { cwd: repoRoot, encoding: 'utf8' });

const diagnostics = `${compile.stdout ?? ''}${compile.stderr ?? ''}`
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean);
const unexpected = diagnostics.filter((line) => !line.includes('error TS2307'));
if (unexpected.length > 0) fail(`Unexpected TypeScript diagnostics:\n${unexpected.join('\n')}`);

for (const output of expectedOutputs) {
  if (!existsSync(join(buildDir, output))) fail(`Compiled output is missing: ${output}`);
}

const test = spawnSync(process.execPath, ['--test', join(repoRoot, 'tests', 'notificationUiContracts.test.cjs')], {
  cwd: repoRoot,
  env: { ...process.env, NOTIFICATION_UI_CONTRACT_BUILD_DIR: buildDir },
  encoding: 'utf8',
  stdio: 'inherit',
});

rmSync(buildDir, { recursive: true, force: true });
process.exit(test.status ?? 1);
