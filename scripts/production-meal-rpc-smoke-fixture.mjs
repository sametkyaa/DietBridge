#!/usr/bin/env node
/*
 * DietBridge production meal-completion RPC smoke fixture lifecycle.
 * Manual execution only. Every network mode is fail-closed behind explicit
 * production acknowledgements and targets only IDs stored in the TEMP manifest.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

export const MANIFEST_PATH = path.join(os.tmpdir(), 'dietbridge-production-meal-rpc-smoke-manifest.json');
export const FIXTURE_TYPE = 'production_meal_rpc_smoke';
export const PRODUCTION_ACK = 'I_UNDERSTAND_THIS_WRITES_DISPOSABLE_TEST_DATA';
export const EXIT = { OK: 0, INVALID: 2, ENVIRONMENT: 3, NETWORK: 4, SECURITY: 11, CLEANUP: 20, MANIFEST: 30, ORDER: 31 };

const COMMANDS = new Set(['preflight', 'setup', 'status', 'own-check', 'foreign-check', 'persistence-check', 'anonymous-check', 'cleanup']);
const CHECK_ORDER = ['own', 'foreign', 'persistence', 'anonymous'];
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function usage() {
  console.log('Usage: node .\\scripts\\production-meal-rpc-smoke-fixture.mjs <preflight|setup|status|own-check|foreign-check|persistence-check|anonymous-check|cleanup>');
}

function fail(code, message) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

export function redact(value) {
  return String(value ?? 'operation failed')
    .replace(/https:\/\/[^\s"']+/gi, '[redacted-url]')
    .replace(/(?:sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)/g, '[redacted-secret]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[redacted-id]')
    .replace(/[\w.+-]+@[\w.-]+/g, '[redacted-email]')
    .replace(/(?:password|token|key)\s*[=:]\s*[^\s,;]+/gi, '$1=[redacted-secret]');
}

function parseEnvFile(filePath, { optional = false } = {}) {
  if (!existsSync(filePath)) {
    if (optional) return {};
    fail(EXIT.ENVIRONMENT, 'Required local environment file is missing.');
  }
  const values = {};
  for (const line of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !match[1].startsWith('#')) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function projectRef(url) {
  return String(url ?? '').match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i)?.[1] ?? null;
}

function jwtRole(key) {
  if (!String(key ?? '').startsWith('eyJ')) return null;
  try {
    const encodedPayload = key.split('.')[1];
    if (!encodedPayload) return null;
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'))?.role ?? null;
  } catch {
    return null;
  }
}

function isAdminKey(key, publishableKey) {
  if (!key || key === publishableKey || key.startsWith('sb_publishable_')) return false;
  return key.startsWith('sb_secret_') || jwtRole(key) === 'service_role';
}

export function evaluateEnvironment(input) {
  const requiredEnvPresent = Boolean(
    input.productionUrl && input.publishableKey && input.adminKey && input.targetEnv && input.acknowledgment,
  );
  const productionRef = projectRef(input.productionUrl);
  const stagingRef = projectRef(input.stagingUrl);
  const environmentGuard = requiredEnvPresent
    && input.targetEnv === 'production'
    && input.acknowledgment === PRODUCTION_ACK
    && Boolean(productionRef)
    && (!input.stagingUrl || (Boolean(stagingRef) && stagingRef !== productionRef && input.stagingUrl !== input.productionUrl))
    && isAdminKey(input.adminKey, input.publishableKey);
  return { requiredEnvPresent, environmentGuard };
}

function loadSettings() {
  const production = parseEnvFile('.env');
  const staging = parseEnvFile('.env.staging.local', { optional: true });
  const settings = {
    productionUrl: production.VITE_SUPABASE_URL,
    publishableKey: production.VITE_SUPABASE_ANON_KEY,
    stagingUrl: staging.VITE_SUPABASE_URL,
    adminKey: process.env.DIETBRIDGE_PRODUCTION_ADMIN_KEY,
    targetEnv: process.env.DIETBRIDGE_TARGET_ENV,
    acknowledgment: process.env.DIETBRIDGE_PRODUCTION_SMOKE_ACK,
  };
  return { ...settings, ...evaluateEnvironment(settings) };
}

function requireProductionGuard(settings) {
  if (!settings.requiredEnvPresent || !settings.environmentGuard) {
    fail(EXIT.ENVIRONMENT, 'Production environment guard failed before network access.');
  }
}

export async function guardedNetworkAction(settings, action) {
  requireProductionGuard(settings);
  return action();
}

function createClients(settings) {
  requireProductionGuard(settings);
  const authOptions = { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false };
  return {
    admin: createClient(settings.productionUrl, settings.adminKey, { auth: authOptions }),
    user: () => createClient(settings.productionUrl, settings.publishableKey, { auth: authOptions }),
    anonymous: () => createClient(settings.productionUrl, settings.publishableKey, { auth: authOptions }),
  };
}

function assertNoError(result, label, code = EXIT.NETWORK) {
  if (result?.error) fail(code, `${label}: ${redact(result.error.message)}`);
  return result?.data;
}

function todayInIstanbul() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function newPassword() {
  return `Db!${randomBytes(30).toString('base64url')}9a`;
}

function newManifest() {
  const runId = `prod-rpc-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomBytes(6).toString('hex')}`;
  return {
    version: 1,
    fixtureType: FIXTURE_TYPE,
    runId,
    createdAt: new Date().toISOString(),
    planDate: todayInIstanbul(),
    clients: {
      a: { userId: null, email: `dietbridge-production-rpc-a-${randomUUID()}@example.invalid`, password: newPassword() },
      b: { userId: null, email: `dietbridge-production-rpc-b-${randomUUID()}@example.invalid`, password: newPassword() },
    },
    ids: { users: [], profiles: [], clientProfiles: [], plans: [], meals: [], mealA: null, mealB: null },
    expected: { planOwners: {}, mealPlans: {}, mealTitles: {}, mealAState: false },
    checks: { own: false, foreign: false, persistence: false, anonymous: false },
    mobile: { mobile_own_toggle_passed: false, mobile_persistence_passed: false, mobile_foreign_access_not_exposed: false },
  };
}

function validateManifest(manifest) {
  const valid = manifest?.version === 1
    && manifest?.fixtureType === FIXTURE_TYPE
    && typeof manifest?.runId === 'string'
    && manifest?.clients?.a && manifest?.clients?.b
    && Array.isArray(manifest?.ids?.users)
    && Array.isArray(manifest?.ids?.profiles)
    && Array.isArray(manifest?.ids?.clientProfiles)
    && Array.isArray(manifest?.ids?.plans)
    && Array.isArray(manifest?.ids?.meals)
    && manifest?.expected?.planOwners && manifest?.expected?.mealPlans && manifest?.expected?.mealTitles
    && CHECK_ORDER.every((check) => typeof manifest?.checks?.[check] === 'boolean')
    && Object.values(manifest.mobile ?? {}).length === 3
    && Object.values(manifest.mobile ?? {}).every((value) => typeof value === 'boolean');
  if (!valid) fail(EXIT.MANIFEST, 'Production fixture manifest is missing or invalid.');
  for (const id of [...manifest.ids.users, ...manifest.ids.profiles, ...manifest.ids.clientProfiles, ...manifest.ids.plans, ...manifest.ids.meals]) {
    if (!UUID_PATTERN.test(id)) fail(EXIT.MANIFEST, 'Production fixture manifest contains an invalid explicit ID.');
  }
  for (const identity of Object.values(manifest.clients)) {
    if (identity.userId !== null && (!UUID_PATTERN.test(identity.userId) || !manifest.ids.users.includes(identity.userId))) {
      fail(EXIT.MANIFEST, 'Production fixture identity does not match explicit user IDs.');
    }
  }
  for (const mealId of [manifest.ids.mealA, manifest.ids.mealB]) {
    if (mealId !== null && !manifest.ids.meals.includes(mealId)) fail(EXIT.MANIFEST, 'Production fixture meal pointer is invalid.');
  }
  return manifest;
}

function writeManifest(manifest) {
  validateManifest(manifest);
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) fail(EXIT.MANIFEST, 'Production fixture manifest is missing.');
  try {
    return validateManifest(JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')));
  } catch (error) {
    if (error.exitCode) throw error;
    fail(EXIT.MANIFEST, 'Production fixture manifest could not be read.');
  }
}

export function assertModeAllowed(mode, manifest) {
  const prerequisites = { 'own-check': [], 'foreign-check': ['own'], 'persistence-check': ['own', 'foreign'], 'anonymous-check': ['own', 'foreign', 'persistence'] };
  for (const prerequisite of prerequisites[mode] ?? []) {
    if (manifest?.checks?.[prerequisite] !== true) fail(EXIT.ORDER, `${mode} blocked by incomplete prerequisite.`);
  }
}

function snapshotWithoutCompletion(meal) {
  if (!meal) return null;
  const { is_eaten: _completion, ...rest } = meal;
  return rest;
}

function sameRecord(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function exactRow(admin, table, id, columns = '*') {
  return assertNoError(await admin.from(table).select(columns).eq('id', id).maybeSingle(), `${table} explicit row read`);
}

async function exactCount(admin, table, column, ids) {
  if (!ids.length) return 0;
  const { count, error } = await admin.from(table).select(column, { count: 'exact', head: true }).in(column, ids);
  assertNoError({ error }, `${table} explicit count`);
  return count ?? 0;
}

async function createFixtureUser(admin, manifest, key, label) {
  const identity = manifest.clients[key];
  const { data, error } = await admin.auth.admin.createUser({
    email: identity.email,
    password: identity.password,
    email_confirm: true,
    user_metadata: {
      account_type: 'client',
      full_name: `Disposable ${label}`,
      dietbridge_fixture_type: FIXTURE_TYPE,
      dietbridge_fixture_run_id: manifest.runId,
    },
  });
  assertNoError({ error }, `${label} Auth creation`);
  if (!data?.user?.id) fail(EXIT.NETWORK, `${label} Auth creation returned no ID.`);
  identity.userId = data.user.id;
  manifest.ids.users.push(data.user.id);
  manifest.ids.profiles.push(data.user.id);
  manifest.ids.clientProfiles.push(data.user.id);
  writeManifest(manifest);

  const profile = await exactRow(admin, 'profiles', data.user.id, 'id,role');
  const clientProfile = assertNoError(await admin.from('client_profiles').select('user_id').eq('user_id', data.user.id).maybeSingle(), `${label} client profile read`);
  if (profile?.role !== 'client' || clientProfile?.user_id !== data.user.id) fail(EXIT.SECURITY, `${label} onboarding trigger contract failed.`);
}

async function createPlanAndMeal(admin, manifest, key, label) {
  const clientId = manifest.clients[key].userId;
  const notes = `${FIXTURE_TYPE}:${manifest.runId}:${key}`;
  const plan = assertNoError(await admin.from('meal_plans')
    .insert({ client_id: clientId, dietitian_id: null, plan_date: manifest.planDate, notes })
    .select('id').single(), `${label} meal plan creation`);
  manifest.ids.plans.push(plan.id);
  manifest.expected.planOwners[plan.id] = clientId;
  writeManifest(manifest);

  const title = `${FIXTURE_TYPE}:${manifest.runId}:${key}`;
  const meal = assertNoError(await admin.from('meals')
    .insert({ plan_id: plan.id, type: 'breakfast', title, calories: 100, is_eaten: false, source: 'manual' })
    .select('*').single(), `${label} meal creation`);
  manifest.ids.meals.push(meal.id);
  manifest.expected.mealPlans[meal.id] = plan.id;
  manifest.expected.mealTitles[meal.id] = title;
  if (key === 'a') manifest.ids.mealA = meal.id;
  if (key === 'b') manifest.ids.mealB = meal.id;
  writeManifest(manifest);
}

async function verifyFixtureOwnership(admin, manifest) {
  const presentAuthIds = new Set();
  for (const userId of manifest.ids.users) {
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error?.status === 404 && error?.code === 'user_not_found') continue;
    assertNoError({ error }, 'Fixture Auth metadata verification', EXIT.CLEANUP);
    const metadata = data?.user?.user_metadata ?? {};
    if (metadata.dietbridge_fixture_type !== FIXTURE_TYPE || metadata.dietbridge_fixture_run_id !== manifest.runId) {
      fail(EXIT.CLEANUP, 'Fixture Auth metadata mismatch; cleanup stopped fail-closed.');
    }
    presentAuthIds.add(userId);
  }

  for (const userId of manifest.ids.profiles) {
    const profile = await exactRow(admin, 'profiles', userId, 'id');
    if (profile && !presentAuthIds.has(userId)) fail(EXIT.CLEANUP, 'Orphan profile cannot be proven as fixture-owned.');
  }
  for (const userId of manifest.ids.clientProfiles) {
    const row = assertNoError(await admin.from('client_profiles').select('user_id').eq('user_id', userId).maybeSingle(), 'Client profile ownership verification', EXIT.CLEANUP);
    if (row && !presentAuthIds.has(userId)) fail(EXIT.CLEANUP, 'Orphan client profile cannot be proven as fixture-owned.');
  }
  for (const planId of manifest.ids.plans) {
    const plan = await exactRow(admin, 'meal_plans', planId, 'id,client_id,notes');
    if (plan && (plan.client_id !== manifest.expected.planOwners[planId] || plan.notes !== `${FIXTURE_TYPE}:${manifest.runId}:${plan.client_id === manifest.clients.a.userId ? 'a' : 'b'}`)) {
      fail(EXIT.CLEANUP, 'Meal plan fixture marker mismatch; cleanup stopped fail-closed.');
    }
  }
  for (const mealId of manifest.ids.meals) {
    const meal = await exactRow(admin, 'meals', mealId, 'id,plan_id,title');
    if (meal && (meal.plan_id !== manifest.expected.mealPlans[mealId] || meal.title !== manifest.expected.mealTitles[mealId])) {
      fail(EXIT.CLEANUP, 'Meal fixture marker mismatch; cleanup stopped fail-closed.');
    }
  }
}

async function deleteOne(admin, table, column, id) {
  const { error } = await admin.from(table).delete().eq(column, id);
  assertNoError({ error }, `${table} explicit cleanup`, EXIT.CLEANUP);
}

export async function deleteExplicitFixtures(admin, manifest, { verifyOwnership = verifyFixtureOwnership } = {}) {
  await verifyOwnership(admin, manifest);
  for (const id of manifest.ids.meals) await deleteOne(admin, 'meals', 'id', id);
  for (const id of manifest.ids.plans) await deleteOne(admin, 'meal_plans', 'id', id);
  for (const id of manifest.ids.clientProfiles) await deleteOne(admin, 'client_profiles', 'user_id', id);
  for (const id of manifest.ids.profiles) await deleteOne(admin, 'profiles', 'id', id);
  for (const id of manifest.ids.users) {
    const { error } = await admin.auth.admin.deleteUser(id);
    if (error && !(error.status === 404 && error.code === 'user_not_found')) {
      fail(EXIT.CLEANUP, `Auth explicit cleanup failed: ${redact(error.message)}`);
    }
  }
}

async function explicitStatus(admin, manifest) {
  let authUsers = 0;
  for (const id of manifest.ids.users) {
    const { data, error } = await admin.auth.admin.getUserById(id);
    if (!error && data?.user) authUsers += 1;
    else if (!(error?.status === 404 && error?.code === 'user_not_found')) assertNoError({ error }, 'Auth explicit status');
  }
  return {
    authUsers,
    profiles: await exactCount(admin, 'profiles', 'id', manifest.ids.profiles),
    clientProfiles: await exactCount(admin, 'client_profiles', 'user_id', manifest.ids.clientProfiles),
    plans: await exactCount(admin, 'meal_plans', 'id', manifest.ids.plans),
    meals: await exactCount(admin, 'meals', 'id', manifest.ids.meals),
  };
}

function printGates(manifest) {
  const passed = CHECK_ORDER.every((check) => manifest.checks[check]);
  console.log(`RPC_SMOKE_TESTS_PASSED=${passed ? 'YES' : 'NO'}`);
  console.log('MOBILE_PRODUCTION_TEST_PENDING=YES');
  console.log('POLICY_REMOVAL_ALLOWED=NO');
}

async function setup(settings) {
  if (existsSync(MANIFEST_PATH)) fail(EXIT.MANIFEST, 'Existing production fixture manifest blocks setup.');
  const { admin } = createClients(settings);
  const manifest = newManifest();
  writeManifest(manifest);
  try {
    await createFixtureUser(admin, manifest, 'a', 'Client A');
    await createFixtureUser(admin, manifest, 'b', 'Client B');
    await createPlanAndMeal(admin, manifest, 'a', 'Client A');
    await createPlanAndMeal(admin, manifest, 'b', 'Client B');
    console.log('setup=PASS');
    console.log('fixture_clients=2');
    console.log('fixture_meal_plans=2');
    console.log('fixture_meals=2');
    console.log('manifest_written=YES');
  } catch (error) {
    try {
      await deleteExplicitFixtures(admin, manifest);
      if (existsSync(MANIFEST_PATH)) rmSync(MANIFEST_PATH, { force: true });
      console.error('partial_setup_cleanup=PASS');
    } catch (cleanupError) {
      console.error(`partial_setup_cleanup=FAIL; ${redact(cleanupError.message)}`);
      cleanupError.exitCode = EXIT.CLEANUP;
      throw cleanupError;
    }
    throw error;
  }
}

async function status(settings) {
  if (!existsSync(MANIFEST_PATH)) {
    requireProductionGuard(settings);
    console.log('manifest_present=NO');
    console.log('auth_users_present_count=0');
    console.log('profiles_present_count=0');
    console.log('client_profiles_present_count=0');
    console.log('meal_plans_present_count=0');
    console.log('meals_present_count=0');
    console.log('own_check_completed=NO');
    console.log('foreign_check_completed=NO');
    console.log('persistence_check_completed=NO');
    console.log('anonymous_check_completed=NO');
    console.log('cleanup_required=NO');
    console.log('RPC_SMOKE_TESTS_PASSED=NO');
    console.log('MOBILE_PRODUCTION_TEST_PENDING=YES');
    console.log('POLICY_REMOVAL_ALLOWED=NO');
    return;
  }
  const manifest = readManifest();
  const { admin } = createClients(settings);
  const counts = await explicitStatus(admin, manifest);
  console.log('manifest_present=YES');
  console.log(`auth_users_present_count=${counts.authUsers}`);
  console.log(`profiles_present_count=${counts.profiles}`);
  console.log(`client_profiles_present_count=${counts.clientProfiles}`);
  console.log(`meal_plans_present_count=${counts.plans}`);
  console.log(`meals_present_count=${counts.meals}`);
  for (const check of CHECK_ORDER) console.log(`${check}_check_completed=${manifest.checks[check] ? 'YES' : 'NO'}`);
  console.log(`cleanup_required=${Object.values(counts).some((count) => count > 0) ? 'YES' : 'NO'}`);
  printGates(manifest);
}

async function authenticatedClient(clients, identity) {
  const client = clients.user();
  const { error } = await client.auth.signInWithPassword({ email: identity.email, password: identity.password });
  assertNoError({ error }, 'Fixture client authentication');
  return client;
}

async function ownCheck(settings) {
  const manifest = readManifest();
  assertModeAllowed('own-check', manifest);
  const clients = createClients(settings);
  const client = await authenticatedClient(clients, manifest.clients.a);
  try {
    const beforeA = await exactRow(clients.admin, 'meals', manifest.ids.mealA);
    const beforeB = await exactRow(clients.admin, 'meals', manifest.ids.mealB);
    const rpc = await client.rpc('set_my_meal_completion', { p_meal_id: manifest.ids.mealA, p_is_eaten: true });
    const afterA = await exactRow(clients.admin, 'meals', manifest.ids.mealA);
    const afterB = await exactRow(clients.admin, 'meals', manifest.ids.mealB);
    const rpcPassed = !rpc.error && rpc.data === true;
    const persisted = afterA?.is_eaten === true;
    const unrelated = sameRecord(snapshotWithoutCompletion(beforeA), snapshotWithoutCompletion(afterA));
    const foreignUnchanged = sameRecord(beforeB, afterB);
    if (!rpcPassed || !persisted || !unrelated || !foreignUnchanged) fail(EXIT.SECURITY, 'Own RPC smoke contract failed.');
    manifest.checks.own = true;
    manifest.expected.mealAState = true;
    writeManifest(manifest);
    console.log('own_rpc_return=PASS');
    console.log('own_persistence=PASS');
    console.log('unrelated_columns_unchanged=PASS');
    console.log('foreign_row_unchanged=PASS');
  } finally {
    await client.auth.signOut().catch(() => undefined);
  }
}

async function foreignCheck(settings) {
  const manifest = readManifest();
  assertModeAllowed('foreign-check', manifest);
  const clients = createClients(settings);
  const client = await authenticatedClient(clients, manifest.clients.a);
  try {
    const before = await exactRow(clients.admin, 'meals', manifest.ids.mealB);
    const rpc = await client.rpc('set_my_meal_completion', { p_meal_id: manifest.ids.mealB, p_is_eaten: true });
    const after = await exactRow(clients.admin, 'meals', manifest.ids.mealB);
    if (!rpc.error || rpc.error.code !== '42501' || !sameRecord(before, after)) fail(EXIT.SECURITY, 'Foreign RPC rejection contract failed.');
    manifest.checks.foreign = true;
    writeManifest(manifest);
    console.log('foreign_rpc_rejected=PASS');
    console.log('foreign_persistence_unchanged=PASS');
  } finally {
    await client.auth.signOut().catch(() => undefined);
  }
}

async function persistenceCheck(settings) {
  const manifest = readManifest();
  assertModeAllowed('persistence-check', manifest);
  const clients = createClients(settings);
  const client = await authenticatedClient(clients, manifest.clients.a);
  try {
    const toFalse = await client.rpc('set_my_meal_completion', { p_meal_id: manifest.ids.mealA, p_is_eaten: false });
    const falseRow = await exactRow(clients.admin, 'meals', manifest.ids.mealA, 'id,is_eaten');
    const toTrue = await client.rpc('set_my_meal_completion', { p_meal_id: manifest.ids.mealA, p_is_eaten: true });
    const trueRow = await exactRow(clients.admin, 'meals', manifest.ids.mealA, 'id,is_eaten');
    if (toFalse.error || toFalse.data !== true || falseRow?.is_eaten !== false || toTrue.error || toTrue.data !== true || trueRow?.is_eaten !== true) {
      fail(EXIT.SECURITY, 'Persistence toggle contract failed.');
    }
    manifest.checks.persistence = true;
    manifest.expected.mealAState = true;
    writeManifest(manifest);
    console.log('toggle_false_persisted=PASS');
    console.log('toggle_true_persisted=PASS');
  } finally {
    await client.auth.signOut().catch(() => undefined);
  }
}

async function anonymousCheck(settings) {
  const manifest = readManifest();
  assertModeAllowed('anonymous-check', manifest);
  const clients = createClients(settings);
  const anonymous = clients.anonymous();
  const before = await exactRow(clients.admin, 'meals', manifest.ids.mealA);
  const rpc = await anonymous.rpc('set_my_meal_completion', { p_meal_id: manifest.ids.mealA, p_is_eaten: false });
  const after = await exactRow(clients.admin, 'meals', manifest.ids.mealA);
  if (!rpc.error || !rpc.error.code || !sameRecord(before, after)) fail(EXIT.SECURITY, 'Anonymous RPC rejection contract failed.');
  manifest.checks.anonymous = true;
  writeManifest(manifest);
  console.log('anonymous_rpc_rejected=PASS');
  console.log('anonymous_persistence_unchanged=PASS');
  printGates(manifest);
}

async function cleanup(settings) {
  const manifest = readManifest();
  const { admin } = createClients(settings);
  await deleteExplicitFixtures(admin, manifest);
  const counts = await explicitStatus(admin, manifest);
  if (Object.values(counts).some((count) => count !== 0)) fail(EXIT.CLEANUP, 'Explicit fixture records remain after cleanup.');
  rmSync(MANIFEST_PATH, { force: true });
  console.log('cleanup=PASS');
  console.log('remaining_fixture_records=0');
  console.log(`manifest_removed=${existsSync(MANIFEST_PATH) ? 'NO' : 'YES'}`);
}

function preflight() {
  let settings;
  try {
    settings = loadSettings();
  } catch {
    settings = { requiredEnvPresent: false, environmentGuard: false };
  }
  console.log(`environment_guard=${settings.environmentGuard ? 'PASS' : 'FAIL'}`);
  console.log(`required_env_present=${settings.requiredEnvPresent ? 'YES' : 'NO'}`);
  console.log(`manifest_present=${existsSync(MANIFEST_PATH) ? 'YES' : 'NO'}`);
  console.log('network_call_executed=NO');
  if (!settings.environmentGuard) process.exitCode = EXIT.ENVIRONMENT;
}

async function main() {
  const command = process.argv[2];
  if (!COMMANDS.has(command)) {
    usage();
    process.exitCode = EXIT.INVALID;
    return;
  }
  if (command === 'preflight') {
    preflight();
    return;
  }
  const settings = loadSettings();
  requireProductionGuard(settings);
  if (command === 'setup') await setup(settings);
  if (command === 'status') await status(settings);
  if (command === 'own-check') await ownCheck(settings);
  if (command === 'foreign-check') await foreignCheck(settings);
  if (command === 'persistence-check') await persistenceCheck(settings);
  if (command === 'anonymous-check') await anonymousCheck(settings);
  if (command === 'cleanup') await cleanup(settings);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`production_smoke_fixture=STOPPED; reason=${redact(error.message)}`);
    process.exitCode = error.exitCode ?? 1;
  });
}
