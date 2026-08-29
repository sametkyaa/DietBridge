'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

const profilePage = () => read('features/dietitians/pages/DietitianProfilePage.tsx');
const dietitianService = () => read('features/dietitians/services/dietitianService.ts');
const authService = () => read('features/auth/services/authService.ts');
const registerPage = () => read('features/auth/pages/RegisterPage.tsx');
const completeRegistrationPage = () => read('features/auth/pages/CompleteRegistrationPage.tsx');

test('dietitian profile keeps normal profile content without the visible diploma section', () => {
  const source = profilePage();

  assert.match(source, /Profilim/);
  assert.match(source, /Eğitim & Uzmanlık/);
  assert.match(source, /Hakkında/);
  assert.match(source, /profile\.first_name/);
  assert.match(source, /profile\.university/);
  assert.match(source, /profile\.experience_years/);
  assert.doesNotMatch(source, /Diploma/iu);
  assert.doesNotMatch(source, /diploma_url/);
  assert.doesNotMatch(source, /Görüntüle/);
  assert.doesNotMatch(source, /FileText|ArrowUpRight/);
});

test('profile data contract still carries diploma_url for legitimate application consumers', () => {
  const types = read('shared/types.ts');
  const auth = authService();

  assert.match(types, /interface DietitianProfile[\s\S]*diploma_url:\s*string/);
  assert.match(auth, /diploma_url\?:\s*string \| null/);
  assert.match(auth, /diploma_url:\s*row\.diploma_url \|\| ''/);
  assert.match(auth, /resolveVerificationStatus/);
});

test('authenticated onboarding keeps diploma handling out of account creation', () => {
  const service = dietitianService();
  const register = registerPage();
  const completion = completeRegistrationPage();

  assert.match(service, /export const uploadDiplomaFile/);
  assert.match(service, /DIETITIAN_DIPLOMA_BUCKET/);
  assert.match(service, /update\(\{ diploma_url: diplomaPath \}\)/);
  assert.match(service, /verification_status !== 'pending'/);
  assert.doesNotMatch(service, /is_verified:\s*false|verification_status:\s*'pending'/);
  assert.match(register, /registerDietitian\(payload\)/);
  assert.doesNotMatch(register, /diplomaFile|diploma-upload|application\/pdf/);
  assert.match(completion, /const \[diplomaFile, setDiplomaFile\]/);
  assert.match(completion, /completeDietitianRegistration\(payload\)/);
  assert.match(completion, /accept="application\/pdf"/);
});
