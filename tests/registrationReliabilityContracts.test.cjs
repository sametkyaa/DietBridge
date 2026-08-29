'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const service = () => read('features/dietitians/services/dietitianService.ts');
const serviceBeforeProfileRead = () => service().slice(0, service().indexOf('export const getCurrentDietitianProfile'));

test('account creation stops after Auth and never persists professional application data', () => {
  const source = service();
  const body = source.slice(source.indexOf('export const registerDietitian'), source.indexOf('export const completeDietitianRegistration'));
  const authIndex = body.indexOf('supabase.auth.signUp');

  assert.ok(authIndex >= 0, 'registration must create the Auth account first');
  assert.match(body, /first_name: data\.firstName\.trim\(\)/u);
  assert.match(body, /last_name: data\.lastName\.trim\(\)/u);
  assert.match(body, /account_type: 'dietitian'/u);
  assert.match(body, /role: 'dietitian'/u);
  assert.doesNotMatch(body, /persistCoreOnboardingFields|uploadDiplomaFile|persistDiplomaLink/u);
  assert.doesNotMatch(body, /data\.(?:phone|university|graduationYear|experienceYears|specialization|bio|diplomaFile)/u);
});

test('no session is successful email confirmation state before any profile or Storage continuation', () => {
  const body = service().slice(service().indexOf('export const registerDietitian'), service().indexOf('export const completeDietitianRegistration'));
  const noSessionIndex = body.indexOf('if (!authData.session)');
  const noSessionBlock = body.slice(noSessionIndex, body.indexOf('if (authData.session.user.id'));

  assert.ok(noSessionIndex >= 0);
  assert.match(noSessionBlock, /success: true/u);
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
  assert.match(body, /fullName: onboarding\.data\.fullName/u);
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
  const completionStart = source.indexOf('export const completeDietitianRegistration');
  const linkCall = source.indexOf('await persistDiplomaLink', completionStart);
  const linkFailureStart = source.lastIndexOf('try {', linkCall);
  const linkFailureBlock = source.slice(linkFailureStart, source.indexOf('return incompleteResult();', linkFailureStart) + 'return incompleteResult();'.length);

  assert.ok(linkCall > completionStart);
  assert.ok(linkFailureStart > completionStart);
  assert.match(linkFailureBlock, /isCanonicalDiplomaPath\(coreResult\.diplomaUrl/u);
  assert.match(linkFailureBlock, /removeCanonicalDiplomaFile\(authenticatedUser\.id\)/u);
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

test('register collects identity only while completion collects professional data exactly once', () => {
  const app = read('App.tsx');
  const page = read('features/auth/pages/CompleteRegistrationPage.tsx');
  const register = read('features/auth/pages/RegisterPage.tsx');
  const login = read('features/auth/pages/LoginPage.tsx');

  assert.match(app, /path="\/complete-registration"/u);
  assert.match(app, /ProtectedRoute allowIncomplete/u);
  assert.match(page, /completeDietitianRegistration/u);
  assert.match(page, /\{onboarding\.fullName\}/u);
  assert.match(page, /\{onboarding\.email\}/u);
  assert.match(page, /E-posta doğrulandı/u);
  assert.doesNotMatch(page, /completion-(?:first-name|last-name|email)/u);
  assert.doesNotMatch(page, /name="(?:firstName|lastName)"/u);
  for (const field of ['completion-phone', 'completion-university', 'completion-graduation-date', 'completion-experience-years', 'completion-specialization', 'completion-bio']) {
    assert.match(page, new RegExp(field, 'u'), `completion form missing professional field: ${field}`);
  }
  assert.match(page, /accept="application\/pdf"/u);
  assert.match(page, /await refreshAccess\(\)/u);
  assert.match(page, /navigate\('\/', \{ replace: true \}\)/u);
  assert.match(register, /result\.success && result\.status === 'email_confirmation_required'/u);
  assert.match(register, /E-posta adresinizi doğrulayın/u);
  assert.match(register, /result\.status === 'incomplete_profile'/u);
  assert.match(register, /navigate\('\/complete-registration'/u);
  for (const forbidden of ['register-phone', 'register-university', 'register-graduation-date', 'register-experience', 'register-specialization', 'register-bio', 'diploma-upload']) {
    assert.doesNotMatch(register, new RegExp(forbidden, 'u'), `register must not collect professional field: ${forbidden}`);
  }
  assert.match(login, /accessState\.status === 'incomplete_registration'/u);
});

test('registration UX uses a native graduation date while preserving the year-only backend contract', () => {
  const page = read('features/auth/pages/CompleteRegistrationPage.tsx');
  const serviceSource = service();

  assert.match(page, /<label htmlFor="completion-graduation-date"[^>]*>Mezuniyet Tarihi<\/label>/u);
  assert.match(page, /id="completion-graduation-date" name="graduationDate" type="date"/u);
  assert.match(page, /min=\{`\$\{MIN_GRADUATION_YEAR\}-01-01`\}/u);
  assert.match(page, /max=\{getTodayDateInputValue\(\)\}/u);
  assert.match(page, /required=\{onboarding\.graduationYear === null\}/u);
  assert.match(page, /getGraduationYearFromDate\(normalizedFormData\.graduationDate\)\s*\?\?\s*onboarding\.graduationYear/u);
  assert.match(page, /normalizedFormData\.graduationDate > todayDate/u);
  assert.match(page, /graduationYear: String\(graduationYear\)/u);
  assert.doesNotMatch(page, /new Date\([^)]*graduationDate/u);

  const payloadStart = page.indexOf('const payload: DietitianCompletionData');
  const payloadEnd = page.indexOf('const result = await completeDietitianRegistration', payloadStart);
  assert.ok(payloadStart >= 0 && payloadEnd > payloadStart);
  assert.doesNotMatch(page.slice(payloadStart, payloadEnd), /graduationDate/u);
  assert.doesNotMatch(serviceSource, /graduation_date/u);
});

test('registration UX exposes one shared password visibility toggle for both password inputs', () => {
  const page = read('features/auth/pages/RegisterPage.tsx');
  const passwordTypes = page.match(/type=\{showPasswords \? 'text' : 'password'\}/gu) || [];
  const visibilityLabels = page.match(/aria-label=\{showPasswords \? 'Şifreleri gizle' : 'Şifreleri göster'\}/gu) || [];

  assert.equal(passwordTypes.length, 2);
  assert.equal(visibilityLabels.length, 1);
  assert.match(page, /const \[showPasswords, setShowPasswords\] = useState\(false\)/u);
  assert.match(page, /<button[\s\S]*?type="button"[\s\S]*?aria-label=\{showPasswords \? 'Şifreleri gizle' : 'Şifreleri göster'\}/u);
  assert.match(page, /setShowPasswords\(previous => !previous\)/u);
  assert.match(page, /EyeOff[\s\S]*Eye/u);
  assert.match(page, /register-password"[^>]*className="[^"]*pr-12/u);

  const confirmationInputStart = page.indexOf('<input id="register-password-confirm"');
  const confirmationInputEnd = page.indexOf('/>', confirmationInputStart);
  assert.ok(confirmationInputStart >= 0 && confirmationInputEnd > confirmationInputStart);
  assert.doesNotMatch(page.slice(confirmationInputStart, confirmationInputEnd), /Eye|aria-label/u);
});

test('complete-registration is state-aware and all non-approved states remain fail-closed', () => {
  const route = read('shared/components/ProtectedRoute.tsx');
  const authService = read('features/auth/services/authService.ts');
  const authContext = read('features/auth/context/AuthContext.tsx');

  assert.match(route, /case 'allowed':[\s\S]*allowIncomplete \? <Navigate to="\/" replace \/> : <Outlet \/>/u);
  assert.match(route, /case 'incomplete_registration':[\s\S]*allowIncomplete \? <Outlet \/>/u);
  assert.match(route, /case 'pending':\s*case 'rejected':\s*return <VerificationStatusPage/u);
  assert.match(route, /case 'access_error':[\s\S]*<BlockedAccessState/u);
  assert.match(route, /case 'unauthenticated':[\s\S]*<Navigate to="\/login"/u);
  assert.match(authService, /if \(role === 'client'\)[\s\S]*status: 'blocked_client'/u);
  assert.match(authService, /verification === 'pending'[\s\S]*status: 'pending'/u);
  assert.match(authService, /verification === 'rejected'[\s\S]*status: 'rejected'/u);
  assert.match(authService, /verification !== 'approved'[\s\S]*status: 'access_error'/u);
  assert.match(authContext, /resolvedAccess\.status === 'blocked_client'[\s\S]*signOut/u);
});

test('legacy onboarding values are prefetched without using metadata for authorization', () => {
  const source = service();
  const onboardingBody = source.slice(
    source.indexOf('export const getCurrentDietitianOnboarding'),
    source.indexOf('interface CoreOnboardingInput'),
  );

  assert.match(onboardingBody, /profileData\.full_name\?\.trim\(\) \|\| metadataFullName/u);
  assert.match(onboardingBody, /row\?\.phone \|\| profileData\.phone \|\| getMetadataText\(metadata, 'phone'\)/u);
  assert.match(onboardingBody, /row\?\.university \|\| getMetadataText\(metadata, 'university'\)/u);
  assert.match(onboardingBody, /getMetadataNumber\(metadata, 'graduation_year', 'graduationYear'\)/u);
  assert.doesNotMatch(onboardingBody, /metadata[^\n]*(?:role|account_type)/u);
});

test('sensitive onboarding fields and diploma files are never browser-persisted', () => {
  const sources = [
    read('features/auth/pages/RegisterPage.tsx'),
    read('features/auth/pages/CompleteRegistrationPage.tsx'),
    service(),
  ].join('\n');

  assert.doesNotMatch(sources, /localStorage|sessionStorage/u);
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
