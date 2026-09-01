'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const deferredPushRelativePath = 'supabase/migrations/20260817120000_push_registry_outbox_backend.sql';
const readBytes = (relativePath) => fs.readFileSync(path.join(root, relativePath));
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();

const loadMaterializer = async () => {
  const [disposableInfrastructure, replayMaterializer] = await Promise.all([
    import('../scripts/runDisposableSupabaseLocalReplay.mjs'),
    import('../scripts/materializeDisposableSupabaseReplay.mjs'),
  ]);
  return { ...disposableInfrastructure, ...replayMaterializer };
};

test('configured account deletion function source is materialized without secrets or extra files', async () => {
  const {
    copyConfiguredDisposableFunctionSources,
    copyRequiredProjectFiles,
    materializeDisposableReplay,
    DELETE_CLIENT_ACCOUNT_ENTRYPOINT,
    DELETE_CLIENT_ACCOUNT_FUNCTION_FILES,
  } = await loadMaterializer();
  const tempParent = fs.mkdtempSync(path.join(os.tmpdir(), 'dietbridge-function-materialization-'));
  const tempRoot = path.join(tempParent, 'project');

  try {
    const manifest = materializeDisposableReplay({ repoRoot: root, outputRoot: tempRoot });
    const configPath = copyRequiredProjectFiles({ repoRoot: root, tempRoot });
    const functionDirectory = path.join(tempRoot, 'supabase', 'functions', 'delete-client-account');
    const sourceDirectory = path.join(root, 'supabase', 'functions', 'delete-client-account');

    assert.equal(configPath, path.join(tempRoot, 'supabase', 'config.toml'));
    assert.equal(manifest.expectedHistory.total, 53);
    assert.match(
      fs.readFileSync(configPath, 'utf8'),
      new RegExp(`entrypoint\\s*=\\s*["']${DELETE_CLIENT_ACCOUNT_ENTRYPOINT.replaceAll('/', '\\/')}["']`),
    );
    assert.deepEqual(
      fs.readdirSync(functionDirectory).sort(),
      [...DELETE_CLIENT_ACCOUNT_FUNCTION_FILES].sort(),
    );
    for (const file of DELETE_CLIENT_ACCOUNT_FUNCTION_FILES) {
      assert.deepEqual(
        fs.readFileSync(path.join(functionDirectory, file)),
        fs.readFileSync(path.join(sourceDirectory, file)),
      );
    }
    assert.equal(fs.existsSync(path.join(tempRoot, '.env')), false);
    assert.equal(fs.existsSync(path.join(tempRoot, '.env.local')), false);
    for (const file of DELETE_CLIENT_ACCOUNT_FUNCTION_FILES) {
      assert.doesNotMatch(fs.readFileSync(path.join(functionDirectory, file), 'utf8'), /SUPABASE_SERVICE_ROLE_KEY\s*=/);
    }
    assert.ok(path.resolve(tempRoot).startsWith(`${path.resolve(os.tmpdir())}${path.sep}`));
    assert.throws(
      () => copyConfiguredDisposableFunctionSources({ repoRoot: root, tempRoot, configPath }),
      /destination already exists/,
    );

    const deferredPushBytes = readBytes(deferredPushRelativePath);
    assert.equal(deferredPushBytes.length, 23771);
    assert.equal(
      execFileSync('git', ['hash-object', '--', deferredPushRelativePath], { cwd: root, encoding: 'utf8' }).trim(),
      '810f5cad1ef0e991aa3fcf97798706ce535c6156',
    );
    assert.equal(sha256(deferredPushBytes), '83CF92EDB8ECC7EAC6581AC839694F9192303ADD7E522416FC1CB9AF6583A97B');
  } finally {
    fs.rmSync(tempParent, { recursive: true, force: true });
  }
});

test('configured account deletion function materialization rejects repository output paths', async () => {
  const { copyConfiguredDisposableFunctionSources } = await loadMaterializer();
  assert.throws(
    () => copyConfiguredDisposableFunctionSources({
      repoRoot: root,
      tempRoot: root,
      configPath: path.join(root, 'supabase', 'config.toml'),
    }),
    /system temp directory|outside the repository/,
  );
});
