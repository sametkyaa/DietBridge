const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const repoRoot = join(__dirname, '..');
const wrapperUrl = pathToFileURL(join(repoRoot, 'scripts', 'runDisposableSupabaseLocalReplay.mjs')).href;
const rulesPath = join(repoRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const makeTemp = (prefix) => mkdtempSync(join(tmpdir(), prefix));
const makeOutput = (prefix) => {
  const parent = makeTemp(prefix);
  return { parent, outputRoot: join(parent, 'replay') };
};

const makeFixtureRepo = (parent) => {
  const fixtureRoot = join(parent, 'repo');
  cpSync(join(repoRoot, 'supabase', 'migrations'), join(fixtureRoot, 'supabase', 'migrations'), { recursive: true });
  cpSync(join(repoRoot, 'supabase', 'config.toml'), join(fixtureRoot, 'supabase', 'config.toml'));
  cpSync(rulesPath, join(fixtureRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json'), { recursive: true });
  return fixtureRoot;
};

const runMaterializeOnly = async (options = {}) => {
  const { runDisposableSupabaseLocalReplay } = await import(wrapperUrl);
  return runDisposableSupabaseLocalReplay({ materializeOnly: true, ...options });
};

test('materializes the exact 27+7 migration chain in deterministic order', async (t) => {
  const result = await runMaterializeOnly({ keepTemp: true });
  t.after(() => rmSync(result.tempRoot, { recursive: true, force: true }));
  assert.deepEqual(result.manifest.expectedHistory, { canonical: 27, image: 7, total: 34 });
  assert.equal(result.manifest.files.length, 34);
  assert.equal(result.disposableHistory.repositoryMigrationCount, 34);
  assert.equal(result.disposableHistory.localPrerequisiteCount, 1);
  assert.equal(result.disposableHistory.disposableMigrationCount, 35);
  assert.deepEqual(
    result.manifest.files.map((file) => file.path),
    [...result.manifest.files.map((file) => file.path)].sort(),
  );
  assert.equal(existsSync(join(result.tempRoot, 'supabase', 'config.toml')), true);
  assert.equal(existsSync(join(result.tempRoot, 'supabase', '.temp')), false);
});

test('adds one deterministic local-only prerequisite immediately before the avatar policy migration', async (t) => {
  const {
    LOCAL_PREREQUISITE_FILE,
    LOCAL_PREREQUISITE_SHA256,
    LOCAL_PREREQUISITE_SQL,
  } = await import(wrapperUrl);
  const result = await runMaterializeOnly({ keepTemp: true });
  t.after(() => rmSync(result.tempRoot, { recursive: true, force: true }));
  const prerequisitePath = join(result.tempRoot, 'supabase', 'migrations', LOCAL_PREREQUISITE_FILE);
  const avatarPath = 'supabase/migrations/20260728160000_allow_active_clients_read_linked_dietitian_avatar.sql';
  const prerequisiteIndex = result.disposableHistory.paths.indexOf(result.localPrerequisite.path);

  assert.equal(sha256(LOCAL_PREREQUISITE_SQL), LOCAL_PREREQUISITE_SHA256);
  assert.equal(sha256(readFileSync(prerequisitePath)), LOCAL_PREREQUISITE_SHA256);
  assert.equal(result.localPrerequisite.label, 'local-only disposable prerequisite');
  assert.equal(result.disposableHistory.paths[prerequisiteIndex + 1], avatarPath);
  assert.equal(existsSync(join(repoRoot, 'supabase', 'migrations', LOCAL_PREREQUISITE_FILE)), false);
});

test('local prerequisite SQL creates only the exact private avatars bucket contract when absent', async () => {
  const { LOCAL_PREREQUISITE_SQL } = await import(wrapperUrl);
  assert.match(LOCAL_PREREQUISITE_SQL, /insert into storage\.buckets/i);
  assert.match(LOCAL_PREREQUISITE_SQL, /'avatars'/);
  assert.match(LOCAL_PREREQUISITE_SQL, /false,\n      5242880,/);
  assert.match(LOCAL_PREREQUISITE_SQL, /array\['image\/jpeg', 'image\/png', 'image\/webp'\]::text\[\]/);
  assert.match(LOCAL_PREREQUISITE_SQL, /if not found then/);
});

test('local prerequisite SQL fails closed for public, limit, MIME, and name drift', async () => {
  const { LOCAL_PREREQUISITE_SQL } = await import(wrapperUrl);
  assert.match(LOCAL_PREREQUISITE_SQL, /v_name is distinct from 'avatars'/);
  assert.match(LOCAL_PREREQUISITE_SQL, /v_public is distinct from false/);
  assert.match(LOCAL_PREREQUISITE_SQL, /v_file_size_limit is distinct from 5242880/);
  assert.match(LOCAL_PREREQUISITE_SQL, /cardinality\(v_allowed_mime_types\), 0\) <> 3/);
  assert.match(LOCAL_PREREQUISITE_SQL, /v_sorted_mime_types is distinct from array\['image\/jpeg', 'image\/png', 'image\/webp'\]::text\[\]/);
  assert.match(LOCAL_PREREQUISITE_SQL, /raise exception 'Disposable avatars bucket does not match the exact prerequisite contract\.'/);
});

test('local prerequisite SQL creates no policy, grant, function, object, or fixture state', async () => {
  const { LOCAL_PREREQUISITE_SQL } = await import(wrapperUrl);
  assert.doesNotMatch(LOCAL_PREREQUISITE_SQL, /\bcreate\s+policy\b/i);
  assert.doesNotMatch(LOCAL_PREREQUISITE_SQL, /\bgrant\b/i);
  assert.doesNotMatch(LOCAL_PREREQUISITE_SQL, /\bcreate\s+(or\s+replace\s+)?function\b/i);
  assert.doesNotMatch(LOCAL_PREREQUISITE_SQL, /storage\.objects/i);
  assert.doesNotMatch(LOCAL_PREREQUISITE_SQL, /public\.(profiles|dietitian_clients)/i);
});

test('repository migration order remains unchanged inside the 35-entry disposable history', async (t) => {
  const result = await runMaterializeOnly({ keepTemp: true });
  t.after(() => rmSync(result.tempRoot, { recursive: true, force: true }));
  const repositoryPaths = result.manifest.files.map((file) => file.path);
  const disposableRepositoryPaths = result.disposableHistory.paths.filter((path) => path !== result.localPrerequisite.path);
  assert.deepEqual(disposableRepositoryPaths, repositoryPaths);
  assert.equal(result.disposableHistory.paths.filter((path) => path.endsWith('20260729090000_chat_image_schema.sql')).length, 1);
  assert.equal(result.disposableHistory.paths.filter((path) => path.endsWith('20260729090400_chat_image_cleanup.sql')).length, 1);
});

test('reports the verified source and materialized hashes', async (t) => {
  const result = await runMaterializeOnly({ keepTemp: true });
  t.after(() => rmSync(result.tempRoot, { recursive: true, force: true }));
  for (const file of result.manifest.files) {
    const source = readFileSync(join(repoRoot, file.path));
    const materialized = readFileSync(join(result.tempRoot, file.path));
    assert.equal(sha256(source), file.sourceSha256, file.path);
    assert.equal(sha256(materialized), file.materializedSha256, file.path);
  }
});

test('applies only exact semicolon transformations', async (t) => {
  const result = await runMaterializeOnly({ keepTemp: true });
  t.after(() => rmSync(result.tempRoot, { recursive: true, force: true }));
  const baseline = result.manifest.files.find((file) => file.path.endsWith('20260713000001_production_public_baseline.sql'));
  const materialized = readFileSync(join(result.tempRoot, baseline.path), 'utf8');
  assert.match(materialized, /^SET statement_timeout = 0;$/m);
  assert.match(materialized, /^SET lock_timeout = 0;$/m);
  assert.equal(baseline.syntaxOnly, true);
});

test('fails closed when the source hash changes', async (t) => {
  const parent = makeTemp('dietbridge-wrapper-source-hash-');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const fixtureRoot = makeFixtureRepo(parent);
  const target = join(fixtureRoot, 'supabase', 'migrations', '20260713000000_staging_default_table_privileges.sql');
  writeFileSync(target, `${readFileSync(target, 'utf8')}-- unexpected\n`);
  await assert.rejects(() => runMaterializeOnly({ repoRoot: fixtureRoot }), /Source hash mismatch/);
});

test('fails closed when an exact before line is missing', async (t) => {
  const parent = makeTemp('dietbridge-wrapper-before-');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const fixtureRoot = makeFixtureRepo(parent);
  const rules = JSON.parse(readFileSync(join(fixtureRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json'), 'utf8'));
  const rule = rules.files.find((file) => file.path.endsWith('20260713000000_staging_default_table_privileges.sql'));
  const target = join(fixtureRoot, rule.path);
  const changed = readFileSync(target, 'utf8').replace(rule.edits[0].before, `${rule.edits[0].before} -- changed`);
  writeFileSync(target, changed);
  rule.sourceSha256 = sha256(Buffer.from(changed));
  writeFileSync(join(fixtureRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json'), `${JSON.stringify(rules, null, 2)}\n`);
  await assert.rejects(() => runMaterializeOnly({ repoRoot: fixtureRoot }), /Exact before mismatch/);
});

test('fails closed when an exact edit line is duplicated', async (t) => {
  const parent = makeTemp('dietbridge-wrapper-duplicate-');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const fixtureRoot = makeFixtureRepo(parent);
  const rules = JSON.parse(readFileSync(join(fixtureRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json'), 'utf8'));
  const rule = rules.files.find((file) => file.path.endsWith('20260713000000_staging_default_table_privileges.sql'));
  rule.edits.push({ ...rule.edits[0] });
  writeFileSync(join(fixtureRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json'), `${JSON.stringify(rules, null, 2)}\n`);
  await assert.rejects(() => runMaterializeOnly({ repoRoot: fixtureRoot }), /Duplicate exact edit line/);
});

test('fails closed when a materialized hash is not allowlisted', async (t) => {
  const parent = makeTemp('dietbridge-wrapper-materialized-hash-');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const fixtureRoot = makeFixtureRepo(parent);
  const rules = JSON.parse(readFileSync(join(fixtureRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json'), 'utf8'));
  rules.files[0].materializedSha256 = '0'.repeat(64);
  writeFileSync(join(fixtureRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json'), `${JSON.stringify(rules, null, 2)}\n`);
  await assert.rejects(() => runMaterializeOnly({ repoRoot: fixtureRoot }), /Materialized hash mismatch/);
});

test('rejects a disposable target that resolves inside the repository', async (t) => {
  const parent = makeTemp('dietbridge-wrapper-repository-output-');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const fixtureRoot = makeFixtureRepo(parent);
  await assert.rejects(
    () => runMaterializeOnly({ repoRoot: fixtureRoot, createTemp: () => join(fixtureRoot, 'disposable-output') }),
    /outside the repository/,
  );
});

test('--materialize-only never invokes Supabase', async () => {
  let invoked = false;
  await runMaterializeOnly({ executeCommand: async () => { invoked = true; return { code: 0 }; } });
  assert.equal(invoked, false);
});

test('normal mode invokes the pinned local-only db reset command', async () => {
  let invocation;
  const { runDisposableSupabaseLocalReplay } = await import(wrapperUrl);
  await runDisposableSupabaseLocalReplay({
    executeCommand: async (options) => { invocation = options; return { code: 0, signal: null, stdout: '', stderr: '' }; },
  });
  const supabaseArgs = process.platform === 'win32' ? invocation.args.slice(1) : invocation.args;
  if (process.platform === 'win32') {
    assert.equal(invocation.command, process.execPath);
    assert.match(invocation.args[0], /node_modules[\\/]npm[\\/]bin[\\/]npx-cli\.js$/);
  } else {
    assert.equal(invocation.command, 'npx');
  }
  assert.deepEqual(supabaseArgs.slice(0, 3), ['--yes', 'supabase@2.110.0', '--workdir']);
  assert.deepEqual(supabaseArgs.slice(-4), ['db', 'reset', '--local', '--no-seed']);
  assert.equal(supabaseArgs.includes('--linked'), false);
});

test('propagates the local child exit failure without child output', async () => {
  const { runDisposableSupabaseLocalReplay } = await import(wrapperUrl);
  await assert.rejects(
    () => runDisposableSupabaseLocalReplay({
      executeCommand: async () => ({ code: 17, signal: null, stdout: 'service_role=not-for-logs', stderr: 'SQLSTATE: 42601' }),
    }),
    (error) => error.message.includes('exit 17') && error.message.includes('SQLSTATE 42601') && !error.message.includes('not-for-logs'),
  );
});

test('reports the retained temp path on a kept replay failure', async () => {
  let tempRoot;
  const { runDisposableSupabaseLocalReplay } = await import(wrapperUrl);
  await assert.rejects(
    () => runDisposableSupabaseLocalReplay({
      keepTemp: true,
      createTemp: () => { tempRoot = makeTemp('dietbridge-wrapper-kept-failure-'); return tempRoot; },
      executeCommand: async () => ({ code: 1, signal: null, stdout: '', stderr: 'ERROR: local failure' }),
    }),
    (error) => error.message.includes(`retained at ${join(tempRoot, 'project')}`),
  );
  assert.equal(existsSync(join(tempRoot, 'project')), true);
  rmSync(tempRoot, { recursive: true, force: true });
});

test('cleans the temp project by default', async () => {
  let tempRoot;
  await runMaterializeOnly({ createTemp: () => { tempRoot = makeTemp('dietbridge-wrapper-cleanup-'); return tempRoot; } });
  assert.equal(existsSync(tempRoot), false);
});

test('--keep-temp retains the disposable project for local SQL checks', async (t) => {
  const result = await runMaterializeOnly({ keepTemp: true });
  t.after(() => rmSync(result.tempRoot, { recursive: true, force: true }));
  assert.equal(existsSync(result.tempRoot), true);
  assert.equal(existsSync(join(result.tempRoot, 'materialization-manifest.json')), true);
});

test('does not alter historical source migrations', async () => {
  const baselinePath = join(repoRoot, 'supabase', 'migrations', '20260713000001_production_public_baseline.sql');
  const before = sha256(readFileSync(baselinePath));
  await runMaterializeOnly();
  assert.equal(sha256(readFileSync(baselinePath)), before);
});

test('requires the local Supabase config before materializing', async (t) => {
  const parent = makeTemp('dietbridge-wrapper-config-');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const fixtureRoot = makeFixtureRepo(parent);
  rmSync(join(fixtureRoot, 'supabase', 'config.toml'));
  await assert.rejects(() => runMaterializeOnly({ repoRoot: fixtureRoot }), /Required local Supabase config is missing/);
});

test('accepts only the documented CLI options', async () => {
  const { parseCliArguments } = await import(wrapperUrl);
  assert.deepEqual(parseCliArguments(['--materialize-only', '--keep-temp']), { materializeOnly: true, keepTemp: true, help: false });
  assert.throws(() => parseCliArguments(['--linked']), /Unsupported argument/);
});
