const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const load = (file) => {
  const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
  const module = { exports: {} };
  const context = { exports: module.exports, module, URLSearchParams, require: (name) => {
    if (name === '@supabase/supabase-js') return { createClient: () => assert.fail('Pure tests must not connect') };
    if (name.endsWith('/env')) return { env: {} };
    throw new Error('Unexpected import: ' + name);
  } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return module.exports;
};
const policy = load('features/auth/utils/mobileEmailConfirmation.ts');
const service = load('features/auth/services/mobileEmailConfirmationService.ts');

test('only the dedicated mobile confirmation path bypasses panel auth', () => {
  for (const pathname of ['/mobil/eposta-dogrulama', '/mobil/eposta-dogrulama/']) assert(policy.isMobileEmailConfirmationPath(pathname));
  for (const pathname of ['/login', '/reset-password', '/', '/mobil/eposta-dogrulama-evil']) assert.equal(policy.isMobileEmailConfirmationPath(pathname), false);
});

test('only signup callback credentials are accepted; fake success, recovery and duplicate tokens are rejected', () => {
  assert.equal(policy.parseMobileEmailCallback('', '#type=signup&access_token=fixture').status, 'ready');
  for (const [search, hash] of [['?confirmed=true', ''], ['', '#type=recovery&access_token=fixture'],
    ['', '#type=signup'], ['', '#type=signup&access_token=a&access_token=b'],
    ['?access_token=b', '#type=signup&access_token=a']]) {
    assert.equal(policy.parseMobileEmailCallback(search, hash).status, 'invalid');
  }
  assert.equal(policy.parseMobileEmailCallback('', '#error_code=otp_expired').status, 'expired');
  assert.equal(policy.parseMobileEmailCallback('?error=access_denied', '#type=signup&access_token=fixture').status, 'invalid');
});

test('server-confirmed email succeeds; unconfirmed users and auth failures never show success', async () => {
  const callback = policy.parseMobileEmailCallback('', '#type=signup&access_token=fixture');
  for (const [response, expected] of [
    [{ data: { user: { email_confirmed_at: '2026-10-13T10:00:00Z' } }, error: null }, 'success'],
    [{ data: { user: {} }, error: null }, 'invalid'],
    [{ data: { user: null }, error: null }, 'invalid'],
    [{ data: { user: { email_confirmed_at: 'invalid' } }, error: null }, 'invalid'],
    [{ data: { user: null }, error: { status: 401 } }, 'invalid'],
    [{ data: { user: null }, error: { status: 500 } }, 'error'],
  ]) {
    assert.equal((await service.verifyMobileEmailCallback(callback, async (token) => {
      assert.equal(token, 'fixture'); return response;
    })).status, expected);
  }
  assert.equal((await service.verifyMobileEmailCallback(callback, async () => { throw new Error('offline'); })).status, 'error');
  assert.equal((await service.verifyMobileEmailCallback({ status: 'expired' }, () => assert.fail('No request expected'))).status, 'expired');
});
