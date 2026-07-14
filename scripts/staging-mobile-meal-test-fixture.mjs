#!/usr/bin/env node
/*
 * DietBridge staging-only mobile meal completion fixture lifecycle.
 * Run manually only after loading the required staging-only environment variables.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const COMMANDS = new Set(['setup', 'status', 'foreign-check', 'cleanup']);
const CONFIRMATION = 'YES_DIETBRIDGE_STAGING_MOBILE_ONLY';
const MANIFEST_PATH = path.join(os.tmpdir(), 'dietbridge-staging-mobile-meal-test-manifest.json');
const TABLES = ['profiles', 'client_profiles', 'dietitian_profiles', 'dietitian_clients', 'appointments', 'chat_messages', 'meal_plans', 'meals'];
const EXIT = { OK: 0, INVALID: 2, ENVIRONMENT: 3, PREFLIGHT: 4, FOREIGN_REJECTED: 10, SECURITY_BLOCKER: 11, CLEANUP: 20, MANIFEST: 30 };

function usage() {
  console.log('Usage: node .\\scripts\\staging-mobile-meal-test-fixture.mjs <setup|status|foreign-check|cleanup>');
}

function fail(code, message) {
  const error = new Error(message);
  error.exitCode = code;
  throw error;
}

function redact(value) {
  return String(value ?? 'unknown error')
    .replace(/https:\/\/[^\s"']+/g, '[redacted-url]')
    .replace(/(?:sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)/g, '[redacted-secret]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[redacted-id]')
    .replace(/[\w.+-]+@[\w.-]+/g, '[redacted-email]');
}

function parseEnv(file) {
  const values = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (match && !match[1].startsWith('#')) values[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return values;
}

function projectRef(url) {
  const match = url?.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i);
  if (!match) fail(EXIT.INVALID, 'Staging Supabase URL formatı geçersiz.');
  return match[1];
}

function getSettings() {
  const staging = parseEnv('.env.staging.local');
  const production = parseEnv('.env');
  const url = staging.VITE_SUPABASE_URL;
  const publishableKey = staging.VITE_SUPABASE_ANON_KEY;
  if (!url || !publishableKey) fail(EXIT.INVALID, 'Staging URL veya publishable key eksik.');
  const stagingRef = projectRef(url);
  const productionRef = projectRef(production.VITE_SUPABASE_URL);
  if (!production.VITE_SUPABASE_URL || url === production.VITE_SUPABASE_URL || stagingRef === productionRef || /groundless/i.test(stagingRef)) {
    fail(EXIT.ENVIRONMENT, 'Staging/production ayrımı doğrulanamadı veya kapsam dışı proje reddedildi.');
  }
  return { url, publishableKey, stagingRef };
}

function requireAdmin(settings) {
  const adminKey = process.env.DIETBRIDGE_STAGING_ADMIN_KEY;
  if (!adminKey || process.env.DIETBRIDGE_CONFIRM_STAGING_MOBILE_TESTS !== CONFIRMATION) {
    fail(EXIT.INVALID, 'Gerekli staging admin environment onayı eksik.');
  }
  if (adminKey === settings.publishableKey || adminKey.startsWith('sb_publishable_')) {
    fail(EXIT.INVALID, 'Publishable key admin key olarak kullanılamaz.');
  }
  return createClient(settings.url, adminKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function requirePassword() {
  const password = process.env.DIETBRIDGE_STAGING_TEST_CLIENT_PASSWORD;
  if (!password) fail(EXIT.INVALID, 'Geçici staging client password eksik.');
  return password;
}

function assertNoError(result, label) {
  if (result?.error) fail(1, `${label}: ${redact(result.error.message)}`);
  return result?.data;
}

function todayInIstanbul() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const value = Object.fromEntries(parts.filter(({ type }) => type !== 'literal').map(({ type, value: part }) => [type, part]));
  return `${value.year}-${value.month}-${value.day}`;
}

function newManifest() {
  const runId = `db-mobile-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomBytes(4).toString('hex')}`;
  return {
    version: 1,
    runId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    planDate: todayInIstanbul(),
    clientLoginEmail: null,
    ownMealLabel: `DietBridge staging own meal ${runId}`,
    ids: { users: [], relations: [], plans: [], meals: [], ownMealId: null, foreignMealId: null },
    startingAggregate: null,
  };
}

function writeManifest(manifest) {
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

function readManifest() {
  if (!existsSync(MANIFEST_PATH)) fail(EXIT.MANIFEST, 'Fixture manifest bulunamadı.');
  try {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, 'utf8'));
    if (manifest?.version !== 1 || !manifest?.ids || !Array.isArray(manifest.ids.users) || !Array.isArray(manifest.ids.meals)) {
      fail(EXIT.MANIFEST, 'Fixture manifest bozuk.');
    }
    return manifest;
  } catch (error) {
    if (error.exitCode) throw error;
    fail(EXIT.MANIFEST, 'Fixture manifest okunamadı.');
  }
}

async function aggregate(admin) {
  const users = assertNoError(await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'Auth aggregate');
  let publicRows = 0;
  for (const table of TABLES) {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true });
    assertNoError({ error }, `${table} aggregate`);
    publicRows += count ?? 0;
  }
  const buckets = assertNoError(await admin.storage.listBuckets(), 'Storage aggregate');
  return { authUsers: users?.users?.length ?? 0, publicRows, storageBuckets: buckets?.length ?? 0 };
}

async function preflight(admin) {
  const state = await aggregate(admin);
  if (state.authUsers || state.publicRows || state.storageBuckets) {
    fail(EXIT.PREFLIGHT, 'Staging başlangıç durumu boş değil; hiçbir fixture oluşturulmadı.');
  }
  return state;
}

async function createUser(admin, manifest, label, accountType, password) {
  const email = `dietbridge-staging-mobile-${label.toLowerCase().replaceAll(' ', '-')}-${manifest.runId}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { account_type: accountType, full_name: `Synthetic ${label}` },
  });
  assertNoError({ error }, `${label} Auth user`);
  if (!data?.user?.id) fail(1, `${label} Auth user ID dönmedi.`);
  manifest.ids.users.push(data.user.id);
  writeManifest(manifest);
  return { id: data.user.id, email };
}

async function verifyOnboarding(admin, user, expectedRole, label) {
  const profile = assertNoError(await admin.from('profiles').select('id, role').eq('id', user.id).maybeSingle(), `${label} profile`);
  if (!profile || profile.role !== expectedRole) fail(1, `${label} onboarding doğrulanamadı.`);
  if (expectedRole === 'client') {
    const clientProfile = assertNoError(await admin.from('client_profiles').select('user_id').eq('user_id', user.id).maybeSingle(), `${label} client profile`);
    if (!clientProfile) fail(1, `${label} client profile doğrulanamadı.`);
  }
}

async function createRelation(admin, manifest, dietitianId, clientId) {
  const relation = assertNoError(await admin.from('dietitian_clients')
    .insert({ dietitian_id: dietitianId, client_id: clientId, status: 'active', accepted_at: new Date().toISOString() })
    .select('id').single(), 'Active relationship');
  manifest.ids.relations.push(relation.id);
  writeManifest(manifest);
}

async function createPlanAndMeal(admin, manifest, dietitianId, clientId, title) {
  const plan = assertNoError(await admin.from('meal_plans')
    .insert({ dietitian_id: dietitianId, client_id: clientId, plan_date: manifest.planDate, notes: manifest.runId })
    .select('id').single(), 'Meal plan fixture');
  manifest.ids.plans.push(plan.id);
  writeManifest(manifest);
  const meal = assertNoError(await admin.from('meals')
    .insert({ plan_id: plan.id, type: 'breakfast', title, calories: 100, is_eaten: false })
    .select('id').single(), 'Meal fixture');
  manifest.ids.meals.push(meal.id);
  writeManifest(manifest);
  return meal.id;
}

async function deleteExplicitFixtures(admin, manifest) {
  const removeRows = async (table, ids) => {
    if (!ids?.length) return;
    const { error } = await admin.from(table).delete().in('id', ids);
    assertNoError({ error }, `${table} cleanup`);
  };
  await removeRows('meals', manifest.ids.meals);
  await removeRows('meal_plans', manifest.ids.plans);
  await removeRows('dietitian_clients', manifest.ids.relations);
  for (const userId of manifest.ids.users) {
    const { error } = await admin.auth.admin.deleteUser(userId);
    assertNoError({ error }, 'Auth user cleanup');
  }
}

async function cleanupAndVerify(admin, manifest, removeManifest) {
  try {
    await deleteExplicitFixtures(admin, manifest);
    const state = await aggregate(admin);
    if (state.authUsers || state.publicRows || state.storageBuckets) fail(EXIT.CLEANUP, 'Cleanup sonrası aggregate sıfır değil.');
    if (removeManifest && existsSync(MANIFEST_PATH)) rmSync(MANIFEST_PATH, { force: true });
    return state;
  } catch (error) {
    if (!error.exitCode) error.exitCode = EXIT.CLEANUP;
    throw error;
  }
}

async function setup(settings) {
  if (existsSync(MANIFEST_PATH)) fail(EXIT.MANIFEST, 'Mevcut fixture manifest bulundu; yeni setup öncesi cleanup çalıştırın.');
  const password = requirePassword();
  const admin = requireAdmin(settings);
  const manifest = newManifest();
  try {
    manifest.startingAggregate = await preflight(admin);
    writeManifest(manifest);
    const dietitian = await createUser(admin, manifest, 'Dietitian A', 'dietitian', password);
    const clientA = await createUser(admin, manifest, 'Client A', 'client', password);
    const clientB = await createUser(admin, manifest, 'Client B', 'client', password);
    await verifyOnboarding(admin, dietitian, 'dietitian', 'Dietitian A');
    await verifyOnboarding(admin, clientA, 'client', 'Client A');
    await verifyOnboarding(admin, clientB, 'client', 'Client B');
    await createRelation(admin, manifest, dietitian.id, clientA.id);
    await createRelation(admin, manifest, dietitian.id, clientB.id);
    manifest.ids.ownMealId = await createPlanAndMeal(admin, manifest, dietitian.id, clientA.id, manifest.ownMealLabel);
    manifest.ids.foreignMealId = await createPlanAndMeal(admin, manifest, dietitian.id, clientB.id, `DietBridge staging foreign meal ${manifest.runId}`);
    manifest.clientLoginEmail = clientA.email;
    writeManifest(manifest);
    console.log(`Setup: PASS\nClient login email: ${manifest.clientLoginEmail}\nOwn meal label: ${manifest.ownMealLabel}\nForeign test fixture: READY\nManifest: ${MANIFEST_PATH}\nExpires: ${manifest.expiresAt}`);
  } catch (error) {
    try {
      await cleanupAndVerify(admin, manifest, true);
    } catch (cleanupError) {
      console.error(`Partial setup cleanup failed: ${redact(cleanupError.message)}`);
      cleanupError.exitCode = EXIT.CLEANUP;
      throw cleanupError;
    }
    throw error;
  }
}

async function status(settings) {
  const admin = requireAdmin(settings);
  const manifest = readManifest();
  const users = assertNoError(await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'Fixture Auth status');
  const userIds = new Set((users?.users ?? []).map((user) => user.id));
  const presentUsers = manifest.ids.users.filter((id) => userIds.has(id)).length;
  const countPresent = async (table, ids) => {
    if (!ids?.length) return 0;
    const { count, error } = await admin.from(table).select('id', { count: 'exact', head: true }).in('id', ids);
    assertNoError({ error }, `${table} fixture status`);
    return count ?? 0;
  };
  const rowsPresent = (await Promise.all([
    countPresent('dietitian_clients', manifest.ids.relations),
    countPresent('meal_plans', manifest.ids.plans),
    countPresent('meals', manifest.ids.meals),
  ])).reduce((sum, count) => sum + count, 0);
  const expectedRows = manifest.ids.relations.length + manifest.ids.plans.length + manifest.ids.meals.length;
  const ownMeal = assertNoError(await admin.from('meals').select('is_eaten').eq('id', manifest.ids.ownMealId).maybeSingle(), 'Own meal status');
  const foreignMeal = assertNoError(await admin.from('meals').select('is_eaten').eq('id', manifest.ids.foreignMealId).maybeSingle(), 'Foreign meal status');
  const state = presentUsers === manifest.ids.users.length && rowsPresent === expectedRows && ownMeal && foreignMeal
    ? 'ACTIVE' : (presentUsers || rowsPresent || ownMeal || foreignMeal ? 'PARTIAL' : 'MISSING');
  console.log(`Fixture status: ${state}\nClient A own meal is_eaten: ${ownMeal?.is_eaten === true ? 'true' : 'false'}\nClient B foreign meal unchanged: ${foreignMeal?.is_eaten === false ? 'YES' : 'NO'}\nCreated Auth users present: ${presentUsers}/${manifest.ids.users.length}\nCreated fixture rows present: ${rowsPresent}/${expectedRows}\nManifest expired: ${Date.now() > Date.parse(manifest.expiresAt) ? 'YES' : 'NO'}`);
}

async function foreignCheck(settings) {
  const password = requirePassword();
  const admin = requireAdmin(settings);
  const manifest = readManifest();
  if (!manifest.clientLoginEmail || !manifest.ids.foreignMealId) fail(EXIT.MANIFEST, 'Foreign-check için gerekli fixture bilgisi eksik.');
  const client = createClient(settings.url, settings.publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  try {
    const { error: signInError } = await client.auth.signInWithPassword({ email: manifest.clientLoginEmail, password });
    assertNoError({ error: signInError }, 'Client A login');
    const { error: rpcError } = await client.rpc('set_my_meal_completion', { p_meal_id: manifest.ids.foreignMealId, p_is_eaten: true });
    const foreignMeal = assertNoError(await admin.from('meals').select('is_eaten').eq('id', manifest.ids.foreignMealId).maybeSingle(), 'Foreign meal admin verification');
    const unchanged = foreignMeal?.is_eaten === false;
    if (rpcError && unchanged) {
      console.log('Foreign meal RPC: REJECTED\nForeign meal unchanged: YES\nResult: PASS');
      process.exitCode = EXIT.FOREIGN_REJECTED;
      return;
    }
    console.log('Foreign meal RPC: NOT REJECTED\nForeign meal unchanged: NO\nResult: FAIL — P0/P1 SECURITY BLOCKER');
    process.exitCode = EXIT.SECURITY_BLOCKER;
  } finally {
    await client.auth.signOut().catch(() => undefined);
  }
}

async function cleanup(settings) {
  const admin = requireAdmin(settings);
  const manifest = readManifest();
  const state = await cleanupAndVerify(admin, manifest, true);
  console.log(`Cleanup: PASS\nFinal Auth users: ${state.authUsers}\nFinal public rows: ${state.publicRows}\nFinal Storage buckets: ${state.storageBuckets}`);
}

async function main() {
  const command = process.argv[2];
  if (!COMMANDS.has(command)) {
    usage();
    process.exitCode = EXIT.INVALID;
    return;
  }
  const settings = getSettings();
  if (command === 'setup') await setup(settings);
  if (command === 'status') await status(settings);
  if (command === 'foreign-check') await foreignCheck(settings);
  if (command === 'cleanup') await cleanup(settings);
}

main().catch((error) => {
  console.error(`Fixture script stopped: ${redact(error.message)}`);
  process.exitCode = error.exitCode ?? 1;
});
