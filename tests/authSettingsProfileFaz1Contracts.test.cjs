'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const repoRoot = path.join(__dirname, '..');
const buildDir = process.env.MEAL_PLAN_CONTRACT_BUILD_DIR;
if (!buildDir) throw new Error('MEAL_PLAN_CONTRACT_BUILD_DIR is required.');

const stub = require(path.join(buildDir, 'lib', 'supabaseClient.js'));
const subscriptions = require(path.join(buildDir, 'features', 'subscriptions', 'services', 'subscriptionService.js'));
const strength = require(path.join(buildDir, 'features', 'auth', 'utils', 'passwordStrength.js'));
const read = (relativePath) => fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');

// --- Password strength ------------------------------------------------------

test('password strength never rates a password below the minimum length above "Zayıf"', () => {
  assert.equal(strength.PASSWORD_MIN_LENGTH, 8);
  assert.equal(strength.evaluatePasswordStrength('').level, 0);
  assert.equal(strength.evaluatePasswordStrength('Ab1!').level, 1);
  assert.equal(strength.evaluatePasswordStrength('Ab1!xyz').level, 1);
  assert.ok(strength.evaluatePasswordStrength('Ab1!xyz').hints.includes('En az 8 karakter'));
});

test('password strength rewards character variety and length', () => {
  assert.equal(strength.evaluatePasswordStrength('abcdefgh').level, 1);
  assert.equal(strength.evaluatePasswordStrength('abcdefgh1').level, 2);
  assert.equal(strength.evaluatePasswordStrength('Abcdefgh1').level, 3);
  assert.equal(strength.evaluatePasswordStrength('Abcdefgh1!').level, 4);
  assert.equal(strength.evaluatePasswordStrength('Şifreçok-uzun').label, 'Güçlü');
  assert.deepEqual(strength.evaluatePasswordStrength('Abcdefgh1!').hints, []);
});

// --- Subscription catalog and period ------------------------------------------

test('plan catalog mapper keeps real rows in catalog order and drops malformed ones', () => {
  const plans = subscriptions.mapSubscriptionPlanRows([
    { id: 'scale', name: 'Scale', client_limit: 50, sort_order: 30 },
    { id: 'core', name: 'Core', client_limit: 10, sort_order: 10 },
    { id: 'broken', name: '  ', client_limit: 5, sort_order: 5 },
    { id: null, name: 'Ghost', client_limit: 99, sort_order: 1 },
    { id: 'plus', name: 'Plus', client_limit: 30, sort_order: 20 },
  ]);
  assert.deepEqual(plans.map((plan) => plan.id), ['core', 'plus', 'scale']);
  assert.deepEqual(plans.map((plan) => plan.clientLimit), [10, 30, 50]);
  assert.deepEqual(subscriptions.mapSubscriptionPlanRows(null), []);
});

test('period mapper treats a missing row as no subscription and ignores invalid dates', () => {
  assert.equal(subscriptions.mapSubscriptionPeriodRow(null), null);
  assert.deepEqual(
    subscriptions.mapSubscriptionPeriodRow({ status: 'active', current_period_end: '2026-11-01T00:00:00Z' }),
    { status: 'active', currentPeriodEnd: '2026-11-01T00:00:00Z' },
  );
  assert.equal(subscriptions.mapSubscriptionPeriodRow({ status: 'active', current_period_end: 'not-a-date' }).currentPeriodEnd, null);
});

const queryBuilder = (result, calls, table) => {
  const builder = {
    select: (columns) => { calls.push([table, 'select', columns]); return builder; },
    eq: (column, value) => { calls.push([table, 'eq', column, value]); return builder; },
    order: () => builder,
    maybeSingle: async () => result,
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
};

test('fetchSubscriptionDetails reads only the signed-in dietitian period and active plans', async () => {
  const calls = [];
  stub.__setUserId('dietitian-1');
  stub.__setFromHandler((table) => {
    if (table === 'subscription_plans') {
      return queryBuilder({ data: [{ id: 'core', name: 'Core', client_limit: 10, sort_order: 10 }], error: null }, calls, table);
    }
    assert.equal(table, 'dietitian_subscriptions');
    return queryBuilder({ data: { status: 'active', current_period_end: '2026-11-01T00:00:00Z' }, error: null }, calls, table);
  });
  const result = await subscriptions.fetchSubscriptionDetails();
  assert.equal(result.status, 'success');
  assert.equal(result.plans[0].name, 'Core');
  assert.equal(result.period.currentPeriodEnd, '2026-11-01T00:00:00Z');
  assert.ok(calls.some((call) => call[0] === 'dietitian_subscriptions' && call[1] === 'eq' && call[2] === 'dietitian_id' && call[3] === 'dietitian-1'));
  assert.ok(calls.some((call) => call[0] === 'subscription_plans' && call[1] === 'eq' && call[2] === 'is_active' && call[3] === true));
});

test('fetchSubscriptionDetails fails closed on query error or missing session', async () => {
  stub.__setUserId('dietitian-1');
  stub.__setFromHandler((table) => queryBuilder(
    table === 'subscription_plans' ? { data: null, error: { message: 'denied' } } : { data: null, error: null },
    [],
    table,
  ));
  assert.equal((await subscriptions.fetchSubscriptionDetails()).status, 'error');

  stub.__setUserId(null);
  stub.__setFromHandler(() => { throw new Error('from must not run without a session'); });
  assert.equal((await subscriptions.fetchSubscriptionDetails()).status, 'error');
});

// --- Page guarantees -----------------------------------------------------------

test('settings subscription panel shows real period and catalog, no invented billing options', () => {
  const panel = read('features/subscriptions/components/SubscriptionPanel.tsx');
  const settings = read('features/settings/pages/SettingsPage.tsx');
  assert.match(panel, /useSubscriptionDetails\(\)/);
  assert.match(panel, /currentPeriodEnd/);
  assert.match(panel, /PlanCatalog/);
  for (const source of [panel, settings]) {
    assert.doesNotMatch(source, /Yıllık|yearly|Professional|Profesyonel plan|₺|TL\/ay|Bildirim tercih/iu);
  }
});

test('register enforces the minimum password length and shows local strength guidance', () => {
  const register = read('features/auth/pages/RegisterPage.tsx');
  assert.match(register, /formData\.password\.length < PASSWORD_MIN_LENGTH/);
  assert.match(register, /<PasswordStrengthMeter/);
});

test('application timeline uses real profile fields only', () => {
  const page = read('features/auth/pages/VerificationStatusPage.tsx');
  assert.match(page, /dietitianProfile\?\.created_at/);
  assert.match(page, /dietitianProfile\?\.diploma_url/);
  assert.match(page, /dietitianProfile\?\.verified_at/);
  assert.doesNotMatch(page, /\b\d+\s*(iş günü|saat içinde|gün içinde)/u);
});

test('dietitian profile pages show only stored fields with explicit empty states', () => {
  const profile = read('features/dietitians/pages/DietitianProfilePage.tsx');
  const edit = read('features/dietitians/pages/EditProfilePage.tsx');
  assert.doesNotMatch(profile, /USER_AVATAR|window\.confirm|unvan|title:\s*profile/iu);
  assert.match(profile, /ConfirmDialog/);
  assert.match(profile, /Belirtilmemiş/);
  assert.doesNotMatch(edit, /unvan/iu);
  assert.match(edit, /MIN_GRADUATION_YEAR/);
  assert.match(edit, /graduation_year: graduationYear/);
});
