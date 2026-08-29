#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = mkdtempSync(join(tmpdir(), 'dietbridge-registration-reliability-'));
const tscCli = join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc');
const sources = [
  'features/dietitians/services/dietitianService.ts',
  'features/auth/utils/registrationCompleteness.ts',
  'shared/types.ts',
  'shared/utils/avatarUrl.ts',
  'shared/utils/uuid.ts',
];

const SUPABASE_CLIENT_STUB = String.raw`'use strict';
const assert = require('node:assert/strict');

const DEFAULT_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'dietitian@example.test',
  user_metadata: { first_name: 'Ada', last_name: 'Diyetisyen', full_name: 'Ada Diyetisyen' },
};
const clone = (value) => value === null || value === undefined ? value : JSON.parse(JSON.stringify(value));

const state = {};

const resetState = (options = {}) => {
  state.user = clone(DEFAULT_USER);
  state.session = options.session === false ? null : { user: clone(DEFAULT_USER) };
  state.signUpError = null;
  state.signUpSession = options.signUpSession !== false;
  state.authUserError = null;
  state.sessionError = null;
  state.baseProfile = {
    id: DEFAULT_USER.id,
    email: DEFAULT_USER.email,
    full_name: 'Ada Diyetisyen',
    phone: null,
    role: 'dietitian',
  };
  state.dietitianProfile = {
    user_id: DEFAULT_USER.id,
    phone: null,
    university: null,
    graduation_year: null,
    experience_years: null,
    specialization: null,
    bio: null,
    diploma_url: null,
    is_verified: false,
    verification_status: 'pending',
    verified_at: null,
    rejection_reason: null,
  };
  state.failBaseUpdate = false;
  state.failDietitianUpsert = false;
  state.failDiplomaLink = false;
  state.failUpload = false;
  state.failCleanup = false;
  state.storageObject = null;
  state.mutations = [];
  state.signUpCalls = 0;
  state.signUpPayload = null;
  state.uploadCalls = 0;
  state.cleanupCalls = 0;
  Object.assign(state, options);
  if (options.dietitianProfile !== undefined) state.dietitianProfile = clone(options.dietitianProfile);
  if (options.baseProfile !== undefined) state.baseProfile = clone(options.baseProfile);
  if (options.session === false) state.session = null;
};

const executeQuery = (query) => {
  if (query.operation === 'select') {
    if (query.table === 'profiles') return { data: clone(state.baseProfile), error: null };
    if (query.table === 'dietitian_profiles') return { data: clone(state.dietitianProfile), error: null };
  }

  if (query.table === 'profiles' && query.operation === 'update') {
    state.mutations.push('profiles.update');
    if (state.failBaseUpdate) return { data: null, error: { message: 'base update failed' } };
    Object.assign(state.baseProfile, clone(query.payload));
    return { data: { id: state.baseProfile.id }, error: null };
  }

  if (query.table === 'dietitian_profiles' && query.operation === 'upsert') {
    state.mutations.push('dietitian_profiles.upsert');
    if (state.failDietitianUpsert) return { data: null, error: { message: 'dietitian upsert failed' } };
    if (!state.dietitianProfile) {
      state.dietitianProfile = {
        user_id: state.user.id,
        is_verified: false,
        verification_status: 'pending',
        verified_at: null,
        rejection_reason: null,
      };
    }
    Object.assign(state.dietitianProfile, clone(query.payload));
    return { data: { user_id: state.dietitianProfile.user_id, diploma_url: state.dietitianProfile.diploma_url || null }, error: null };
  }

  if (query.table === 'dietitian_profiles' && query.operation === 'update') {
    state.mutations.push('dietitian_profiles.update');
    if (state.failDiplomaLink) return { data: null, error: { message: 'diploma link failed' } };
    Object.assign(state.dietitianProfile, clone(query.payload));
    return { data: { user_id: state.dietitianProfile.user_id }, error: null };
  }

  return { data: null, error: { message: 'unsupported query' } };
};

const queryBuilder = (table) => {
  const query = { table, operation: 'select', payload: null };
  return {
    select() { return this; },
    eq() { return this; },
    update(payload) { query.operation = 'update'; query.payload = payload; return this; },
    upsert(payload) { query.operation = 'upsert'; query.payload = payload; return this; },
    maybeSingle() { return Promise.resolve(executeQuery(query)); },
    single() { return Promise.resolve(executeQuery(query)); },
  };
};

const supabase = {
  auth: {
    async signUp(payload) {
      state.signUpCalls += 1;
      state.signUpPayload = clone(payload);
      if (state.signUpError) return { data: { user: null, session: null }, error: state.signUpError };
      state.user = {
        ...clone(DEFAULT_USER),
        email: payload.email,
        user_metadata: clone(payload.options?.data || {}),
      };
      state.session = state.signUpSession ? { user: clone(state.user) } : null;
      return { data: { user: clone(state.user), session: clone(state.session) }, error: null };
    },
    async getUser() {
      return { data: { user: clone(state.user) }, error: state.authUserError };
    },
    async getSession() {
      return { data: { session: clone(state.session) }, error: state.sessionError };
    },
  },
  from(table) {
    return queryBuilder(table);
  },
  storage: {
    from(bucket) {
      assert.equal(bucket, 'dietitian-diplomas');
      return {
        async upload(objectPath) {
          state.uploadCalls += 1;
          if (state.failUpload) return { error: { message: 'upload failed' } };
          state.storageObject = objectPath;
          return { error: null };
        },
        async remove(paths) {
          state.cleanupCalls += 1;
          assert.deepEqual(paths, ['diplomas/11111111-1111-4111-8111-111111111111/diploma.pdf']);
          if (state.failCleanup) return { error: { message: 'cleanup failed' } };
          state.storageObject = null;
          return { error: null };
        },
      };
    },
  },
};

resetState();
module.exports = { supabase, __testState: state, resetState };
`;

const fail = (message) => {
  rmSync(buildDir, { recursive: true, force: true });
  throw new Error(`[registration-reliability-runtime] ${message}`);
};

try {
  if (!existsSync(tscCli)) fail('TypeScript compiler not found. Run `npm ci` first.');

  const compile = spawnSync(process.execPath, [
    tscCli,
    ...sources,
    '--module', 'commonjs',
    '--target', 'es2022',
    '--lib', 'es2022,dom',
    '--skipLibCheck',
    '--noResolve',
    '--outDir', buildDir,
  ], { cwd: repoRoot, encoding: 'utf8' });
  const diagnostics = `${compile.stdout ?? ''}${compile.stderr ?? ''}`
    .split(/\r?\n/u)
    .map(line => line.trim())
    .filter(Boolean);
  const unexpectedDiagnostics = diagnostics.filter(line => !line.includes('error TS2307'));
  if (unexpectedDiagnostics.length > 0) fail(`unexpected TypeScript diagnostics:\n${unexpectedDiagnostics.join('\n')}`);

  const stubDir = join(buildDir, 'lib');
  mkdirSync(stubDir, { recursive: true });
  writeFileSync(join(stubDir, 'supabaseClient.js'), SUPABASE_CLIENT_STUB, 'utf8');

  const requireFromBuild = createRequire(join(buildDir, 'runtime.cjs'));
  const { __testState: state, resetState } = requireFromBuild('./lib/supabaseClient.js');
  const service = requireFromBuild('./features/dietitians/services/dietitianService.js');
  const { registerDietitian, completeDietitianRegistration, getCurrentDietitianOnboarding } = service;
  const diplomaFile = { type: 'application/pdf', size: 3 };
  const registrationData = {
    email: 'dietitian@example.test',
    password: 'strong-password',
    firstName: 'Ada',
    lastName: 'Diyetisyen',
  };
  const completionData = {
    phone: '+90 555 000 00 00',
    university: 'Hacettepe Üniversitesi',
    graduationYear: '2020',
    experienceYears: '3',
    specialization: 'Klinik Beslenme',
    bio: 'Beslenme danışmanlığı.',
    diplomaFile,
  };
  const canonicalPath = 'diplomas/11111111-1111-4111-8111-111111111111/diploma.pdf';

  resetState({ signUpError: { message: 'signup failed' } });
  let result = await registerDietitian(registrationData);
  assert.equal(result.status, 'failed');
  assert.deepEqual(state.mutations, []);
  assert.equal(state.uploadCalls, 0);

  resetState({ signUpSession: false });
  result = await registerDietitian(registrationData);
  assert.equal(result.success, true);
  assert.equal(result.status, 'email_confirmation_required');
  assert.deepEqual(state.mutations, []);
  assert.equal(state.uploadCalls, 0);
  assert.deepEqual(state.signUpPayload.options.data, {
    first_name: 'Ada',
    last_name: 'Diyetisyen',
    full_name: 'Ada Diyetisyen',
    account_type: 'dietitian',
    role: 'dietitian',
  });
  assert.equal('phone' in state.signUpPayload.options.data, false);

  resetState();
  result = await registerDietitian(registrationData);
  assert.equal(result.success, true);
  assert.equal(result.status, 'incomplete_profile');
  assert.deepEqual(state.mutations, []);
  assert.equal(state.uploadCalls, 0);

  resetState({ failBaseUpdate: true });
  result = await completeDietitianRegistration(completionData);
  assert.equal(result.status, 'incomplete_profile');
  assert.equal(state.uploadCalls, 0);

  resetState({ failDietitianUpsert: true });
  result = await completeDietitianRegistration(completionData);
  assert.equal(result.status, 'incomplete_profile');
  assert.equal(state.uploadCalls, 0);

  resetState({ failUpload: true });
  result = await completeDietitianRegistration(completionData);
  assert.equal(result.status, 'incomplete_profile');
  assert.equal(state.uploadCalls, 1);
  assert.equal(state.mutations.includes('dietitian_profiles.update'), false);

  resetState({ failDiplomaLink: true });
  result = await completeDietitianRegistration(completionData);
  assert.equal(result.status, 'incomplete_profile');
  assert.equal(state.uploadCalls, 1);
  assert.equal(state.cleanupCalls, 1);
  assert.equal(state.storageObject, null);

  state.failDiplomaLink = false;
  result = await completeDietitianRegistration(completionData);
  assert.equal(result.success, true);
  assert.equal(result.status, 'complete');
  assert.equal(state.signUpCalls, 0);
  assert.equal(state.uploadCalls, 2);
  assert.equal(state.storageObject, canonicalPath);
  assert.equal(state.dietitianProfile.diploma_url, canonicalPath);
  assert.equal(state.dietitianProfile.verification_status, 'pending');
  assert.equal(state.dietitianProfile.is_verified, false);

  resetState({ dietitianProfile: null });
  result = await completeDietitianRegistration(completionData);
  assert.equal(result.success, true);
  assert.equal(state.signUpCalls, 0);
  assert.equal(state.dietitianProfile.verification_status, 'pending');
  assert.equal(state.dietitianProfile.is_verified, false);

  for (const verificationStatus of ['approved', 'rejected']) {
    resetState({ dietitianProfile: {
      user_id: state.user.id,
      is_verified: verificationStatus === 'approved',
      verification_status: verificationStatus,
      diploma_url: canonicalPath,
    } });
    result = await completeDietitianRegistration(completionData);
    assert.equal(result.status, 'failed');
    assert.deepEqual(state.mutations, []);
    assert.equal(state.uploadCalls, 0);
  }

  resetState({ baseProfile: { id: state.user.id, email: state.user.email, full_name: 'Danışan', role: 'client' } });
  result = await completeDietitianRegistration(completionData);
  assert.equal(result.success, false);
  assert.deepEqual(state.mutations, []);
  assert.equal(state.uploadCalls, 0);

  resetState({
    user: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'dietitian@example.test',
      user_metadata: {
        first_name: 'Legacy',
        last_name: 'Diyetisyen',
        phone: '+90 555 111 11 11',
        university: 'Legacy Üniversitesi',
        graduation_year: '2018',
        experience_years: '6',
        specialization: 'Legacy Uzmanlık',
        bio: 'Legacy biyografi',
      },
    },
    baseProfile: {
      id: '11111111-1111-4111-8111-111111111111',
      email: 'dietitian@example.test',
      full_name: null,
      phone: null,
      role: 'dietitian',
    },
    dietitianProfile: {
      user_id: '11111111-1111-4111-8111-111111111111',
      phone: null,
      university: 'Persisted Üniversite',
      graduation_year: null,
      experience_years: null,
      specialization: null,
      bio: null,
      diploma_url: null,
      is_verified: false,
      verification_status: 'pending',
    },
  });
  const onboarding = await getCurrentDietitianOnboarding();
  assert.equal(onboarding.success, true);
  assert.equal(onboarding.data.fullName, 'Legacy Diyetisyen');
  assert.equal(onboarding.data.phone, '+90 555 111 11 11');
  assert.equal(onboarding.data.university, 'Persisted Üniversite');
  assert.equal(onboarding.data.graduationYear, 2018);
  assert.equal(onboarding.data.experienceYears, 6);
  assert.equal(onboarding.data.specialization, 'Legacy Uzmanlık');
  assert.equal(onboarding.data.bio, 'Legacy biyografi');

  process.stdout.write('REGISTRATION_RELIABILITY_RUNTIME_PASS\n');
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}
