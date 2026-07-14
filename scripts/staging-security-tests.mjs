#!/usr/bin/env node
/*
 * DietBridge staging-only security harness. Run manually only after setting:
 * DIETBRIDGE_STAGING_ADMIN_KEY and DIETBRIDGE_CONFIRM_STAGING_SECURITY_TESTS.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  classifyHarnessExitCode,
  evaluateDietitianMealUpdate,
  evaluateForeignMealSelection,
  evaluateOwnMealSelection,
} from './staging-security-test-assertions.mjs';

const CONFIRMATION = 'YES_DIETBRIDGE_STAGING_ONLY';
const REPORT_PATH = 'docs/SUPABASE_STAGING_RLS_TEST_REPORT.md';
const created = { users: [], relations: [], appointments: [], messages: [], plans: [], meals: [] };
const results = [];
let cleanupFailed = false;
let finalState = null;
const migrationHistoryBoundary = {
  status: 'NOT EXECUTED',
  reason: 'Live migration catalog is not accessible through the runtime test client.',
};

function fail(code, message) { console.error(`Harness stopped: ${message}`); process.exit(code); }
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
  if (!match) throw new Error('Supabase URL formatı beklenenden farklı.');
  return match[1];
}
function mask(value) { return value?.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : 'masked'; }
function redact(value) {
  return String(value ?? 'unknown error')
    .replace(/https:\/\/[^\s"']+/g, '[redacted-url]')
    .replace(/(?:sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)/g, '[redacted-secret]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[redacted-id]')
    .replace(/[\w.+-]+@[\w.-]+/g, '[redacted-email]');
}
function record(id, area, role, action, expected, ok, actual, severity = '', status = null, productionBlocker = false) {
  const failureStatus = severity === 'P2' ? 'FAIL — FUNCTIONAL BLOCKER' : 'FAIL — SECURITY BLOCKER';
  results.push({ id, area, role, action, expected, actual: redact(actual), status: status ?? (ok ? 'PASS' : failureStatus), severity, productionBlocker });
}
function assertNoError(result, label) { if (result?.error) throw new Error(`${label}: ${redact(result.error.message)}`); return result?.data; }
function userClient(url, anonKey) {
  return createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
function password() { return randomBytes(24).toString('base64url'); }
function email(role, runId) { return `dietbridge-staging-${role}-${runId}@example.com`; }

async function signIn(url, anonKey, identity) {
  const client = userClient(url, anonKey);
  const { error } = await client.auth.signInWithPassword({ email: identity.email, password: identity.password });
  assertNoError({ error }, `${identity.label} session`);
  return client;
}
async function createUser(admin, role, runId, metadata = {}) {
  const identity = { label: role, email: email(role.toLowerCase().replaceAll(' ', '-'), runId), password: password() };
  const { data, error } = await admin.auth.admin.createUser({ email: identity.email, password: identity.password, email_confirm: true, user_metadata: metadata });
  assertNoError({ error }, `${role} oluşturma`);
  if (!data?.user?.id) throw new Error(`${role} için Auth user ID dönmedi.`);
  identity.id = data.user.id;
  created.users.push(identity.id);
  return identity;
}
async function selectOne(admin, table, idColumn, id) {
  const { data, error } = await admin.from(table).select('*').eq(idColumn, id).maybeSingle();
  assertNoError({ error }, `${table} doğrulama`);
  return data;
}
async function preflight(admin) {
  const users = assertNoError(await admin.auth.admin.listUsers({ page: 1, perPage: 1 }), 'Auth preflight');
  if ((users?.users?.length ?? 0) !== 0) fail(3, 'Staging Auth kullanıcısı boş değil.');
  const tables = ['profiles', 'client_profiles', 'dietitian_profiles', 'dietitian_clients', 'appointments', 'chat_messages', 'meal_plans', 'meals'];
  for (const table of tables) {
    const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true });
    assertNoError({ error }, `${table} preflight`);
    if ((count ?? 0) !== 0) fail(3, `Staging ${table} tablosu boş değil.`);
  }
  const { data: buckets, error } = await admin.storage.listBuckets();
  assertNoError({ error }, 'Storage preflight');
  if ((buckets ?? []).length !== 0) fail(3, 'Staging Storage bucket boş değil.');
}
async function cleanup(admin) {
  const deleteIds = async (table, ids) => {
    if (!ids.length) return;
    const { error } = await admin.from(table).delete().in('id', ids);
    if (error) throw new Error(`${table} cleanup: ${redact(error.message)}`);
  };
  try {
    await deleteIds('chat_messages', created.messages);
    await deleteIds('meals', created.meals);
    await deleteIds('meal_plans', created.plans);
    await deleteIds('appointments', created.appointments);
    await deleteIds('dietitian_clients', created.relations);
    for (const id of created.users) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw new Error(`Auth cleanup: ${redact(error.message)}`);
    }
  } catch (error) { cleanupFailed = true; console.error(`Cleanup failed: ${redact(error.message)}`); }
}
async function finalAggregate(admin) {
  const users = assertNoError(await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'Final Auth doğrulama');
  const tables = ['profiles', 'client_profiles', 'dietitian_profiles', 'dietitian_clients', 'appointments', 'chat_messages', 'meal_plans', 'meals'];
  let publicRows = 0;
  for (const table of tables) { const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }); assertNoError({ error }, `Final ${table}`); publicRows += count ?? 0; }
  const { data: buckets, error } = await admin.storage.listBuckets(); assertNoError({ error }, 'Final Storage');
  return { authUsers: users?.users?.length ?? 0, publicRows, storageBuckets: buckets?.length ?? 0 };
}
function writeReport(runId, stagingRef) {
  const counts = Object.groupBy(results, ({ status }) => status);
  const securityFailures = results.filter((r) => r.status.includes('SECURITY BLOCKER') && ['P0', 'P1'].includes(r.severity)).length;
  const deferredBlockers = results.filter((r) => r.status === 'KNOWN DEFERRED GAP' && r.productionBlocker).length;
  const p2 = results.filter((r) => r.severity === 'P2' && !r.status.startsWith('PASS')).length;
  const reportExitCode = classifyHarnessExitCode({ cleanupFailed, securityFailures, deferredBlockers, functionalBlockers: p2 });
  const rows = results.map((r) => `| ${r.id} | ${r.area} | ${r.role} | ${r.action} | ${r.expected} | ${r.actual} | ${r.status} | ${r.severity} |`).join('\n');
  const report = `# DietBridge — Staging Onboarding ve Negatif RLS Test Raporu\n\n> [!IMPORTANT]\n> Bu rapor yalnız staging için tasarlanmış sentetik test harness çıktısıdır. Secret, URL, token, UUID ve email değerleri maskelenir.\n\n## Amaç ve ortam\n\n- Test run: \`${mask(runId)}\`\n- Staging referansı: \`${mask(stagingRef)}\`\n- Production ve GROUNDLESS: kullanılmadı.\n- Harness: \`scripts/staging-security-tests.mjs\`\n\n## Test özeti\n\n- Toplam: ${results.length}\n- PASS: ${(counts.PASS ?? []).length}\n- FAIL: ${(counts['FAIL — SECURITY BLOCKER'] ?? []).length + (counts['FAIL — FUNCTIONAL BLOCKER'] ?? []).length}\n- Cleanup: ${cleanupFailed ? 'FAIL' : 'PASS'}\n\n| ID | Alan | Rol | İşlem | Beklenen | Gerçek | Durum | Severity |\n|---|---|---|---|---|---|---|---|\n${rows || '| — | — | — | Çalıştırılmadı | — | — | NOT EXECUTED | — |'}\n\n## Cleanup ve sonuç\n\nCleanup yalnız runtime sırasında kaydedilen explicit ID’leri hedefler. Migration, Storage ve Realtime değişikliği yapılmaz.\n`;
  const reportWithVerification = report
    .replace(
      `- Cleanup: ${cleanupFailed ? 'FAIL' : 'PASS'}`,
      `- Security failures P0/P1: ${securityFailures}\n- Deferred P1 blockers: ${deferredBlockers}\n- P2 functional blockers: ${p2}\n- Cleanup: ${cleanupFailed ? 'FAIL' : 'PASS'}\n- Exit code: ${reportExitCode}`,
    )
    .replace(
      '## Cleanup ve sonuç',
      '## Cleanup verification',
    )
    .replace(
      'Migration, Storage ve Realtime değişikliği yapılmaz.\n',
      `Migration, Storage ve Realtime değişikliği yapılmaz.\n\n- Final Auth users: ${finalState?.authUsers ?? 'NOT EXECUTED'}\n- Final public rows: ${finalState?.publicRows ?? 'NOT EXECUTED'}\n- Final Storage buckets: ${finalState?.storageBuckets ?? 'NOT EXECUTED'}\n\n## Environment integrity verification\n\n- Runtime migration catalog check: ${migrationHistoryBoundary.status}\n- Reason: ${migrationHistoryBoundary.reason}\n\nRuntime istemcisi migration katalogunu sorgulamaz. Migration history gerektiğinde ayrı staging-only CLI/catalog kontrolüyle doğrulanır. Bu gözlemlenebilirlik sınırı harness güvenlik, fonksiyonel veya cleanup sonucunu değiştirmez.\n`,
    );
  writeFileSync(REPORT_PATH, reportWithVerification, { encoding: 'utf8' });
}

async function main() {
  // These guards intentionally run before any Supabase client is created.
  const adminKey = process.env.DIETBRIDGE_STAGING_ADMIN_KEY;
  if (!adminKey || process.env.DIETBRIDGE_CONFIRM_STAGING_SECURITY_TESTS !== CONFIRMATION) fail(2, 'Gerekli staging test environment onayı eksik.');
  if (adminKey.startsWith('sb_publishable_')) fail(2, 'Publishable key admin key olarak kullanılamaz.');
  const staging = parseEnv('.env.staging.local');
  const production = parseEnv('.env');
  const stagingRef = projectRef(staging.VITE_SUPABASE_URL);
  const productionRef = projectRef(production.VITE_SUPABASE_URL);
  if (!staging.VITE_SUPABASE_ANON_KEY || stagingRef === productionRef || staging.VITE_SUPABASE_URL === production.VITE_SUPABASE_URL) fail(2, 'Staging/production ayrımı doğrulanamadı.');
  if (/groundless/i.test(stagingRef)) fail(2, 'Kapsam dışı proje reddedildi.');

  const admin = createClient(staging.VITE_SUPABASE_URL, adminKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const runId = `dbsec-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomBytes(4).toString('hex')}`;
  let exitCode = 0;
  try {
    await preflight(admin);
    const dietitianA = await createUser(admin, 'Dietitian A', runId, { role: 'dietitian', full_name: 'Synthetic Dietitian A' });
    const clientA = await createUser(admin, 'Client A', runId, { role: 'client', full_name: 'Synthetic Client A' });
    const dietitianB = await createUser(admin, 'Dietitian B', runId, { role: 'dietitian', full_name: 'Synthetic Dietitian B' });
    const clientB = await createUser(admin, 'Client B', runId, { role: 'client', full_name: 'Synthetic Client B' });
    const elevation = await createUser(admin, 'Elevation Attempt Dietitian', runId, { role: 'dietitian', full_name: 'Synthetic Elevation', verification_status: 'approved', is_verified: true, verified: true, admin: true });
    const invalid = await admin.auth.admin.createUser({ email: email('invalid-role', runId), password: password(), email_confirm: true, user_metadata: { role: 'admin' } });
    if (invalid.data?.user?.id) created.users.push(invalid.data.user.id);

    for (const identity of [dietitianA, clientA, dietitianB, clientB, elevation]) {
      const profile = await selectOne(admin, 'profiles', 'id', identity.id);
      record(`ONB-${identity.label}`, 'Onboarding', identity.label, 'profile', 'profile exists', Boolean(profile), profile ? 'profile exists' : 'profile missing', profile ? '' : 'P0');
    }
    const elevationProfile = await selectOne(admin, 'dietitian_profiles', 'user_id', elevation.id);
    record('ONB-ELEVATION', 'Onboarding', elevation.label, 'verification escalation', 'pending/false', elevationProfile?.verification_status === 'pending' && elevationProfile?.is_verified === false, elevationProfile ? 'checked' : 'missing', 'P0');
    record('ONB-INVALID', 'Onboarding', 'Invalid Role Attempt', 'allowlist', 'rejected or safe role', Boolean(invalid.error) || (await selectOne(admin, 'profiles', 'id', invalid.data?.user?.id))?.role !== 'admin', invalid.error ? 'rejected' : 'safe role check', 'P0');

    const { data: relationA, error: relationAError } = await admin.from('dietitian_clients').insert({ dietitian_id: dietitianA.id, client_id: clientA.id, status: 'active', accepted_at: new Date().toISOString() }).select('id').single();
    assertNoError({ error: relationAError }, 'Tenant A relationship'); created.relations.push(relationA.id);
    const { data: relationB, error: relationBError } = await admin.from('dietitian_clients').insert({ dietitian_id: dietitianB.id, client_id: clientB.id, status: 'active', accepted_at: new Date().toISOString() }).select('id').single();
    assertNoError({ error: relationBError }, 'Tenant B relationship'); created.relations.push(relationB.id);
    const createFixture = async (dietitian, client) => {
      const appointment = assertNoError(await admin.from('appointments').insert({ dietitian_id: dietitian.id, client_id: client.id, title: runId, date: '2030-01-01', time: '09:00', duration: 30, type: 'online' }).select('id').single(), 'appointment fixture'); created.appointments.push(appointment.id);
      const message = assertNoError(await admin.from('chat_messages').insert({ sender_id: dietitian.id, receiver_id: client.id, message_text: runId }).select('id').single(), 'chat fixture'); created.messages.push(message.id);
      const plan = assertNoError(await admin.from('meal_plans').insert({ dietitian_id: dietitian.id, client_id: client.id, plan_date: '2030-01-01', notes: runId }).select('id').single(), 'meal plan fixture'); created.plans.push(plan.id);
      const meals = assertNoError(await admin.from('meals').insert([{ plan_id: plan.id, type: 'breakfast', title: runId, calories: 100, is_eaten: false }, { plan_id: plan.id, type: 'lunch', title: runId, calories: 200, is_eaten: false }]).select('id').then((r) => ({ data: r.data, error: r.error })), 'meal fixture'); created.meals.push(...meals.map((meal) => meal.id)); return { appointment, message, plan, meals };
    };
    const fixtureA = await createFixture(dietitianA, clientA); const fixtureB = await createFixture(dietitianB, clientB);
    const clientASession = await signIn(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY, clientA);
    const dietitianASession = await signIn(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY, dietitianA);
    const anonymous = userClient(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY);
    const adminOwnMeal = await selectOne(admin, 'meals', 'id', fixtureA.meals[0].id);
    const adminForeignMealBefore = await selectOne(admin, 'meals', 'id', fixtureB.meals[0].id);
    const ownMeals = await clientASession.from('meals').select('id').in('id', [fixtureA.meals[0].id, fixtureB.meals[0].id]);
    const ownMealsResult = evaluateOwnMealSelection({ error: ownMeals.error, rows: ownMeals.data, ownMealId: fixtureA.meals[0].id, foreignMealId: fixtureB.meals[0].id, adminOwnMeal, adminForeignMeal: adminForeignMealBefore });
    record('MEALS-SELECT-OWN', 'Meals', 'Client A', 'own and foreign meal select', 'own visible; foreign hidden', ownMealsResult.ok, ownMealsResult.actual, 'P2');
    const foreignMeal = await clientASession.from('meals').select('id').eq('id', fixtureB.meals[0].id);
    const adminForeignMealAfter = await selectOne(admin, 'meals', 'id', fixtureB.meals[0].id);
    const foreignMealResult = evaluateForeignMealSelection({ error: foreignMeal.error, rows: foreignMeal.data, foreignMealId: fixtureB.meals[0].id, adminBefore: adminForeignMealBefore, adminAfter: adminForeignMealAfter });
    record('MEALS-SELECT-CROSS', 'Meals', 'Client A', 'foreign meal select', '0 rows', foreignMealResult.ok, foreignMealResult.actual, 'P0');
    const ownPlans = await clientASession.from('meal_plans').select('id').eq('id', fixtureA.plan.id); record('RLS-OWN-PLAN', 'Meals', 'Client A', 'own select', '1 row', !ownPlans.error && ownPlans.data?.length === 1, ownPlans.error ? 'denied' : `${ownPlans.data?.length ?? 0} row`, 'P2');
    const foreignPlans = await clientASession.from('meal_plans').select('id').eq('id', fixtureB.plan.id); record('RLS-CROSS-PLAN', 'Meals', 'Client A', 'cross-tenant select', '0 rows', !foreignPlans.error && foreignPlans.data?.length === 0, foreignPlans.error ? 'denied' : `${foreignPlans.data?.length ?? 0} row`, 'P0');
    const anonProfiles = await anonymous.from('profiles').select('id'); record('RLS-ANON', 'Anonymous', 'Anon', 'profiles select', '0 rows', !anonProfiles.error && anonProfiles.data?.length === 0, anonProfiles.error ? 'denied' : `${anonProfiles.data?.length ?? 0} row`, 'P0');
    const spoof = await clientASession.from('chat_messages').insert({ sender_id: dietitianA.id, receiver_id: clientA.id, message_text: runId }); record('RLS-SPOOF', 'Chat', 'Client A', 'sender spoofing', 'denied/0', Boolean(spoof.error), spoof.error ? 'denied' : 'accepted', 'P1');
    const legacyMealId = fixtureA.meals[1].id;
    const beforeLegacy = await selectOne(admin, 'meals', 'id', legacyMealId);
    if (!beforeLegacy) throw new Error('Legacy meal fixture bulunamadı.');
    const attackTitle = `dbsec-legacy-update-${randomBytes(4).toString('hex')}`;
    const direct = await clientASession.from('meals').update({ title: attackTitle }).eq('id', legacyMealId);
    const afterLegacy = await selectOne(admin, 'meals', 'id', legacyMealId);
    if (!afterLegacy) {
      record('LEGACY-UPDATE', 'Meals', 'Client A', 'direct non-is_eaten update', 'physical verification', false, 'admin re-read unavailable', 'P2', 'NOT EXECUTED');
    } else if (afterLegacy.title === attackTitle) {
      const restore = await admin.from('meals').update({ title: beforeLegacy.title }).eq('id', legacyMealId);
      assertNoError({ error: restore.error }, 'Legacy title restore');
      const restored = await selectOne(admin, 'meals', 'id', legacyMealId);
      if (restored?.title !== beforeLegacy.title) throw new Error('Legacy title restore doğrulanamadı.');
      record('LEGACY-UPDATE', 'Meals', 'Client A', 'direct non-is_eaten update', 'denied', true, 'admin verification confirmed stored title changed; restored', 'P1', 'KNOWN DEFERRED GAP', true);
    } else {
      record('LEGACY-UPDATE', 'Meals', 'Client A', 'direct non-is_eaten update', 'denied', true, direct.error ? 'API denied; stored row unchanged' : 'stored row unchanged');
    }
    const dietitianMealId = fixtureA.meals[0].id;
    const beforeDietitianUpdate = await selectOne(admin, 'meals', 'id', dietitianMealId);
    if (!beforeDietitianUpdate) throw new Error('Dietitian meal fixture bulunamadı.');
    const dietitianTestTitle = `dbsec-dietitian-update-${randomBytes(4).toString('hex')}`;
    const dietitianUpdate = await dietitianASession.from('meals').update({ title: dietitianTestTitle }).eq('id', dietitianMealId).select('id,title');
    const afterDietitianUpdate = await selectOne(admin, 'meals', 'id', dietitianMealId);
    const dietitianRestore = await dietitianASession.from('meals').update({ title: beforeDietitianUpdate.title }).eq('id', dietitianMealId).select('id,title');
    let afterDietitianRestore = await selectOne(admin, 'meals', 'id', dietitianMealId);
    if (afterDietitianRestore?.title !== beforeDietitianUpdate.title) {
      const adminRestore = await admin.from('meals').update({ title: beforeDietitianUpdate.title }).eq('id', dietitianMealId);
      assertNoError({ error: adminRestore.error }, 'Dietitian title admin fallback restore');
      afterDietitianRestore = await selectOne(admin, 'meals', 'id', dietitianMealId);
      if (afterDietitianRestore?.title !== beforeDietitianUpdate.title) throw new Error('Dietitian title restore doğrulanamadı.');
    }
    const dietitianUpdateResult = evaluateDietitianMealUpdate({ updateError: dietitianUpdate.error, updatedRows: dietitianUpdate.data, targetMealId: dietitianMealId, testTitle: dietitianTestTitle, adminAfterUpdate: afterDietitianUpdate, originalTitle: beforeDietitianUpdate.title, restoreError: dietitianRestore.error, restoredRows: dietitianRestore.data, adminAfterRestore: afterDietitianRestore });
    record('DIETITIAN-MEAL-UPDATE', 'Meals', 'Dietitian A', 'own plan meal title update and restore', 'persisted and restored', dietitianUpdateResult.ok, dietitianUpdateResult.actual, 'P2');
    const rpcOwn = await clientASession.rpc('set_my_meal_completion', { p_meal_id: fixtureA.meals[0].id, p_is_eaten: true }); record('RPC-OWN', 'RPC', 'Client A', 'own meal completion', 'success', !rpcOwn.error, rpcOwn.error ? 'denied' : 'success', 'P2');
    const rpcForeign = await clientASession.rpc('set_my_meal_completion', { p_meal_id: fixtureB.meals[0].id, p_is_eaten: true }); record('RPC-CROSS', 'RPC', 'Client A', 'foreign meal completion', 'denied', Boolean(rpcForeign.error), rpcForeign.error ? 'denied' : 'accepted', 'P1');
    await Promise.all([clientASession.auth.signOut(), dietitianASession.auth.signOut()]);
  } catch (error) { record('HARNESS', 'Harness', 'System', 'execution', 'complete', false, error.message, 'P1'); exitCode = 11; }
  finally {
    await cleanup(admin);
    try { finalState = await finalAggregate(admin); if (finalState.authUsers || finalState.publicRows || finalState.storageBuckets) cleanupFailed = true; }
    catch (error) { cleanupFailed = true; console.error(`Final verification failed: ${redact(error.message)}`); }
    writeReport(runId, stagingRef);
  }
  const securityFailures = results.filter((r) => r.status === 'FAIL — SECURITY BLOCKER' && ['P0', 'P1'].includes(r.severity)).length;
  const deferredBlockers = results.filter((r) => r.status === 'KNOWN DEFERRED GAP' && r.productionBlocker).length;
  const p2 = results.filter((r) => r.severity === 'P2' && !r.status.startsWith('PASS')).length;
  exitCode = classifyHarnessExitCode({ cleanupFailed, securityFailures, deferredBlockers, functionalBlockers: p2, currentExitCode: exitCode });
  const passed = results.filter((r) => r.status === 'PASS').length;
  console.log(`Preflight: PASS\nOnboarding: ${results.filter((r) => r.area === 'Onboarding' && r.status === 'PASS').length}/${results.filter((r) => r.area === 'Onboarding').length}\nRLS tests: ${passed}/${results.length}\nSecurity failures P0/P1: ${securityFailures}\nDeferred P1 blockers: ${deferredBlockers}\nP2 functional blockers: ${p2}\nCleanup: ${cleanupFailed ? 'FAIL' : 'PASS'}\nFinal Auth users: ${finalState?.authUsers ?? 'NOT EXECUTED'}\nFinal public rows: ${finalState?.publicRows ?? 'NOT EXECUTED'}\nFinal Storage buckets: ${finalState?.storageBuckets ?? 'NOT EXECUTED'}\nMigration history unchanged: ${migrationHistoryBoundary.status}\nMigration history reason: ${migrationHistoryBoundary.reason}\nReport: ${REPORT_PATH}`);
  process.exit(exitCode);
}

main().catch((error) => fail(20, redact(error.message)));
