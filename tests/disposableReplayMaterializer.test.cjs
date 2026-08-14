const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} = require('node:fs');
const { tmpdir } = require('node:os');
const { dirname, join, sep } = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const repoRoot = join(__dirname, '..');
const scriptUrl = pathToFileURL(join(repoRoot, 'scripts', 'materializeDisposableSupabaseReplay.mjs')).href;
const rulesPath = join(repoRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const makeTemp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

test('materializer creates the exact current migration copies and an external manifest', async (t) => {
  const parent = makeTemp('dietbridge-materializer-ok-');
  const outputRoot = join(parent, 'replay');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const { materializeDisposableReplay } = await import(scriptUrl);
  const runtime = materializeDisposableReplay({ repoRoot, outputRoot });

  assert.deepEqual(runtime.expectedHistory, { canonical: 37, image: 7, total: 44 });
  assert.equal(runtime.files.length, 44);
  assert.equal(runtime.files.filter(({ exactEditsApplied }) => exactEditsApplied > 0).length, 16);
  assert.equal(runtime.files.filter(
    ({ sourceSha256, materializedSha256 }) => sourceSha256 !== materializedSha256,
  ).length, 16);
  assert.equal(runtime.files.every(({ syntaxOnly }) => syntaxOnly), true);
  assert.equal(existsSync(join(outputRoot, 'materialization-manifest.json')), true);
  for (const file of runtime.files) {
    const bytes = readFileSync(join(outputRoot, file.path));
    assert.equal(sha256(bytes), file.materializedSha256, file.path);
  }
});

test('canonical reader preserves LF-pinned hashes on stale and fresh checkouts', () => {
  const { readCanonicalRepositoryFile } = require('../scripts/readCanonicalRepositoryFile.cjs');
  const relativePath = join('supabase', 'migrations', '20260807115919_mvp_security_hardening_reconciliation.sql');
  const rules = JSON.parse(readFileSync(rulesPath, 'utf8'));
  const rule = rules.files.find(({ path }) => path.replaceAll('/', sep) === relativePath);
  const working = readFileSync(join(repoRoot, relativePath));
  const canonical = readCanonicalRepositoryFile(repoRoot, relativePath);
  assert.equal(sha256(canonical), rule.sourceSha256);
  const normalizedWorking = Buffer.from(working.toString('utf8').replaceAll('\r\n', '\n'), 'utf8');
  assert.equal(sha256(normalizedWorking), rule.sourceSha256);
});

test('canonical reader accepts a staged LF-pinned new file and rejects unstaged content drift', (t) => {
  const { readCanonicalRepositoryFile } = require('../scripts/readCanonicalRepositoryFile.cjs');
  const tempRoot = makeTemp('dietbridge-canonical-index-');
  const relativePath = join('supabase', 'migrations', 'new_migration.sql');
  const absolutePath = join(tempRoot, relativePath);
  t.after(() => rmSync(tempRoot, { recursive: true, force: true }));
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(join(tempRoot, '.gitattributes'), 'supabase/migrations/*.sql text eol=lf\n');
  execFileSync('git', ['init'], { cwd: tempRoot, windowsHide: true });
  execFileSync('git', ['add', '.gitattributes'], { cwd: tempRoot, windowsHide: true });
  execFileSync('git', ['-c', 'user.name=Codex Test', '-c', 'user.email=codex@example.invalid', 'commit', '-m', 'fixture'], {
    cwd: tempRoot,
    windowsHide: true,
  });
  writeFileSync(absolutePath, 'select 1;\r\n');
  execFileSync('git', ['add', relativePath], { cwd: tempRoot, windowsHide: true });
  assert.equal(readCanonicalRepositoryFile(tempRoot, relativePath).toString('utf8'), 'select 1;\n');
  writeFileSync(absolutePath, 'select 2;\r\n');
  assert.throws(
    () => readCanonicalRepositoryFile(tempRoot, relativePath),
    /differs from canonical Git index blob/,
  );
});

test('materializer fails closed on a source hash mismatch without creating output', async (t) => {
  const parent = makeTemp('dietbridge-materializer-hash-fail-');
  const fakeRoot = join(parent, 'repo');
  const outputRoot = join(parent, 'output');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  cpSync(join(repoRoot, 'supabase', 'migrations'), join(fakeRoot, 'supabase', 'migrations'), { recursive: true });
  mkdirSync(join(fakeRoot, 'tests', 'fixtures'), { recursive: true });
  cpSync(rulesPath, join(fakeRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json'));
  const target = join(fakeRoot, 'supabase', 'migrations', '20260713000000_staging_default_table_privileges.sql');
  writeFileSync(target, `${readFileSync(target, 'utf8')}-- unexpected\n`);

  const { materializeDisposableReplay } = await import(scriptUrl);
  assert.throws(
    () => materializeDisposableReplay({ repoRoot: fakeRoot, outputRoot }),
    /Source hash mismatch/,
  );
  assert.equal(existsSync(outputRoot), false);
});

test('materializer rejects an exact-before mismatch even if the source hash allowlist is changed', async (t) => {
  const parent = makeTemp('dietbridge-materializer-before-fail-');
  const fakeRoot = join(parent, 'repo');
  const outputRoot = join(parent, 'output');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  cpSync(join(repoRoot, 'supabase', 'migrations'), join(fakeRoot, 'supabase', 'migrations'), { recursive: true });
  mkdirSync(join(fakeRoot, 'tests', 'fixtures'), { recursive: true });

  const rules = JSON.parse(readFileSync(rulesPath, 'utf8'));
  const rule = rules.files.find(({ path }) => path.endsWith('20260713000000_staging_default_table_privileges.sql'));
  const target = join(fakeRoot, rule.path);
  const changed = readFileSync(target, 'utf8').replace(
    'revoke all on tables from anon, authenticated',
    'revoke all on tables from anon, authenticated -- unexpected',
  );
  writeFileSync(target, changed);
  rule.sourceSha256 = sha256(Buffer.from(changed));
  writeFileSync(
    join(fakeRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json'),
    `${JSON.stringify(rules, null, 2)}\n`,
  );

  const { materializeDisposableReplay } = await import(scriptUrl);
  assert.throws(
    () => materializeDisposableReplay({ repoRoot: fakeRoot, outputRoot }),
    /Exact before mismatch/,
  );
  assert.equal(existsSync(outputRoot), false);
});

test('materializer refuses output outside the system temp directory', async () => {
  const { materializeDisposableReplay } = await import(scriptUrl);
  assert.throws(
    () => materializeDisposableReplay({ repoRoot, outputRoot: join(dirname(repoRoot), 'not-temp-output') }),
    /system temp directory/,
  );
});
