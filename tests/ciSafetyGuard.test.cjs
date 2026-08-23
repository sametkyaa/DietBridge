const assert = require('node:assert/strict');
const test = require('node:test');

const loadGuard = () => import('../scripts/ciSafetyGuard.mjs');

test('CI safety guard rejects the known Production Supabase project without exposing credentials', async () => {
  const { assertCiSafeEnvironment } = await loadGuard();
  assert.throws(
    () => assertCiSafeEnvironment({ VITE_SUPABASE_URL: 'https://kagvxhyvxxypspdxcuxz.supabase.co' }),
    /known Production project/,
  );
});

test('CI safety guard rejects Production mode', async () => {
  const { assertCiSafeEnvironment } = await loadGuard();
  assert.throws(() => assertCiSafeEnvironment({ NODE_ENV: 'production' }), /Production environment mode/);
});

test('CI safety guard requires loopback for disposable targets', async () => {
  const { assertCiSafeEnvironment } = await loadGuard();
  assert.throws(
    () => assertCiSafeEnvironment({ SUPABASE_URL: 'https://example.invalid' }, { requireLoopback: true }),
    /loopback target/,
  );
  assert.equal(assertCiSafeEnvironment({ SUPABASE_URL: 'http://127.0.0.1:54321' }, { requireLoopback: true }), true);
});
