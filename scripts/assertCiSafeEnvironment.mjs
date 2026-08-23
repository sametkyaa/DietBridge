#!/usr/bin/env node

import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';

assertCiSafeEnvironment(process.env, {
  requireLoopback: process.argv.includes('--require-loopback'),
});
process.stdout.write('CI_SAFETY_GUARD_PASS\n');

