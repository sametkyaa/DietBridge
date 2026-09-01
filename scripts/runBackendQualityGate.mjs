#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const harnesses = [
  'scripts/runDisposableNotificationCoreRuntimeHarness.mjs',
  'scripts/runDisposableAppointmentRuntimeHarness.mjs',
  'scripts/runDisposableMealVisibilityRuntimeHarness.mjs',
  'scripts/runDisposableSubscriptionRuntimeHarness.mjs',
  'scripts/runDisposableAppointmentReminderRuntimeHarness.mjs',
  'scripts/runDisposablePushRegistryRuntimeHarness.mjs',
  'scripts/runDisposableProductAdminRuntimeHarness.mjs',
  'scripts/runDisposableMvp10SharedContractHarness.mjs',
  'scripts/runDisposableMealCompletionPhotoRuntimeHarness.mjs',
];

assertCiSafeEnvironment();

for (const harness of harnesses) {
  process.stdout.write(`BACKEND_GATE_START ${harness}\n`);
  const result = spawnSync(process.execPath, [harness], {
    cwd: repoRoot,
    env: { ...process.env, TZ: 'Europe/Istanbul' },
    stdio: 'inherit',
    timeout: 20 * 60 * 1000,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  process.stdout.write(`BACKEND_GATE_PASS ${harness}\n`);
}

process.stdout.write('BACKEND_INTEGRATION_GATE_PASS\n');
