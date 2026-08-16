/**
 * Focused contract runner for the Phase 3A notification client core.
 *
 * The service imports the Vite-only Supabase client, so compile the small
 * client surface to CommonJS and replace that client with a deterministic
 * test double. No network or Supabase project is touched by this runner.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = mkdtempSync(join(tmpdir(), 'dietbridge-notification-client-'));
const sources = [
  'features/notifications/types/notification.ts',
  'features/notifications/state/notificationState.ts',
  'features/notifications/services/notificationService.ts',
  'shared/utils/uuid.ts',
];
const expectedOutputs = [
  'features/notifications/state/notificationState.js',
  'features/notifications/services/notificationService.js',
  'shared/utils/uuid.js',
];

const supabaseClientStub = `'use strict';
let rpcHandler = async () => ({ data: null, error: null });
let fromHandler = () => { throw new Error('supabase.from() was not stubbed.'); };
let channelHandler = () => { throw new Error('supabase.channel() was not stubbed.'); };
let userId = null;
let userError = null;
const removedChannels = [];
exports.__setRpcHandler = (handler) => { rpcHandler = handler; };
exports.__setFromHandler = (handler) => { fromHandler = handler; };
exports.__setChannelHandler = (handler) => { channelHandler = handler; };
exports.__setAuth = ({ id = null, error = null } = {}) => { userId = id; userError = error; };
exports.__reset = () => { rpcHandler = async () => ({ data: null, error: null }); fromHandler = () => { throw new Error('supabase.from() was not stubbed.'); }; channelHandler = () => { throw new Error('supabase.channel() was not stubbed.'); }; userId = null; userError = null; removedChannels.length = 0; };
exports.__getRemovedChannels = () => [...removedChannels];
exports.supabase = {
  auth: {
    getUser: async () => ({ data: { user: userId ? { id: userId } : null }, error: userError }),
  },
  rpc: (name, args) => rpcHandler(name, args),
  from: (table) => fromHandler(table),
  channel: (name) => channelHandler(name),
  removeChannel: async (channel) => { removedChannels.push(channel); return 'ok'; },
};
`;

const fail = (message) => {
  console.error(`[notification-client-contract-tests] ${message}`);
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

mkdirSync(join(buildDir, 'lib'), { recursive: true });
writeFileSync(join(buildDir, 'lib', 'supabaseClient.js'), supabaseClientStub, 'utf8');

const testFile = join(repoRoot, 'tests', 'notificationClientContracts.test.cjs');
const test = spawnSync(process.execPath, ['--test', testFile], {
  cwd: repoRoot,
  env: { ...process.env, NOTIFICATION_CLIENT_CONTRACT_BUILD_DIR: buildDir },
  encoding: 'utf8',
  stdio: 'inherit',
});

rmSync(buildDir, { recursive: true, force: true });
process.exit(test.status ?? 1);
