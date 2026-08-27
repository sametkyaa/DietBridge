#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const commands = [
  ['scripts/runMealPlanContractTests.mjs'],
  ['scripts/runClientMetricsContractTests.mjs'],
  ['--test', 'tests/ciSafetyGuard.test.cjs'],
  ['--test', 'tests/registerTermsLinkContracts.test.cjs'],
  ['--test', 'tests/registrationReliabilityContracts.test.cjs'],
  ['scripts/runRegistrationReliabilityRuntimeTests.mjs'],
  ['--test', 'tests/productAdminContracts.test.cjs'],
  ['scripts/runNotificationCoreContractTests.mjs'],
  ['scripts/runNotificationClientContractTests.mjs'],
  ['scripts/runNotificationUiContractTests.mjs'],
  ['scripts/runPushRegistryContractTests.mjs'],
];

assertCiSafeEnvironment();

for (const args of commands) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env: { ...process.env, TZ: 'Europe/Istanbul' },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

process.stdout.write('WEB_CONTRACT_TEST_GATE_PASS\n');
