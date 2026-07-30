const assert = require('node:assert/strict');
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
const { dirname, join } = require('node:path');
const test = require('node:test');
const { pathToFileURL } = require('node:url');

const repoRoot = join(__dirname, '..');
const scriptUrl = pathToFileURL(join(repoRoot, 'scripts', 'materializeDisposableSupabaseReplay.mjs')).href;
const rulesPath = join(repoRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const makeTemp = (prefix) => mkdtempSync(join(tmpdir(), prefix));

test('materializer creates exact 27+7 temp copies and an external manifest', async (t) => {
  const parent = makeTemp('dietbridge-materializer-ok-');
  const outputRoot = join(parent, 'replay');
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const { materializeDisposableReplay } = await import(scriptUrl);
  const runtime = materializeDisposableReplay({ repoRoot, outputRoot });

  assert.deepEqual(runtime.expectedHistory, { canonical: 27, image: 7, total: 34 });
  assert.equal(runtime.files.length, 34);
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
