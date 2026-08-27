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
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = mkdtempSync(join(tmpdir(), 'dietbridge-meal-plan-contracts-'));

const CANONICAL_FIXTURE_RENAMES = new Map([
  [
    '20260724100000_allow_clients_read_planned_recipe_images.sql',
    '20260724071352_allow_clients_read_planned_recipe_images.sql',
  ],
]);

const resolveCanonicalSqlFixture = (exactFileName) => {
  const lookupName = CANONICAL_FIXTURE_RENAMES.get(exactFileName) ?? exactFileName;
  const roots = [
    join(repoRoot, 'supabase', 'migrations'),
    join(repoRoot, 'supabase', 'migration_archive'),
  ];
  const matches = [];
  const pendingDirectories = [...roots];

  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    if (!existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const entryPath = join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
      } else if (entry.isFile() && entry.name === lookupName) {
        matches.push(entryPath);
      }
    }
  }

  if (matches.length === 0) {
    throw new Error(`Canonical SQL fixture not found: ${exactFileName}`);
  }
  if (matches.length !== 1) {
    throw new Error(`Canonical SQL fixture is ambiguous: ${exactFileName}`);
  }
  return relative(repoRoot, matches[0]);
};

const FIXTURE_BASENAMES = [
  '20260723182501_persist_recipe_meal_snapshots.sql',
  '20260724100000_allow_clients_read_planned_recipe_images.sql',
];
const fixtureOverrides = Object.fromEntries(
  FIXTURE_BASENAMES.map((fileName) => [fileName, join(repoRoot, resolveCanonicalSqlFixture(fileName))]),
);

const SOURCES = [
  'features/meal-plans/services/mealPhotoService.ts',
  'features/meal-plans/services/mealPlanService.ts',
  'features/meal-plans/services/mealPlanReadModel.ts',
  'features/auth/services/authLifecycle.ts',
  'features/recipes/services/recipeService.ts',
  'features/recipes/utils/filterRecipes.ts',
  'features/clients/utils/measurementContract.ts',
  'features/appointments/utils/appointmentContract.ts',
  'features/appointments/services/appointmentService.ts',
  'features/dashboard/types/dailyTask.ts',
  'features/dashboard/utils/dailyTaskContract.ts',
  'features/dashboard/utils/dashboardContract.ts',
  'features/dashboard/services/dailyTaskService.ts',
  'features/notes/types/note.ts',
  'features/notes/utils/noteContract.ts',
  'features/notes/services/noteService.ts',
  'features/analytics/types/analytics.ts',
  'features/analytics/utils/waterContract.ts',
  'shared/utils/dateContract.ts',
  'shared/utils/adherenceContract.ts',
  'features/analytics/utils/analyticsContract.ts',
  'features/analytics/services/analyticsService.ts',
  'features/subscriptions/types/subscription.ts',
  'features/subscriptions/services/subscriptionService.ts',
  'shared/utils/avatarUrl.ts',
  'shared/utils/uuid.ts',
  'features/chat/types/chat.ts',
  'features/chat/types/chatImage.ts',
  'features/chat/types/chatImageUpload.ts',
  'features/chat/utils/receipts.ts',
  'features/chat/utils/conversationPreview.ts',
  'features/chat/utils/canonicalJpegPlan.ts',
  'features/chat/utils/canonicalizeChatImage.ts',
  'features/chat/utils/chatImageUploadReducer.ts',
  'features/chat/utils/chatImageUploadResources.ts',
  'features/chat/utils/chatImageUiState.ts',
  'features/chat/utils/chatScrollLifecycle.ts',
  'features/chat/types/mealActivity.ts',
  'features/chat/utils/mealActivity.ts',
  'features/chat/services/chatService.ts',
  'features/chat/services/mealActivityService.ts',
  'features/chat/services/chatImageService.ts',
  'features/chat/services/chatImageReadService.ts',
  'features/meal-tracking/types/mealTracking.ts',
  'features/meal-tracking/utils/mealTrackingContract.ts',
  'features/meal-tracking/services/mealTrackingService.ts',
];

const EXPECTED_OUTPUTS = [
  'features/meal-plans/services/mealPhotoService.js',
  'features/meal-plans/services/mealPlanService.js',
  'features/meal-plans/services/mealPlanReadModel.js',
  'features/auth/services/authLifecycle.js',
  'features/recipes/services/recipeService.js',
  'features/recipes/utils/filterRecipes.js',
  'features/clients/utils/measurementContract.js',
  'features/appointments/utils/appointmentContract.js',
  'features/appointments/services/appointmentService.js',
  'features/dashboard/types/dailyTask.js',
  'features/dashboard/utils/dailyTaskContract.js',
  'features/dashboard/utils/dashboardContract.js',
  'features/dashboard/services/dailyTaskService.js',
  'features/notes/types/note.js',
  'features/notes/utils/noteContract.js',
  'features/notes/services/noteService.js',
  'features/analytics/types/analytics.js',
  'features/analytics/utils/waterContract.js',
  'shared/utils/dateContract.js',
  'shared/utils/adherenceContract.js',
  'features/analytics/utils/analyticsContract.js',
  'features/analytics/services/analyticsService.js',
  'features/subscriptions/types/subscription.js',
  'features/subscriptions/services/subscriptionService.js',
  'shared/utils/avatarUrl.js',
  'shared/utils/uuid.js',
  'features/chat/types/chat.js',
  'features/chat/types/chatImage.js',
  'features/chat/types/chatImageUpload.js',
  'features/chat/utils/receipts.js',
  'features/chat/utils/conversationPreview.js',
  'features/chat/utils/canonicalJpegPlan.js',
  'features/chat/utils/canonicalizeChatImage.js',
  'features/chat/utils/chatImageUploadReducer.js',
  'features/chat/utils/chatImageUploadResources.js',
  'features/chat/utils/chatImageUiState.js',
  'features/chat/utils/chatScrollLifecycle.js',
  'features/chat/types/mealActivity.js',
  'features/chat/utils/mealActivity.js',
  'features/chat/services/chatService.js',
  'features/chat/services/mealActivityService.js',
  'features/chat/services/chatImageService.js',
  'features/chat/services/chatImageReadService.js',
  'features/meal-tracking/types/mealTracking.js',
  'features/meal-tracking/utils/mealTrackingContract.js',
  'features/meal-tracking/services/mealTrackingService.js',
];

const SUPABASE_CLIENT_STUB = `'use strict';
// Runtime stub for lib/supabaseClient used by the contract tests.
let rpcHandler = async () => ({ data: null, error: null });
let fromHandler = () => {
  throw new Error('supabase.from() was called without a stubbed handler.');
};
let storageHandler = () => {
  throw new Error('supabase.storage.from() was called without a stubbed handler.');
};
let channelHandler = () => {
  throw new Error('supabase.channel() was called without a stubbed handler.');
};
let functionHandler = async () => ({ data: null, error: null });
let userId = null;
exports.__setRpcHandler = (handler) => { rpcHandler = handler; };
exports.__setFromHandler = (handler) => { fromHandler = handler; };
exports.__setStorageHandler = (handler) => { storageHandler = handler; };
exports.__setChannelHandler = (handler) => { channelHandler = handler; };
exports.__setUserId = (id) => { userId = id; };
exports.__setFunctionHandler = (handler) => { functionHandler = handler; };
exports.supabase = {
  auth: {
    getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: null }),
  },
  rpc: (name, args) => rpcHandler(name, args),
  from: (table) => fromHandler(table),
  storage: { from: (bucket) => storageHandler(bucket) },
  functions: { invoke: (name, options) => functionHandler(name, options) },
  channel: (name) => channelHandler(name),
  removeChannel: async () => undefined,
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

const avatarUtilsDir = join(buildDir, 'shared', 'utils');
mkdirSync(avatarUtilsDir, { recursive: true });
writeFileSync(join(avatarUtilsDir, 'avatarUrl.js'), "'use strict'; exports.resolveProfilePhotoUrl = async (value) => value ?? null;\n", 'utf8');

const fixtureShimPath = join(buildDir, 'canonicalSqlFixtureShim.cjs');
writeFileSync(fixtureShimPath, `'use strict';
const fs = require('node:fs');
const path = require('node:path');
const overrides = ${JSON.stringify(fixtureOverrides)};
const originalReadFileSync = fs.readFileSync;
fs.readFileSync = (file, ...args) => {
  const basename = typeof file === 'string' ? path.basename(file) : '';
  const replacement = overrides[basename];
  return replacement
    ? originalReadFileSync.call(fs, replacement, ...args)
    : originalReadFileSync.call(fs, file, ...args);
};
`, 'utf8');

const testFiles = [
  join(repoRoot, 'tests', 'mealPlanContracts.test.cjs'),
  join(repoRoot, 'tests', 'chatContracts.test.cjs'),
  join(repoRoot, 'tests', 'chatImageContracts.test.cjs'),
  join(repoRoot, 'tests', 'chatImageReadContracts.test.cjs'),
  join(repoRoot, 'tests', 'chatImageUploadContracts.test.cjs'),
  join(repoRoot, 'tests', 'chatImageOwnershipContracts.test.cjs'),
  join(repoRoot, 'tests', 'chatImageUiContracts.test.cjs'),
  join(repoRoot, 'tests', 'chatScrollLifecycle.test.cjs'),
  join(repoRoot, 'tests', 'disposableReplayMaterializer.test.cjs'),
  join(repoRoot, 'tests', 'disposableSupabaseLocalReplay.test.cjs'),
  join(repoRoot, 'tests', 'measurementContracts.test.cjs'),
  join(repoRoot, 'tests', 'appointmentContracts.test.cjs'),
  join(repoRoot, 'tests', 'dashboardTaskContracts.test.cjs'),
  join(repoRoot, 'tests', 'dashboardClosureContracts.test.cjs'),
  join(repoRoot, 'tests', 'analyticsContracts.test.cjs'),
  join(repoRoot, 'tests', 'waterSharedContract.test.cjs'),
  join(repoRoot, 'tests', 'subscriptionContracts.test.cjs'),
  join(repoRoot, 'tests', 'mvp9MockCleanupContracts.test.cjs'),
  join(repoRoot, 'tests', 'mvp10SharedContractContracts.test.cjs'),
  join(repoRoot, 'tests', 'mealTrackingContracts.test.cjs'),
  join(repoRoot, 'tests', 'mealActivityContracts.test.cjs'),
  join(repoRoot, 'tests', 'dietitianProfilePresentation.test.cjs'),
  join(repoRoot, 'tests', 'noteContracts.test.cjs'),
];
const selectedTestFiles = process.argv.includes('--appointments-only')
  ? [join(repoRoot, 'tests', 'appointmentContracts.test.cjs')]
  : process.argv.includes('--chat-only')
    ? testFiles.filter((file) => /chat(?:Contracts|Image|ScrollLifecycle)/i.test(file))
  : process.argv.includes('--daily-tasks-only')
    ? [join(repoRoot, 'tests', 'dashboardTaskContracts.test.cjs')]
  : process.argv.includes('--notes-only')
    ? [join(repoRoot, 'tests', 'noteContracts.test.cjs')]
    : process.argv.includes('--analytics-only')
      ? [join(repoRoot, 'tests', 'analyticsContracts.test.cjs')]
      : process.argv.includes('--water-only')
        ? [join(repoRoot, 'tests', 'waterSharedContract.test.cjs')]
      : process.argv.includes('--subscriptions-only')
        ? [join(repoRoot, 'tests', 'subscriptionContracts.test.cjs')]
      : process.argv.includes('--profile-only')
        ? [join(repoRoot, 'tests', 'dietitianProfilePresentation.test.cjs')]
    : testFiles;

const testRun = spawnSync(process.execPath, [
  '--test',
  ...selectedTestFiles,
], {
  cwd: repoRoot,
  env: {
    ...process.env,
    MEAL_PLAN_CONTRACT_BUILD_DIR: buildDir,
    NODE_OPTIONS: [process.env.NODE_OPTIONS, `--require=${fixtureShimPath}`].filter(Boolean).join(' '),
  },
  stdio: 'inherit',
});

rmSync(buildDir, { recursive: true, force: true });
process.exit(testRun.status ?? 1);
