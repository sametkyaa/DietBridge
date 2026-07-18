#!/usr/bin/env node
/*
 * DietBridge staging-only security harness. Run manually only after setting:
 * DIETBRIDGE_STAGING_ADMIN_KEY and DIETBRIDGE_CONFIRM_STAGING_SECURITY_TESTS.
 */
import { writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import {
  classifyHarnessExitCode,
  evaluateDietitianMealUpdate,
  evaluateForeignMealSelection,
  evaluateOwnMealSelection,
} from './staging-security-test-assertions.mjs';

const CONFIRMATION = 'YES_DIETBRIDGE_STAGING_ONLY';
const EXPECTED_STAGING_HOSTNAME = 'ezwquofvsvesadnkrjkv.supabase.co';
const EXPECTED_STAGING_REF = 'ezwquofvsvesadnkrjkv';
const REPORT_PATH = 'docs/SUPABASE_STAGING_RLS_TEST_REPORT.md';
const created = {
  users: [],
  relations: [],
  appointments: [],
  messages: [],
  plans: [],
  meals: [],
  measurements: [],
  measurementClientIds: [],
  measurementMarkers: [],
};
const results = [];
const RESULT_CATEGORY = Object.freeze({
  ONBOARDING: 'Onboarding assertion',
  RLS: 'RLS assertion',
  RPC: 'RPC assertion',
  MEASUREMENT: 'Measurement assertion',
  FUNCTIONAL: 'Functional failure',
  FIXTURE: 'Harness / fixture failure',
});
let cleanupFailed = false;
let measurementCleanupFailed = false;
let finalState = null;
const migrationHistoryBoundary = {
  status: 'NOT EXECUTED',
  reason: 'Live migration catalog is not accessible through the runtime test client.',
};

class HarnessStop extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'HarnessStop';
    this.exitCode = code;
  }
}
function fail(code, message) { throw new HarnessStop(code, message); }
function normalizeConfigValue(value) {
  return String(value ?? '').trim().replace(/^["']|["']$/g, '');
}
function parseStagingUrl(value) {
  const normalizedUrl = normalizeConfigValue(value);
  let parsedUrl;
  try {
    parsedUrl = new URL(normalizedUrl);
  } catch {
    throw new Error('VITE_SUPABASE_URL geçerli bir URL değil.');
  }

  const normalizedPath = parsedUrl.pathname || '/';
  if (parsedUrl.protocol !== 'https:') throw new Error('VITE_SUPABASE_URL protocol https: olmalıdır.');
  if (parsedUrl.hostname !== EXPECTED_STAGING_HOSTNAME) throw new Error('VITE_SUPABASE_URL hostname DietBridge Staging ile eşleşmiyor.');
  if (parsedUrl.port) throw new Error('VITE_SUPABASE_URL port içermemelidir.');
  if (parsedUrl.username || parsedUrl.password) throw new Error('VITE_SUPABASE_URL kullanıcı bilgisi içermemelidir.');
  if (normalizedPath !== '/') throw new Error('VITE_SUPABASE_URL path yalnız / olabilir.');

  return { normalizedUrl, projectRef: EXPECTED_STAGING_REF };
}
function isLegacyAnonJwt(value) {
  const parts = value.split('.');
  if (parts.length !== 3) return false;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    return payload?.role === 'anon';
  } catch {
    return false;
  }
}
function isPublicAnonKey(value) {
  return value.startsWith('sb_publishable_') || isLegacyAnonJwt(value);
}
function mask(value) { return value?.length > 8 ? `${value.slice(0, 4)}…${value.slice(-4)}` : 'masked'; }
function redact(value) {
  return String(value ?? 'unknown error')
    .replace(/https:\/\/[^\s"']+/g, '[redacted-url]')
    .replace(/(?:sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)/g, '[redacted-secret]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[redacted-id]')
    .replace(/[\w.+-]+@[\w.-]+/g, '[redacted-email]');
}
function resultCategory(id) {
  if (id.startsWith('ONB-')) return RESULT_CATEGORY.ONBOARDING;
  if (id.startsWith('MEASUREMENT-')) return RESULT_CATEGORY.MEASUREMENT;
  if (id.startsWith('RPC-')) return RESULT_CATEGORY.RPC;
  if (id === 'DIETITIAN-MEAL-UPDATE') return RESULT_CATEGORY.FUNCTIONAL;
  if (id === 'HARNESS') return RESULT_CATEGORY.FIXTURE;
  return RESULT_CATEGORY.RLS;
}
function record(id, area, role, action, expected, ok, actual, severity = '', status = null, productionBlocker = false) {
  const failureStatus = severity === 'P2' ? 'FAIL — FUNCTIONAL BLOCKER' : 'FAIL — SECURITY BLOCKER';
  results.push({ id, category: resultCategory(id), area, role, action, expected, actual: redact(actual), status: status ?? (ok ? 'PASS' : failureStatus), severity, productionBlocker });
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
async function createPendingRelationship(admin, dietitian, client, label) {
  const { data: pendingRelationship, error: insertError } = await admin
    .from('dietitian_clients')
    .insert({ dietitian_id: dietitian.id, client_id: client.id, status: 'pending' })
    .select('id,dietitian_id,client_id,status,accepted_at')
    .single();
  assertNoError({ error: insertError }, `${label} pending insert`);
  if (!pendingRelationship?.id) throw new Error(`${label}: pending insert did not return a relationship ID.`);

  // Register cleanup immediately after INSERT succeeds. The pending row remains
  // removable even if contract validation or the active transition fails.
  created.relations.push(pendingRelationship.id);

  if (
    pendingRelationship.status !== 'pending'
    || pendingRelationship.accepted_at !== null
    || pendingRelationship.dietitian_id !== dietitian.id
    || pendingRelationship.client_id !== client.id
  ) {
    throw new Error(`${label}: pending insert contract verification failed.`);
  }

  return pendingRelationship;
}
async function activateRelationship(admin, pendingRelationship, label) {
  if (!pendingRelationship?.id) throw new Error(`${label}: relationship ID is required for active transition.`);

  const { data: activeRelationship, error: updateError } = await admin
    .from('dietitian_clients')
    .update({ status: 'active' })
    .eq('id', pendingRelationship.id)
    .select('id,dietitian_id,client_id,status,accepted_at')
    .single();
  assertNoError({ error: updateError }, `${label} active transition`);

  if (
    activeRelationship?.id !== pendingRelationship.id
    || activeRelationship.status !== 'active'
    || !activeRelationship.accepted_at
    || activeRelationship.dietitian_id !== pendingRelationship.dietitian_id
    || activeRelationship.client_id !== pendingRelationship.client_id
  ) {
    throw new Error(`${label}: active transition or database-generated accepted_at verification failed.`);
  }

  return activeRelationship;
}
async function createActiveRelationship(admin, dietitian, client, label) {
  const pendingRelationship = await createPendingRelationship(admin, dietitian, client, label);
  return activateRelationship(admin, pendingRelationship, label);
}
async function setDietitianVerification(admin, dietitian, verificationStatus, label) {
  const { data, error } = await admin
    .from('dietitian_profiles')
    .update({ verification_status: verificationStatus })
    .eq('user_id', dietitian.id)
    .select('user_id,verification_status,is_verified')
    .single();
  assertNoError({ error }, `${label} verification fixture`);
  const expectedVerified = verificationStatus === 'approved';
  if (data?.verification_status !== verificationStatus || data?.is_verified !== expectedVerified) {
    throw new Error(`${label}: verification fixture contract failed.`);
  }
  return data;
}
function fixtureDate(dayOffset = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + dayOffset);
  return date.toISOString().slice(0, 10);
}
function trackMeasurementClient(clientId) {
  if (clientId && !created.measurementClientIds.includes(clientId)) created.measurementClientIds.push(clientId);
}
function trackMeasurementMarker(marker) {
  if (marker && !created.measurementMarkers.includes(marker)) created.measurementMarkers.push(marker);
}
function trackMeasurementRow(value) {
  const rows = Array.isArray(value) ? value : value ? [value] : [];
  for (const row of rows) {
    if (row?.id && !created.measurements.includes(row.id)) created.measurements.push(row.id);
  }
}
function measurementRpcArgs(clientId, measuredAt, values = {}) {
  return {
    p_client_id: clientId,
    p_measured_at: measuredAt,
    p_weight: values.weight ?? null,
    p_waist: values.waist ?? null,
    p_hip: values.hip ?? null,
    p_arm: values.arm ?? null,
    p_chest: values.chest ?? null,
    p_thigh: values.thigh ?? null,
    p_calf: values.calf ?? null,
    p_neck: values.neck ?? null,
    p_notes: values.notes ?? null,
  };
}
function oneMeasurementRow(value) {
  if (Array.isArray(value)) return value.length === 1 ? value[0] : null;
  return value && typeof value === 'object' ? value : null;
}
const measurementFields = ['weight', 'waist', 'hip', 'arm', 'chest', 'thigh', 'calf', 'neck'];
function measurementMatches(row, clientId, measuredAt, values, expectedNotes) {
  return Boolean(row?.id)
    && row.client_id === clientId
    && row.measured_at === measuredAt
    && row.notes === expectedNotes
    && measurementFields.every((field) => row[field] === (values[field] ?? null));
}
async function measurementState(admin, clientId, measuredAt) {
  const { data: rows, error: rowsError } = await admin
    .from('measurements')
    .select('id,client_id,measured_at,weight,waist,hip,arm,chest,thigh,calf,neck,notes')
    .eq('client_id', clientId)
    .eq('measured_at', measuredAt)
    .order('id');
  assertNoError({ error: rowsError }, 'Measurement physical state');
  const { data: profile, error: profileError } = await admin
    .from('client_profiles')
    .select('current_weight')
    .eq('user_id', clientId)
    .single();
  assertNoError({ error: profileError }, 'Measurement current weight state');
  return { rows: rows ?? [], currentWeight: profile?.current_weight ?? null };
}
function sameMeasurementState(before, after) {
  return before.currentWeight === after.currentWeight
    && JSON.stringify(before.rows) === JSON.stringify(after.rows);
}
async function expectMeasurementDenied(admin, caller, options) {
  const { id, role, clientId, measuredAt, values, severity = 'P1' } = options;
  const before = await measurementState(admin, clientId, measuredAt);
  const response = await caller.rpc(
    'save_active_client_measurement',
    measurementRpcArgs(clientId, measuredAt, values),
  );
  if (!response.error) trackMeasurementRow(response.data);
  const after = await measurementState(admin, clientId, measuredAt);
  const unchanged = sameMeasurementState(before, after);
  record(
    id,
    'Measurement RPC',
    role,
    'denied write and physical re-read',
    'RPC error; row/profile unchanged',
    Boolean(response.error) && unchanged,
    `${response.error ? 'denied' : 'accepted'}; physical state ${unchanged ? 'unchanged' : 'changed'}`,
    severity,
  );
}
async function selectOne(admin, table, idColumn, id) {
  const { data, error } = await admin.from(table).select('*').eq(idColumn, id).maybeSingle();
  assertNoError({ error }, `${table} doğrulama`);
  return data;
}
async function preflight(admin) {
  const users = assertNoError(await admin.auth.admin.listUsers({ page: 1, perPage: 1 }), 'Auth preflight');
  if ((users?.users?.length ?? 0) !== 0) fail(3, 'Staging Auth kullanıcısı boş değil.');
  const tables = ['profiles', 'client_profiles', 'dietitian_profiles', 'dietitian_clients', 'measurements', 'appointments', 'chat_messages', 'meal_plans', 'meals'];
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
  const errors = [];
  const attempt = async (label, operation, measurement = false) => {
    try { await operation(); }
    catch (error) {
      errors.push(`${label}: ${redact(error.message)}`);
      if (measurement) measurementCleanupFailed = true;
    }
  };

  await attempt('measurement explicit-ID cleanup', () => deleteIds('measurements', created.measurements), true);
  await attempt('measurement client/date cleanup', async () => {
    if (!created.measurementClientIds.length) return;
    const { error } = await admin
      .from('measurements')
      .delete()
      .in('client_id', created.measurementClientIds)
      .gte('measured_at', fixtureDate(-14))
      .lte('measured_at', fixtureDate(0));
    if (error) throw error;
  }, true);
  await attempt('measurement marker cleanup', async () => {
    if (!created.measurementMarkers.length) return;
    const { error } = await admin.from('measurements').delete().in('notes', created.measurementMarkers);
    if (error) throw error;
  }, true);
  await attempt('chat cleanup', () => deleteIds('chat_messages', created.messages));
  await attempt('meal cleanup', () => deleteIds('meals', created.meals));
  await attempt('meal plan cleanup', () => deleteIds('meal_plans', created.plans));
  await attempt('appointment cleanup', () => deleteIds('appointments', created.appointments));
  await attempt('relationship cleanup', () => deleteIds('dietitian_clients', created.relations));
  for (const id of created.users) {
    await attempt('Auth cleanup', async () => {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) throw error;
    });
  }
  if (errors.length) {
    cleanupFailed = true;
    for (const error of errors) console.error(`Cleanup failed: ${error}`);
  }
}
async function finalAggregate(admin) {
  const users = assertNoError(await admin.auth.admin.listUsers({ page: 1, perPage: 1000 }), 'Final Auth doğrulama');
  const tables = ['profiles', 'client_profiles', 'dietitian_profiles', 'dietitian_clients', 'measurements', 'appointments', 'chat_messages', 'meal_plans', 'meals'];
  let publicRows = 0;
  for (const table of tables) { const { count, error } = await admin.from(table).select('*', { count: 'exact', head: true }); assertNoError({ error }, `Final ${table}`); publicRows += count ?? 0; }
  let measurementFixtureRows = 0;
  if (created.measurementClientIds.length) {
    const { count, error: measurementError } = await admin
      .from('measurements')
      .select('*', { count: 'exact', head: true })
      .in('client_id', created.measurementClientIds);
    assertNoError({ error: measurementError }, 'Final measurement fixture rows');
    measurementFixtureRows = count ?? 0;
  }
  const { data: buckets, error } = await admin.storage.listBuckets(); assertNoError({ error }, 'Final Storage');
  return { authUsers: users?.users?.length ?? 0, publicRows, storageBuckets: buckets?.length ?? 0, measurementFixtureRows };
}
function writeReport(runId, stagingRef) {
  const counts = Object.groupBy(results, ({ status }) => status);
  const securityFailures = results.filter((r) => r.category !== RESULT_CATEGORY.FIXTURE && r.status.includes('SECURITY BLOCKER') && ['P0', 'P1'].includes(r.severity)).length;
  const deferredBlockers = results.filter((r) => r.status === 'KNOWN DEFERRED GAP' && r.productionBlocker).length;
  const p2 = results.filter((r) => r.severity === 'P2' && !r.status.startsWith('PASS')).length;
  const fixtureFailures = results.filter((r) => r.category === RESULT_CATEGORY.FIXTURE && r.status !== 'PASS').length;
  const rlsAssertions = results.filter((r) => r.category === RESULT_CATEGORY.RLS);
  const rpcAssertions = results.filter((r) => r.category === RESULT_CATEGORY.RPC);
  const measurementAssertions = results.filter((r) => r.category === RESULT_CATEGORY.MEASUREMENT);
  const measurementValidationAssertions = measurementAssertions.filter((r) => [
    'MEASUREMENT-ALL-NULL-DENIED',
    'MEASUREMENT-WEIGHT-ZERO-DENIED',
    'MEASUREMENT-WEIGHT-BELOW-MIN-DENIED',
    'MEASUREMENT-WEIGHT-ABOVE-MAX-DENIED',
    'MEASUREMENT-NEGATIVE-CIRCUMFERENCE-DENIED',
    'MEASUREMENT-OVERSIZED-CIRCUMFERENCE-DENIED',
    'MEASUREMENT-FUTURE-DATE-DENIED',
    'MEASUREMENT-LONG-NOTES-DENIED',
  ].includes(r.id));
  const rlsFailures = rlsAssertions.filter((r) => r.status.startsWith('FAIL')).length;
  const rpcFailures = rpcAssertions.filter((r) => r.status.startsWith('FAIL')).length;
  const measurementFailures = measurementAssertions.filter((r) => r.status.startsWith('FAIL')).length;
  const measurementValidationFailures = measurementValidationAssertions.filter((r) => r.status.startsWith('FAIL')).length;
  const functionalFailures = results.filter((r) => r.category === RESULT_CATEGORY.FUNCTIONAL && r.status !== 'PASS').length;
  const reportExitCode = classifyHarnessExitCode({ cleanupFailed, securityFailures, deferredBlockers, functionalBlockers: p2, currentExitCode: fixtureFailures ? 11 : 0 });
  const row = (result) => `| ${result.id} | ${result.category} | ${result.area} | ${result.role} | ${result.action} | ${result.expected} | ${result.actual} | ${result.status} | ${result.severity} |`;
  const rows = results.filter((r) => r.category !== RESULT_CATEGORY.MEASUREMENT).map(row).join('\n');
  const measurementRows = measurementAssertions.map(row).join('\n');
  const report = `# DietBridge — Staging Onboarding ve Negatif RLS Test Raporu\n\n> [!IMPORTANT]\n> Bu rapor yalnız staging için tasarlanmış sentetik test harness çıktısıdır. Secret, URL, token, UUID ve email değerleri maskelenir.\n\n## Amaç ve ortam\n\n- Test run: \`${mask(runId)}\`\n- Staging referansı: \`${mask(stagingRef)}\`\n- Production ve GROUNDLESS: kullanılmadı.\n- Harness: \`scripts/staging-security-tests.mjs\`\n\n## Test özeti\n\n- Toplam: ${results.length}\n- PASS: ${(counts.PASS ?? []).length}\n- FAIL: ${(counts['FAIL — SECURITY BLOCKER'] ?? []).length + (counts['FAIL — FUNCTIONAL BLOCKER'] ?? []).length}\n- Cleanup: ${cleanupFailed ? 'FAIL' : 'PASS'}\n\n| ID | Sınıf | Alan | Rol | İşlem | Beklenen | Gerçek | Durum | Severity |\n|---|---|---|---|---|---|---|---|---|\n${rows || '| — | — | — | — | Çalıştırılmadı | — | — | NOT EXECUTED | — |'}\n\n## Measurement RPC tests\n\n- Measurement RPC tests: ${measurementAssertions.filter((r) => r.status === 'PASS').length}/${measurementAssertions.length}\n- Measurement assertion failures: ${measurementFailures}\n- Measurement validation failures: ${measurementValidationFailures}\n- Measurement cleanup failures: ${measurementCleanupFailed ? 1 : 0}\n\n| ID | Sınıf | Alan | Rol | İşlem | Beklenen | Gerçek | Durum | Severity |\n|---|---|---|---|---|---|---|---|---|\n${measurementRows || '| — | — | — | — | Çalıştırılmadı | — | — | NOT EXECUTED | — |'}\n\n## Cleanup ve sonuç\n\nCleanup explicit measurement ID, fixture client/date aralığı ve fixture marker notlarını hedefler. Trigger tarafından üretilen measurement satırları fixture client/date kapsamında silinir. Migration, Storage ve Realtime değişikliği yapılmaz.\n`;
  const reportWithVerification = report
    .replace(
      `- Cleanup: ${cleanupFailed ? 'FAIL' : 'PASS'}`,
      `- Harness / fixture failures: ${fixtureFailures}\n- RLS assertions: ${rlsAssertions.filter((r) => r.status === 'PASS').length}/${rlsAssertions.length}\n- RLS assertion failures: ${rlsFailures}\n- RPC assertions: ${rpcAssertions.filter((r) => r.status === 'PASS').length}/${rpcAssertions.length}\n- RPC assertion failures: ${rpcFailures}\n- Measurement RPC tests: ${measurementAssertions.filter((r) => r.status === 'PASS').length}/${measurementAssertions.length}\n- Measurement assertion failures: ${measurementFailures}\n- Measurement validation failures: ${measurementValidationFailures}\n- Measurement cleanup failures: ${measurementCleanupFailed ? 1 : 0}\n- Functional failures: ${functionalFailures}\n- Security failures P0/P1: ${securityFailures}\n- Deferred P1 blockers: ${deferredBlockers}\n- P2 functional blockers: ${p2}\n- Cleanup failures: ${cleanupFailed ? 1 : 0}\n- Cleanup: ${cleanupFailed ? 'FAIL' : 'PASS'}\n- Exit code: ${reportExitCode}`,
    )
    .replace(
      '## Cleanup ve sonuç',
      '## Cleanup verification',
    )
    .replace(
      'Migration, Storage ve Realtime değişikliği yapılmaz.\n',
      `Migration, Storage ve Realtime değişikliği yapılmaz.\n\n- Final Auth users: ${finalState?.authUsers ?? 'NOT EXECUTED'}\n- Final public rows: ${finalState?.publicRows ?? 'NOT EXECUTED'}\n- Final Storage buckets: ${finalState?.storageBuckets ?? 'NOT EXECUTED'}\n- Final measurement fixture rows: ${finalState?.measurementFixtureRows ?? 'NOT EXECUTED'}\n\n## Environment integrity verification\n\n- Runtime migration catalog check: ${migrationHistoryBoundary.status}\n- Reason: ${migrationHistoryBoundary.reason}\n\nRuntime istemcisi migration katalogunu sorgulamaz. Migration history gerektiğinde ayrı staging-only CLI/catalog kontrolüyle doğrulanır. Bu gözlemlenebilirlik sınırı harness güvenlik, fonksiyonel veya cleanup sonucunu değiştirmez.\n`,
    );
  writeFileSync(REPORT_PATH, reportWithVerification, { encoding: 'utf8' });
}

async function main() {
  // These guards intentionally run before any Supabase client is created.
  const requiredEnvironment = [
    'DIETBRIDGE_STAGING_ADMIN_KEY',
    'DIETBRIDGE_CONFIRM_STAGING_SECURITY_TESTS',
    'DIETBRIDGE_STAGING_PROJECT_REF',
    'DIETBRIDGE_STAGING_PROJECT_NAME',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_ANON_KEY',
  ];
  const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);
  if (missingEnvironment.length) fail(2, `Missing environment variables: ${missingEnvironment.join(', ')}`);
  const adminKey = process.env.DIETBRIDGE_STAGING_ADMIN_KEY;
  if (!adminKey || process.env.DIETBRIDGE_CONFIRM_STAGING_SECURITY_TESTS !== CONFIRMATION) fail(2, 'Gerekli staging test environment onayı eksik.');
  if (adminKey.startsWith('sb_publishable_')) fail(2, 'Publishable key admin key olarak kullanılamaz.');
  const urlConfig = parseStagingUrl(process.env.VITE_SUPABASE_URL);
  const normalizedAnonKey = normalizeConfigValue(process.env.VITE_SUPABASE_ANON_KEY);
  if (!isPublicAnonKey(normalizedAnonKey)) fail(2, 'VITE_SUPABASE_ANON_KEY publishable key veya legacy anon JWT olmalıdır.');
  const staging = {
    VITE_SUPABASE_URL: urlConfig.normalizedUrl,
    VITE_SUPABASE_ANON_KEY: normalizedAnonKey,
  };
  const stagingRef = urlConfig.projectRef;
  if (process.env.DIETBRIDGE_STAGING_PROJECT_NAME !== 'DietBridge Staging') fail(2, 'Staging project name guard failed.');
  if (stagingRef !== process.env.DIETBRIDGE_STAGING_PROJECT_REF) fail(2, 'Staging project ref guard failed.');
  if (/groundless/i.test(stagingRef)) fail(2, 'Kapsam dışı proje reddedildi.');

  const admin = createClient(staging.VITE_SUPABASE_URL, adminKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const runId = `dbsec-${new Date().toISOString().replace(/[-:.TZ]/g, '')}-${randomBytes(4).toString('hex')}`;
  await preflight(admin);
  let exitCode = 0;
  try {
    const dietitianA = await createUser(admin, 'Dietitian A', runId, { role: 'dietitian', full_name: 'Synthetic Dietitian A' });
    const clientA = await createUser(admin, 'Client A', runId, { role: 'client', full_name: 'Synthetic Client A' });
    const dietitianB = await createUser(admin, 'Dietitian B', runId, { role: 'dietitian', full_name: 'Synthetic Dietitian B' });
    const clientB = await createUser(admin, 'Client B', runId, { role: 'client', full_name: 'Synthetic Client B' });
    const elevation = await createUser(admin, 'Elevation Attempt Dietitian', runId, { role: 'dietitian', full_name: 'Synthetic Elevation', verification_status: 'approved', is_verified: true, verified: true, admin: true });
    const pendingDietitian = await createUser(admin, 'Pending Relationship Dietitian', runId, { role: 'dietitian', full_name: 'Synthetic Pending Relationship Dietitian' });
    const pendingClient = await createUser(admin, 'Pending Relationship Client', runId, { role: 'client', full_name: 'Synthetic Pending Relationship Client' });
    const unverifiedClient = await createUser(admin, 'Unverified Dietitian Client', runId, { role: 'client', full_name: 'Synthetic Unverified Dietitian Client' });
    const invalid = await admin.auth.admin.createUser({ email: email('invalid-role', runId), password: password(), email_confirm: true, user_metadata: { role: 'admin' } });
    if (invalid.data?.user?.id) created.users.push(invalid.data.user.id);

    for (const identity of [dietitianA, clientA, dietitianB, clientB, elevation, pendingDietitian, pendingClient, unverifiedClient]) {
      const profile = await selectOne(admin, 'profiles', 'id', identity.id);
      record(`ONB-${identity.label}`, 'Onboarding', identity.label, 'profile', 'profile exists', Boolean(profile), profile ? 'profile exists' : 'profile missing', profile ? '' : 'P0');
    }
    const elevationProfile = await selectOne(admin, 'dietitian_profiles', 'user_id', elevation.id);
    record('ONB-ELEVATION', 'Onboarding', elevation.label, 'verification escalation', 'pending/false', elevationProfile?.verification_status === 'pending' && elevationProfile?.is_verified === false, elevationProfile ? 'checked' : 'missing', 'P0');
    record('ONB-INVALID', 'Onboarding', 'Invalid Role Attempt', 'allowlist', 'rejected or safe role', Boolean(invalid.error) || (await selectOne(admin, 'profiles', 'id', invalid.data?.user?.id))?.role !== 'admin', invalid.error ? 'rejected' : 'safe role check', 'P0');

    await setDietitianVerification(admin, dietitianA, 'approved', 'Dietitian A');
    await setDietitianVerification(admin, dietitianB, 'approved', 'Dietitian B');
    await setDietitianVerification(admin, pendingDietitian, 'approved', 'Pending Relationship Dietitian');
    for (const client of [clientA, clientB, pendingClient, unverifiedClient]) trackMeasurementClient(client.id);

    await createActiveRelationship(admin, dietitianA, clientA, 'Tenant A relationship');
    await createActiveRelationship(admin, dietitianB, clientB, 'Tenant B relationship');
    await createPendingRelationship(admin, pendingDietitian, pendingClient, 'Pending measurement relationship');
    await createActiveRelationship(admin, elevation, unverifiedClient, 'Unverified measurement relationship');
    const createFixture = async (dietitian, client) => {
      const appointment = assertNoError(await admin.from('appointments').insert({ dietitian_id: dietitian.id, client_id: client.id, title: runId, date: '2030-01-01', time: '09:00', duration: 30, type: 'online' }).select('id').single(), 'appointment fixture'); created.appointments.push(appointment.id);
      const message = assertNoError(await admin.from('chat_messages').insert({ sender_id: dietitian.id, receiver_id: client.id, message_text: runId }).select('id').single(), 'chat fixture'); created.messages.push(message.id);
      const plan = assertNoError(await admin.from('meal_plans').insert({ dietitian_id: dietitian.id, client_id: client.id, plan_date: '2030-01-01', notes: runId }).select('id').single(), 'meal plan fixture'); created.plans.push(plan.id);
      const meals = assertNoError(await admin.from('meals').insert([{ plan_id: plan.id, type: 'breakfast', title: runId, calories: 100, is_eaten: false }, { plan_id: plan.id, type: 'lunch', title: runId, calories: 200, is_eaten: false }]).select('id').then((r) => ({ data: r.data, error: r.error })), 'meal fixture'); created.meals.push(...meals.map((meal) => meal.id)); return { appointment, message, plan, meals };
    };
    const fixtureA = await createFixture(dietitianA, clientA); const fixtureB = await createFixture(dietitianB, clientB);
    const clientASession = await signIn(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY, clientA);
    const dietitianASession = await signIn(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY, dietitianA);
    const pendingDietitianSession = await signIn(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY, pendingDietitian);
    const unverifiedDietitianSession = await signIn(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY, elevation);
    const anonymous = userClient(staging.VITE_SUPABASE_URL, staging.VITE_SUPABASE_ANON_KEY);

    const today = fixtureDate(0);
    const deniedDate = today;
    await expectMeasurementDenied(admin, pendingDietitianSession, {
      id: 'MEASUREMENT-PENDING-DIETITIAN-DENIED', role: 'Pending Relationship Dietitian',
      clientId: pendingClient.id, measuredAt: deniedDate, values: { weight: 75 },
    });
    await expectMeasurementDenied(admin, unverifiedDietitianSession, {
      id: 'MEASUREMENT-UNVERIFIED-DIETITIAN-DENIED', role: 'Unverified Dietitian',
      clientId: unverifiedClient.id, measuredAt: deniedDate, values: { weight: 75 },
    });
    await expectMeasurementDenied(admin, dietitianASession, {
      id: 'MEASUREMENT-CROSS-TENANT-DENIED', role: 'Dietitian A',
      clientId: clientB.id, measuredAt: deniedDate, values: { weight: 75 },
    });
    await expectMeasurementDenied(admin, clientASession, {
      id: 'MEASUREMENT-CLIENT-CALLER-DENIED', role: 'Client A',
      clientId: clientA.id, measuredAt: deniedDate, values: { weight: 75 },
    });
    await expectMeasurementDenied(admin, anonymous, {
      id: 'MEASUREMENT-ANON-DENIED', role: 'Anon',
      clientId: clientA.id, measuredAt: deniedDate, values: { weight: 75 },
    });

    const validationDate = today;
    const validationCases = [
      ['MEASUREMENT-ALL-NULL-DENIED', {}],
      ['MEASUREMENT-WEIGHT-ZERO-DENIED', { weight: 0 }],
      ['MEASUREMENT-WEIGHT-BELOW-MIN-DENIED', { weight: 19.99 }],
      ['MEASUREMENT-WEIGHT-ABOVE-MAX-DENIED', { weight: 500.01 }],
      ['MEASUREMENT-NEGATIVE-CIRCUMFERENCE-DENIED', { waist: -1 }],
      ['MEASUREMENT-OVERSIZED-CIRCUMFERENCE-DENIED', { waist: 500.01 }],
      ['MEASUREMENT-FUTURE-DATE-DENIED', { weight: 75 }, fixtureDate(1)],
      ['MEASUREMENT-LONG-NOTES-DENIED', { weight: 75, notes: 'x'.repeat(1001) }],
    ];
    for (const [id, values, measuredAt = validationDate] of validationCases) {
      await expectMeasurementDenied(admin, dietitianASession, {
        id, role: 'Dietitian A', clientId: clientA.id, measuredAt, values,
      });
    }

    const activeMarker = `dbsec-measurement-active-${runId}`;
    trackMeasurementMarker(activeMarker);
    const activeValues = {
      weight: 80.2, waist: 90, hip: 100, arm: 30, chest: 95, thigh: 55, calf: 38, neck: 36,
      notes: activeMarker,
    };
    const activeInsert = await dietitianASession.rpc(
      'save_active_client_measurement',
      measurementRpcArgs(clientA.id, today, activeValues),
    );
    trackMeasurementRow(activeInsert.data);
    const activeRow = oneMeasurementRow(activeInsert.data);
    const activePhysical = activeRow?.id ? await selectOne(admin, 'measurements', 'id', activeRow.id) : null;
    const activeInsertOk = !activeInsert.error
      && measurementMatches(activeRow, clientA.id, today, activeValues, activeMarker)
      && measurementMatches(activePhysical, clientA.id, today, activeValues, activeMarker);
    record('MEASUREMENT-ACTIVE-INSERT', 'Measurement RPC', 'Dietitian A', 'active client insert and physical re-read', 'canonical row persisted', activeInsertOk, activeInsertOk ? 'canonical row verified' : 'RPC or physical row mismatch', 'P2');

    const upsertValues = { weight: 79.4, waist: 88, notes: '   ' };
    const sameDayUpsert = await dietitianASession.rpc(
      'save_active_client_measurement',
      measurementRpcArgs(clientA.id, today, upsertValues),
    );
    trackMeasurementRow(sameDayUpsert.data);
    const upsertRow = oneMeasurementRow(sameDayUpsert.data);
    const upsertState = await measurementState(admin, clientA.id, today);
    const upsertPhysical = upsertState.rows[0] ?? null;
    const sameDayOk = !sameDayUpsert.error
      && activeRow?.id === upsertRow?.id
      && upsertState.rows.length === 1
      && measurementMatches(upsertRow, clientA.id, today, upsertValues, null)
      && measurementMatches(upsertPhysical, clientA.id, today, upsertValues, null);
    record('MEASUREMENT-SAME-DAY-UPSERT', 'Measurement RPC', 'Dietitian A', 'same client/date canonical upsert', 'same ID; one canonical row', sameDayOk, sameDayOk ? 'same ID and canonical row verified' : 'ID/count/payload mismatch', 'P2');
    record('MEASUREMENT-NOTES-NORMALIZED', 'Measurement RPC', 'Dietitian A', 'whitespace notes normalization', 'notes = null', upsertRow?.notes === null && upsertPhysical?.notes === null, upsertRow?.notes === null && upsertPhysical?.notes === null ? 'notes normalized to null' : 'notes normalization mismatch', 'P2');
    record('MEASUREMENT-TODAY-WEIGHT-SYNC', 'Measurement RPC', 'Dietitian A', 'today weight synchronization', 'current_weight = 79.4', upsertState.currentWeight === 79.4, upsertState.currentWeight === 79.4 ? 'current_weight synchronized' : 'current_weight mismatch', 'P2');

    const pastDate = fixtureDate(-1);
    const currentBeforePast = upsertState.currentWeight;
    const pastMarker = `dbsec-measurement-past-${runId}`;
    trackMeasurementMarker(pastMarker);
    const pastValues = { weight: 70.5, notes: pastMarker };
    const pastInsert = await dietitianASession.rpc(
      'save_active_client_measurement',
      measurementRpcArgs(clientA.id, pastDate, pastValues),
    );
    trackMeasurementRow(pastInsert.data);
    const pastRow = oneMeasurementRow(pastInsert.data);
    const pastPhysical = pastRow?.id ? await selectOne(admin, 'measurements', 'id', pastRow.id) : null;
    const currentAfterPast = (await measurementState(admin, clientA.id, pastDate)).currentWeight;
    const pastNoSyncOk = !pastInsert.error
      && measurementMatches(pastRow, clientA.id, pastDate, pastValues, pastMarker)
      && measurementMatches(pastPhysical, clientA.id, pastDate, pastValues, pastMarker)
      && currentAfterPast === currentBeforePast;
    record('MEASUREMENT-PAST-WEIGHT-NO-SYNC', 'Measurement RPC', 'Dietitian A', 'past weight insert and profile re-read', 'measurement saved; current_weight unchanged', pastNoSyncOk, pastNoSyncOk ? 'past row saved; current_weight unchanged' : 'past row or current_weight mismatch', 'P2');

    const clientWeight = 78.6;
    const clientWeightRpc = await clientASession.rpc('save_my_current_weight', { p_weight: clientWeight });
    const clientWeightState = await measurementState(admin, clientA.id, today);
    const clientWeightRow = clientWeightState.rows[0] ?? null;
    trackMeasurementRow(clientWeightRow);
    const clientRegressionOk = !clientWeightRpc.error
      && clientWeightState.rows.length === 1
      && clientWeightState.currentWeight === clientWeight
      && clientWeightRow?.id === activeRow?.id
      && clientWeightRow?.weight === clientWeight
      && clientWeightRow?.waist === upsertValues.waist;
    record('MEASUREMENT-CLIENT-WEIGHT-REGRESSION', 'Measurement RPC', 'Client A', 'save_my_current_weight and physical re-read', 'current weight and daily row synchronized; circumference preserved', clientRegressionOk, clientRegressionOk ? 'client RPC and trigger preservation verified' : 'client RPC regression detected', 'P2');

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
    await Promise.all([
      clientASession.auth.signOut(),
      dietitianASession.auth.signOut(),
      pendingDietitianSession.auth.signOut(),
      unverifiedDietitianSession.auth.signOut(),
    ]);
  } catch (error) { record('HARNESS', 'Harness', 'System', 'execution', 'complete', false, error.message, 'P1'); exitCode = 11; }
  finally {
    await cleanup(admin);
    try {
      finalState = await finalAggregate(admin);
      if (finalState.measurementFixtureRows) measurementCleanupFailed = true;
      if (finalState.authUsers || finalState.publicRows || finalState.storageBuckets || finalState.measurementFixtureRows) cleanupFailed = true;
    }
    catch (error) { cleanupFailed = true; console.error(`Final verification failed: ${redact(error.message)}`); }
    writeReport(runId, stagingRef);
  }
  const securityFailures = results.filter((r) => r.category !== RESULT_CATEGORY.FIXTURE && r.status === 'FAIL — SECURITY BLOCKER' && ['P0', 'P1'].includes(r.severity)).length;
  const deferredBlockers = results.filter((r) => r.status === 'KNOWN DEFERRED GAP' && r.productionBlocker).length;
  const p2 = results.filter((r) => r.severity === 'P2' && !r.status.startsWith('PASS')).length;
  exitCode = classifyHarnessExitCode({ cleanupFailed, securityFailures, deferredBlockers, functionalBlockers: p2, currentExitCode: exitCode });
  const fixtureFailures = results.filter((r) => r.category === RESULT_CATEGORY.FIXTURE && r.status !== 'PASS').length;
  const rlsAssertions = results.filter((r) => r.category === RESULT_CATEGORY.RLS);
  const rpcAssertions = results.filter((r) => r.category === RESULT_CATEGORY.RPC);
  const measurementAssertions = results.filter((r) => r.category === RESULT_CATEGORY.MEASUREMENT);
  const measurementValidationIds = new Set([
    'MEASUREMENT-ALL-NULL-DENIED',
    'MEASUREMENT-WEIGHT-ZERO-DENIED',
    'MEASUREMENT-WEIGHT-BELOW-MIN-DENIED',
    'MEASUREMENT-WEIGHT-ABOVE-MAX-DENIED',
    'MEASUREMENT-NEGATIVE-CIRCUMFERENCE-DENIED',
    'MEASUREMENT-OVERSIZED-CIRCUMFERENCE-DENIED',
    'MEASUREMENT-FUTURE-DATE-DENIED',
    'MEASUREMENT-LONG-NOTES-DENIED',
  ]);
  const rlsFailures = rlsAssertions.filter((r) => r.status.startsWith('FAIL')).length;
  const rpcFailures = rpcAssertions.filter((r) => r.status.startsWith('FAIL')).length;
  const measurementFailures = measurementAssertions.filter((r) => r.status.startsWith('FAIL')).length;
  const measurementValidationFailures = measurementAssertions.filter((r) => measurementValidationIds.has(r.id) && r.status.startsWith('FAIL')).length;
  const functionalFailures = results.filter((r) => r.category === RESULT_CATEGORY.FUNCTIONAL && r.status !== 'PASS').length;
  console.log(`Preflight: PASS\nOnboarding: ${results.filter((r) => r.category === RESULT_CATEGORY.ONBOARDING && r.status === 'PASS').length}/${results.filter((r) => r.category === RESULT_CATEGORY.ONBOARDING).length}\nHarness / fixture failures: ${fixtureFailures}\nRLS tests: ${rlsAssertions.filter((r) => r.status === 'PASS').length}/${rlsAssertions.length}\nRLS assertion failures: ${rlsFailures}\nRPC tests: ${rpcAssertions.filter((r) => r.status === 'PASS').length}/${rpcAssertions.length}\nRPC assertion failures: ${rpcFailures}\nMeasurement RPC tests: ${measurementAssertions.filter((r) => r.status === 'PASS').length}/${measurementAssertions.length}\nMeasurement assertion failures: ${measurementFailures}\nMeasurement validation failures: ${measurementValidationFailures}\nMeasurement cleanup failures: ${measurementCleanupFailed ? 1 : 0}\nFunctional failures: ${functionalFailures}\nSecurity failures P0/P1: ${securityFailures}\nDeferred P1 blockers: ${deferredBlockers}\nP2 functional blockers: ${p2}\nCleanup failures: ${cleanupFailed ? 1 : 0}\nCleanup: ${cleanupFailed ? 'FAIL' : 'PASS'}\nFinal Auth users: ${finalState?.authUsers ?? 'NOT EXECUTED'}\nFinal public rows: ${finalState?.publicRows ?? 'NOT EXECUTED'}\nFinal Storage buckets: ${finalState?.storageBuckets ?? 'NOT EXECUTED'}\nFinal measurement fixture rows: ${finalState?.measurementFixtureRows ?? 'NOT EXECUTED'}\nMigration history unchanged: ${migrationHistoryBoundary.status}\nMigration history reason: ${migrationHistoryBoundary.reason}\nReport: ${REPORT_PATH}`);
  process.exitCode = exitCode;
}

main().catch((error) => {
  console.error(`Harness stopped: ${redact(error.message)}`);
  process.exitCode = Number.isInteger(error?.exitCode) ? error.exitCode : 20;
});
