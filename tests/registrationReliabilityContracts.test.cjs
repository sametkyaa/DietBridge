'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replaceAll('\r\n', '\n');
const service = () => read('features/dietitians/services/dietitianService.ts');
const serviceBeforeProfileRead = () => service().slice(0, service().indexOf('export const getCurrentDietitianProfile'));

test('registration follows Auth, session, core persistence, upload, and diploma-link ordering', () => {
  const source = service();
  const body = source.slice(source.indexOf('export const registerDietitian'), source.indexOf('export const completeDietitianRegistration'));
  const authIndex = body.indexOf('supabase.auth.signUp');
  const sessionIndex = body.indexOf('getAuthenticatedUser()');
  const coreIndex = body.indexOf('persistCoreOnboardingFields(');
  const uploadIndex = body.indexOf('uploadDiplomaFile(');
  const linkIndex = body.indexOf('persistDiplomaLink(');

  assert.ok(authIndex >= 0, 'registration must create the Auth account first');
  assert.ok(sessionIndex > authIndex, 'registration must verify the authenticated session after signUp');
  assert.ok(coreIndex > sessionIndex, 'core profile fields must be persisted after session verification');
  assert.ok(uploadIndex > coreIndex, 'diploma upload must follow core profile persistence');
  assert.ok(linkIndex > uploadIndex, 'diploma_url must be linked only after upload succeeds');

  const coreFailureWindow = body.slice(coreIndex, uploadIndex);
  assert.match(coreFailureWindow, /catch\s*\{[\s\S]*return incompleteResult\(\);/u);
  assert.doesNotMatch(coreFailureWindow, /uploadDiplomaFile\(/u);
});

test('no session returns email_confirmation_required before any profile or Storage continuation', () => {
  const body = service().slice(service().indexOf('export const registerDietitian'), service().indexOf('export const completeDietitianRegistration'));
  const noSessionIndex = body.indexOf('if (!authData.session)');
  const coreIndex = body.indexOf('persistCoreOnboardingFields(');
  const uploadIndex = body.indexOf('uploadDiplomaFile(');
  const noSessionBlock = body.slice(noSessionIndex, coreIndex);

  assert.ok(noSessionIndex >= 0);
  assert.ok(noSessionIndex < coreIndex);
  assert.ok(noSessionIndex < uploadIndex);
  assert.match(noSessionBlock, /status: 'email_confirmation_required'/u);
  assert.doesNotMatch(noSessionBlock, /persistCoreOnboardingFields|uploadDiplomaFile|persistDiplomaLink/u);
});

test('completion is same-account recovery and cannot create a second Auth account', () => {
  const source = service();
  const start = source.indexOf('export const completeDietitianRegistration');
  const end = source.indexOf('export const getCurrentDietitianProfile', start);
  const body = source.slice(start, end);

  assert.ok(start >= 0);
  assert.doesNotMatch(body, /signUp\(/u);
  assert.match(body, /getAuthenticatedUser\(\)/u);
  assert.match(body, /getCurrentDietitianOnboarding\(\)/u);
  assert.match(body, /verification_status !== 'pending'/u);
  assert.match(body, /is_verified !== false/u);
  assert.match(body, /status: 'failed', error: VERIFICATION_LOCKED_MESSAGE/u);
});

test('registration writes only safe onboarding fields and never client authority fields', () => {
  const source = serviceBeforeProfileRead();
  const coreStart = source.indexOf('const persistCoreOnboardingFields');
  const linkStart = source.indexOf('const persistDiplomaLink');
  const core = source.slice(coreStart, linkStart);
  const link = source.slice(linkStart, source.indexOf('const removeCanonicalDiplomaFile'));

  assert.doesNotMatch(core, /\brole\s*:/u);
  assert.doesNotMatch(core, /is_verified|verification_status|verified_at|rejection_reason/u);
  assert.doesNotMatch(link, /\brole\s*:/u);
  assert.doesNotMatch(link, /is_verified|verification_status|verified_at|rejection_reason/u);
  assert.match(link, /update\(\{ diploma_url: diplomaPath \}\)/u);
});

test('Storage path and cleanup are private, deterministic, and ownership-scoped', () => {
  const source = serviceBeforeProfileRead();
  const helper = read('features/auth/utils/registrationCompleteness.ts');
  assert.match(helper, /DIETITIAN_DIPLOMA_BUCKET = 'dietitian-diplomas'/u);
  assert.match(source, /getCanonicalDiplomaPath\(authUserId\)/u);
  assert.match(source, /authenticatedUser\.id !== authUserId/u);
  assert.match(source, /upsert: true/u);
  assert.match(source, /remove\(\[getCanonicalDiplomaPath\(authenticatedUser\.id\)\]\)/u);
  assert.doesNotMatch(source, /getPublicUrl|createSignedUrl|SERVICE_ROLE|service_role|VITE_SUPABASE_SERVICE/u);
  assert.doesNotMatch(source, /diplomas\/\$\{[^}]+\}\/[^d]+\.(?:png|jpg|jpeg)/iu);
  assert.doesNotMatch(source, /console\.(?:error|warn)\([^)]*error/u);
});

test('link persistence failure returns recoverable incomplete state and conditionally cleans the new object', () => {
  const source = serviceBeforeProfileRead();
  const linkFailureStart = source.indexOf('try {\n      await persistDiplomaLink');
  const linkFailureBlock = source.slice(linkFailureStart, source.indexOf('return incompleteResult();', linkFailureStart) + 'return incompleteResult();'.length);

  assert.match(linkFailureBlock, /isCanonicalDiplomaPath\(coreResult\.diplomaUrl/u);
  assert.match(linkFailureBlock, /removeCanonicalDiplomaFile\(userId\)/u);
  assert.match(linkFailureBlock, /return incompleteResult\(\)/u);
  assert.match(source, /diploma_url: diplomaPath/u);
});

test('the single client completeness helper mirrors the Product Admin persisted fields', () => {
  const helper = read('features/auth/utils/registrationCompleteness.ts');
  for (const field of ['full_name', 'email', 'phone', 'university', 'graduation_year', 'experience_years', 'specialization', 'bio', 'diploma']) {
    assert.match(helper, new RegExp(`['"]${field}['"]`, 'u'), `missing completeness field: ${field}`);
  }
  assert.match(helper, /1950/u);
  assert.match(helper, /new Date\(\)\.getFullYear\(\)/u);
  assert.match(helper, /diplomas\/\$\{userId\}\/diploma\.pdf/u);
  assert.match(helper, /Storage object existence remains authoritative/u);
});

test('Auth access distinguishes incomplete registration before pending verification and preserves strict verification states', () => {
  const authTypes = read('features/auth/types.ts');
  const authService = read('features/auth/services/authService.ts');
  const route = read('shared/components/ProtectedRoute.tsx');
  assert.match(authTypes, /status: 'incomplete_registration'/u);
  assert.match(authService, /status: 'incomplete_registration'[\s\S]*dietitianProfile: null/u);
  assert.match(authService, /if \(!completeness\.isComplete\)/u);
  assert.match(authService, /email: rawProfile\.profiles\?\.email,/u);
  assert.doesNotMatch(authService, /email: rawProfile\.profiles\?\.email \|\| authUserData\.user\?\.email/u);
  assert.match(authService, /isVerified === false \? 'rejected'/u);
  assert.match(authService, /isVerified === false \? 'pending'/u);
  assert.match(authService, /isVerified === true \? 'approved'/u);
  assert.match(route, /allowIncomplete/u);
  assert.match(route, /Navigate to="\/complete-registration" replace/u);
  assert.match(route, /allowIncomplete \? <Outlet \/> : <Navigate/u);
});

test('completion route and UI keep Auth email fixed and route completed users through normal access resolution', () => {
  const app = read('App.tsx');
  const page = read('features/auth/pages/CompleteRegistrationPage.tsx');
  const register = read('features/auth/pages/RegisterPage.tsx');
  const login = read('features/auth/pages/LoginPage.tsx');

  assert.match(app, /path="\/complete-registration"/u);
  assert.match(app, /ProtectedRoute allowIncomplete/u);
  assert.match(page, /completeDietitianRegistration/u);
  assert.match(page, /readOnly value=\{onboarding\.email\}/u);
  assert.match(page, /await refreshAccess\(\)/u);
  assert.match(page, /navigate\('\/', \{ replace: true \}\)/u);
  assert.match(register, /result\.status === 'email_confirmation_required'/u);
  assert.match(register, /result\.status === 'incomplete_profile'/u);
  assert.match(register, /navigate\('\/complete-registration'/u);
  assert.match(login, /accessState\.status === 'incomplete_registration'/u);
});

test('existing Product Admin routes and migration remain part of the unchanged contract', () => {
  const app = read('App.tsx');
  const migration = read('supabase/migrations/20260826133224_product_admin_dietitian_verification.sql');
  assert.match(app, /path="\/admin"/u);
  assert.match(app, /path="\/admin\/dietitians"/u);
  assert.match(app, /path="\/admin\/dietitians\/:id"/u);
  assert.match(migration, /private\.calculate_dietitian_application_completeness/u);
  assert.match(migration, /diplomas\/%s\/diploma\.pdf/u);
  assert.match(migration, /storage\.objects as object_row/u);
});
