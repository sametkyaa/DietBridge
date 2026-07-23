/**
 * Dependency-free contract test runner for the meal plan read/write services.
 *
 * The service modules import lib/supabaseClient, which reads import.meta.env
 * at module scope and cannot run under plain Node. This runner compiles the
 * service modules with the repo's own TypeScript compiler to CommonJS in a
 * temp directory, drops a stub supabaseClient next to them, and executes the
 * node:test suite against the compiled output. No new dependencies.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = mkdtempSync(join(tmpdir(), 'dietbridge-meal-plan-contracts-'));

const SOURCES = [
  'features/meal-plans/services/mealPhotoService.ts',
  'features/meal-plans/services/mealPlanService.ts',
  'features/meal-plans/services/mealPlanReadModel.ts',
  'features/recipes/services/recipeService.ts',
  'shared/utils/uuid.ts',
];

const EXPECTED_OUTPUTS = [
  'features/meal-plans/services/mealPhotoService.js',
  'features/meal-plans/services/mealPlanService.js',
  'features/meal-plans/services/mealPlanReadModel.js',
  'features/recipes/services/recipeService.js',
  'shared/utils/uuid.js',
];

const SUPABASE_CLIENT_STUB = `'use strict';
// Runtime stub for lib/supabaseClient used by the contract tests.
let rpcHandler = async () => ({ data: null, error: null });
let fromHandler = () => {
  throw new Error('supabase.from() was called without a stubbed handler.');
};
let userId = null;
exports.__setRpcHandler = (handler) => { rpcHandler = handler; };
exports.__setFromHandler = (handler) => { fromHandler = handler; };
exports.__setUserId = (id) => { userId = id; };
exports.supabase = {
  auth: {
    getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
  },
  rpc: (name, args) => rpcHandler(name, args),
  from: (table) => fromHandler(table),
};
`;

const fail = (message) => {
  console.error(`[meal-plan-contract-tests] ${message}`);
  rmSync(buildDir, { recursive: true, force: true });
  process.exit(1);
};

const tscCli = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
if (!existsSync(tscCli)) {
  fail('TypeScript compiler not found. Run `npm ci` first.');
}

// --noResolve keeps the compile hermetic: the unresolved lib/supabaseClient
// import (TS2307) is expected because the runtime stub replaces it. Any other
// diagnostic fails the harness; full type safety is gated by `npm run typecheck`.
const compile = spawnSync(process.execPath, [
  tscCli,
  ...SOURCES,
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
if (unexpected.length > 0) {
  fail(`Unexpected TypeScript diagnostics while compiling test modules:\n${unexpected.join('\n')}`);
}

for (const output of EXPECTED_OUTPUTS) {
  if (!existsSync(join(buildDir, output))) {
    fail(`Expected compiled output is missing: ${output}`);
  }
}

const stubDir = join(buildDir, 'lib');
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, 'supabaseClient.js'), SUPABASE_CLIENT_STUB, 'utf8');

const testRun = spawnSync(process.execPath, [
  '--test',
  join(repoRoot, 'tests', 'mealPlanContracts.test.cjs'),
], {
  cwd: repoRoot,
  env: { ...process.env, MEAL_PLAN_CONTRACT_BUILD_DIR: buildDir },
  stdio: 'inherit',
});

rmSync(buildDir, { recursive: true, force: true });
process.exit(testRun.status ?? 1);
