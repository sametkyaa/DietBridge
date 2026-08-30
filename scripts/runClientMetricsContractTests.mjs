#!/usr/bin/env node

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = mkdtempSync(join(tmpdir(), 'dietbridge-client-metrics-'));
const sources = [
  'shared/utils/uuid.ts',
  'shared/utils/dateContract.ts',
  'shared/utils/adherenceContract.ts',
  'shared/utils/percentageDisplay.ts',
  'shared/types.ts',
  'features/clients/utils/measurementContract.ts',
  'features/clients/utils/clientMetricsContract.ts',
  'features/clients/utils/clientExport.ts',
  'features/clients/services/clientExportService.ts',
  'features/chat/types/chatImage.ts',
  'features/chat/types/chat.ts',
  'features/chat/utils/messageDeepLink.ts',
];
const expectedOutputs = [
  'shared/utils/uuid.js',
  'shared/utils/dateContract.js',
  'shared/utils/adherenceContract.js',
  'shared/utils/percentageDisplay.js',
  'features/clients/utils/measurementContract.js',
  'features/clients/utils/clientMetricsContract.js',
  'features/clients/utils/clientExport.js',
  'features/clients/services/clientExportService.js',
  'features/chat/utils/messageDeepLink.js',
];

const fail = (message) => {
  console.error(`[client-metrics-contract-tests] ${message}`);
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

const testFile = join(repoRoot, 'tests', 'clientMetricsContracts.test.cjs');
const testRun = spawnSync(process.execPath, ['--test', testFile], {
  cwd: repoRoot,
  env: { ...process.env, CLIENT_METRICS_CONTRACT_BUILD_DIR: buildDir },
  stdio: 'inherit',
});

rmSync(buildDir, { recursive: true, force: true });
process.exit(testRun.status ?? 1);
