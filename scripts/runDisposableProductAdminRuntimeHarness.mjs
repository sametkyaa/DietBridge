#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = join(repoRoot, 'supabase', 'migrations');
const adminMigrationName = '20260826133224_product_admin_dietitian_verification.sql';
const notificationMigrationName = '20260814214101_notification_core_backend.sql';
const reminderMigrationName = '20260816194431_appointment_reminders_backend.sql';
const pushMigrationName = '20260817120000_push_registry_outbox_backend.sql';
const supabaseVersion = '2.110.0';
const diplomaBucket = 'dietitian-diplomas';
const password = 'Disposable-Product-Admin-4m!';
const projectId = 'dietbridge-admin-' + process.pid + '-' + randomUUID().slice(0, 8);
const npxCli = process.env.npm_execpath
  ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
  : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');

assertCiSafeEnvironment();

const pass = (label, detail = '') => {
  process.stdout.write('PASS: ' + label + (detail ? ' ' + detail : '') + '\n');
};

const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(label + (detail ? ': ' + detail : ''));
  pass(label, detail);
};

const redact = (value) => String(value)
  .replace(/\b(sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)\b/g, '[redacted]')
  .replace(/\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)\s*=\s*\S+/g, '[redacted]');

const assertNoError = (result, label) => {
  if (!result || result.error) {
    throw new Error(label + ': ' + redact(result?.error?.message ?? 'missing result'));
  }
  return result.data;
};

const assertRpcError = (result, label) => {
  assert(Boolean(result?.error), label, result?.error?.code ? 'code=' + result.error.code : 'error');
};

const cleanEnvironment = (environment) => Object.fromEntries(
  Object.entries(environment).filter(([key]) => !(
    /^(?:SUPABASE|VITE_SUPABASE|EXPO_PUBLIC_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)
  )),
);

const runCli = (tempRoot, args) => {
  try {
    return execFileSync(
      process.execPath,
      [npxCli, '--yes', 'supabase@' + supabaseVersion, '--workdir', tempRoot, ...args],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: { ...cleanEnvironment(process.env), TZ: 'Europe/Istanbul' },
        maxBuffer: 32 * 1024 * 1024,
        timeout: 15 * 60 * 1000,
      },
    );
  } catch (error) {
    throw new Error('Supabase ' + args.join(' ') + ' failed: ' + redact(error.message)
      + '\n' + redact(String(error.stdout ?? '').slice(-6000))
      + '\n' + redact(String(error.stderr ?? '').slice(-6000)));
  }
};

const parseStatus = (value) => Object.fromEntries(
  value.split(/\r?\n/)
    .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
    .filter(Boolean)
    .map((match) => [match[1], match[2]]),
);

const isPortFree = (port) => new Promise((resolvePromise) => {
  const server = createServer();
  server.once('error', () => resolvePromise(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)));
});

const choosePortBase = async () => {
  const dockerPorts = new Set(Array.from(
    execFileSync('docker', ['ps', '--format', '{{.Ports}}'], { encoding: 'utf8', timeout: 30_000 })
      .matchAll(/(?:0\.0\.0\.0:|\[::\]:)(\d+)->/g),
    (match) => Number(match[1]),
  ));
  const first = 58000 + (process.pid % 500);
  for (let offset = 0; offset < 5000; offset += 20) {
    const base = first + offset;
    const ports = [base, base + 1, base + 2, base + 3, base + 4, base + 7, base + 9, base + 83];
    if (ports.some((port) => dockerPorts.has(port))) continue;
    if ((await Promise.all(ports.map(isPortFree))).every(Boolean)) return base;
  }
  throw new Error('No disposable loopback port range is available.');
};

const configureDisposableProject = async (configPath) => {
  const base = await choosePortBase();
  const config = readFileSync(configPath, 'utf8')
    .replace(/^project_id\s*=\s*"[^"]+"$/m, 'project_id = "' + projectId + '"')
    .replace(/^port\s*=\s*54321$/m, 'port = ' + base)
    .replace(/^port\s*=\s*54322$/m, 'port = ' + (base + 1))
    .replace(/^shadow_port\s*=\s*54320$/m, 'shadow_port = ' + (base + 2))
    .replace(/^port\s*=\s*54329$/m, 'port = ' + (base + 9))
    .replace(/^port\s*=\s*54323$/m, 'port = ' + (base + 3))
    .replace(/^port\s*=\s*54324$/m, 'port = ' + (base + 4))
    .replace(/^port\s*=\s*54327$/m, 'port = ' + (base + 7))
    .replace(/^inspector_port\s*=\s*8083$/m, 'inspector_port = ' + (base + 83));
  writeFileSync(configPath, config, 'utf8');
};

const createAnonymousClient = (local) => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActorClient = async (local, actor) => {
  const signInResult = await createAnonymousClient(local).auth.signInWithPassword({
    email: actor.email,
    password,
  });
  const session = assertNoError(signInResult, actor.label + ' sign-in');
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: 'Bearer ' + session.session.access_token } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const createActor = async (admin, actorIds, label, role) => {
  const result = await admin.auth.admin.createUser({
    email: 'product-admin-' + label + '-' + randomUUID() + '@example.invalid',
    password,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: 'Disposable ' + label,
      product_admin_harness: 'disposable-test-identity',
    },
  });
  const data = assertNoError(result, label + ' Auth fixture');
  assert(Boolean(data.user?.id), label.toUpperCase() + '_AUTH_CREATED');
  actorIds.push(data.user.id);
  return { id: data.user.id, email: data.user.email, label, role };
};

const readSchema = (project, sql) => execFileSync('docker', [
  'exec', 'supabase_db_' + project,
  'psql', '-U', 'postgres', '-d', 'postgres', '-Atc', sql,
], { encoding: 'utf8', timeout: 30_000 }).trim();

const countBySql = (project, sql) => Number(readSchema(project, sql));

const deleteAuthUserFromDisposableDatabase = (project, userId, label) => {
  execFileSync('docker', [
    'exec', 'supabase_db_' + project,
    'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atc',
    `delete from auth.users where id = '${userId}';`,
  ], { encoding: 'utf8', timeout: 30_000 });
  pass(label);
};

const updateProfile = async (admin, actor, fields) => {
  assertNoError(await admin.from('profiles').update({
    full_name: 'Disposable ' + actor.label,
    ...fields.profile,
  }).eq('id', actor.id), actor.label + ' profile update');
  assertNoError(await admin.from('dietitian_profiles').update(fields.dietitian)
    .eq('user_id', actor.id), actor.label + ' dietitian profile update');
};

const setVerification = async (admin, actor, status, reason = null) => {
  const row = assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: status,
    verified_at: status === 'approved' ? '2026-08-20T08:00:00.000Z' : null,
    rejection_reason: reason,
  }).eq('user_id', actor.id).select('user_id,verification_status,is_verified,verified_at,rejection_reason').single(),
  actor.label + ' verification fixture');
  assert(row.verification_status === status && row.is_verified === (status === 'approved'),
    actor.label.toUpperCase() + '_' + status.toUpperCase() + '_FIXTURE');
  return row;
};

const canonicalDiplomaPath = (userId) => 'diplomas/' + userId + '/diploma.pdf';

const uploadDiploma = async (admin, storagePaths, userId, label) => {
  const path = canonicalDiplomaPath(userId);
  storagePaths.push(path);
  assertNoError(await admin.storage.from(diplomaBucket).upload(
    path,
    Buffer.from('%PDF-1.4 disposable product admin diploma'),
    { contentType: 'application/pdf', upsert: false },
  ), label + ' diploma upload');
  return path;
};

const makeCompletePending = async (admin, storagePaths, actor) => {
  const diplomaPath = await uploadDiploma(admin, storagePaths, actor.id, actor.label);
  await updateProfile(admin, actor, {
    dietitian: {
      phone: '+905551234567',
      university: 'Disposable Üniversitesi',
      graduation_year: 2018,
      experience_years: 4,
      specialization: 'Klinik beslenme',
      bio: 'Disposable başvuru biyografisi.',
      diploma_url: diplomaPath,
    },
  });
  return diplomaPath;
};

const rpcRows = async (client, name, args, label) => {
  const data = assertNoError(await client.rpc(name, args), label);
  return Array.isArray(data) ? data : [data];
};

const runFullAdminMatrix = async ({ local, admin, project }) => {
  const actorIds = [];
  const deletedActorIds = new Set();
  const storagePaths = [];
  const clients = {};

  try {
    assertNoError(await admin.storage.createBucket(diplomaBucket, {
      public: false,
      fileSizeLimit: 10485760,
      allowedMimeTypes: ['application/pdf'],
    }), 'dietitian diploma bucket fixture');
    pass('DIPLOMA_BUCKET_PRIVATE_PDF_10_MIB');

    const adminActor = await createActor(admin, actorIds, 'admin', 'dietitian');
    const approvedNonAdmin = await createActor(admin, actorIds, 'approved-nonadmin', 'dietitian');
    const completePending = await createActor(admin, actorIds, 'complete-pending', 'dietitian');
    const incompletePending = await createActor(admin, actorIds, 'incomplete-pending', 'dietitian');
    const rejectedPending = await createActor(admin, actorIds, 'rejected-pending', 'dietitian');
    const concurrentPending = await createActor(admin, actorIds, 'concurrent-pending', 'dietitian');
    const deletionSubject = await createActor(admin, actorIds, 'deletion-subject', 'dietitian');
    const client = await createActor(admin, actorIds, 'client', 'client');

    await makeCompletePending(admin, storagePaths, adminActor);
    await makeCompletePending(admin, storagePaths, approvedNonAdmin);
    await makeCompletePending(admin, storagePaths, completePending);
    await makeCompletePending(admin, storagePaths, rejectedPending);
    await makeCompletePending(admin, storagePaths, concurrentPending);
    await makeCompletePending(admin, storagePaths, deletionSubject);
    await setVerification(admin, adminActor, 'approved');
    await setVerification(admin, approvedNonAdmin, 'approved');
    await setVerification(admin, rejectedPending, 'pending');
    await setVerification(admin, concurrentPending, 'pending');
    await setVerification(admin, deletionSubject, 'pending');
    await setVerification(admin, incompletePending, 'pending');
    await updateProfile(admin, incompletePending, {
      dietitian: {
        phone: '',
        university: 'Eksik Üniversitesi',
        graduation_year: null,
        experience_years: null,
        specialization: '',
        bio: '',
        diploma_url: null,
      },
    });
    assertNoError(await admin.from('platform_admins').insert({
      user_id: adminActor.id,
      granted_by: adminActor.id,
    }), 'platform admin entitlement fixture');
    assertNoError(await admin.from('platform_admins').insert([
      { user_id: incompletePending.id, granted_by: adminActor.id },
      { user_id: rejectedPending.id, granted_by: adminActor.id },
      { user_id: client.id, granted_by: adminActor.id },
    ]), 'non-eligible admin entitlement fixtures');
    pass('APPROVED_DIETITIAN_ADMIN_ENTITLEMENT');

    clients.admin = await createActorClient(local, adminActor);
    clients.approvedNonAdmin = await createActorClient(local, approvedNonAdmin);
    clients.incomplete = await createActorClient(local, incompletePending);
    clients.rejected = await createActorClient(local, rejectedPending);
    clients.concurrent = await createActorClient(local, concurrentPending);
    clients.client = await createActorClient(local, client);
    clients.anonymous = createAnonymousClient(local);

    const adminPredicate = await clients.admin.rpc('is_current_user_platform_admin');
    assertNoError(adminPredicate, 'admin predicate');
    assert(adminPredicate.data === true, 'ACTIVE_ADMIN_PREDICATE_TRUE');
    assertNoError(await clients.approvedNonAdmin.rpc('is_current_user_platform_admin'), 'non-admin predicate');
    assert((await clients.approvedNonAdmin.rpc('is_current_user_platform_admin')).data === false, 'APPROVED_NONADMIN_PREDICATE_FALSE');
    assertNoError(await clients.client.rpc('is_current_user_platform_admin'), 'client predicate');
    assert((await clients.client.rpc('is_current_user_platform_admin')).data === false, 'CLIENT_PREDICATE_FALSE');
    assert((await clients.incomplete.rpc('is_current_user_platform_admin')).data === false, 'PENDING_DIETITIAN_PREDICATE_FALSE');
    assertRpcError(await clients.anonymous.rpc('is_current_user_platform_admin'), 'ANONYMOUS_ADMIN_PREDICATE_DENY');

    const summaryRows = await rpcRows(clients.admin, 'admin_get_verification_summary', {}, 'admin summary');
    const summary = summaryRows[0];
    assert(summary.pending >= 5 && summary.approved >= 2 && summary.rejected === 0, 'ADMIN_SUMMARY_COUNTS');
    assertRpcError(await clients.approvedNonAdmin.rpc('admin_get_verification_summary'), 'NONADMIN_SUMMARY_DENY');
    assertRpcError(await clients.client.rpc('admin_get_verification_summary'), 'CLIENT_SUMMARY_DENY');
    assertRpcError(await clients.admin.from('platform_admins').select('*'), 'PLATFORM_ADMIN_DIRECT_READ_DENY');
    assertRpcError(await clients.admin.from('dietitian_verification_audit').select('*'), 'AUDIT_DIRECT_READ_DENY');

    const listRows = await rpcRows(clients.admin, 'admin_list_dietitian_applications', {
      p_status: null,
      p_search: null,
      p_limit: 500,
      p_offset: 0,
    }, 'admin bounded list');
    assert(listRows.length <= 100, 'ADMIN_LIST_BOUND_100');
    assert(listRows.every((row) => !Object.prototype.hasOwnProperty.call(row, 'diploma_object_path')), 'ADMIN_LIST_NO_DIPLOMA_PATH');
    assert(listRows.some((row) => row.user_id === incompletePending.id && row.completeness_state === 'incomplete'), 'ADMIN_LIST_INCOMPLETE_STATE');
    const pendingRows = await rpcRows(clients.admin, 'admin_list_dietitian_applications', {
      p_status: 'pending', p_search: 'complete', p_limit: 20, p_offset: 0,
    }, 'admin pending search list');
    assert(pendingRows.every((row) => row.verification_status === 'pending'), 'ADMIN_LIST_STATUS_FILTER');

    const completeDetail = (await rpcRows(clients.admin, 'admin_get_dietitian_application', { p_user_id: completePending.id }, 'complete detail'))[0];
    assert(completeDetail.completeness_state === 'complete'
      && completeDetail.diploma_object_path === canonicalDiplomaPath(completePending.id), 'ADMIN_DETAIL_CANONICAL_DIPLOMA_PATH');
    const incompleteDetail = (await rpcRows(clients.admin, 'admin_get_dietitian_application', { p_user_id: incompletePending.id }, 'incomplete detail'))[0];
    assert(incompleteDetail.completeness_state === 'incomplete'
      && incompleteDetail.diploma_object_path === null
      && incompleteDetail.missing_fields.includes('diploma'), 'ADMIN_DETAIL_INCOMPLETE_FIELDS');
    assertRpcError(await clients.approvedNonAdmin.rpc('admin_get_dietitian_application', { p_user_id: completePending.id }), 'NONADMIN_DETAIL_DENY');

    const incompleteApprove = await clients.admin.rpc('admin_approve_dietitian', { p_user_id: incompletePending.id });
    assertRpcError(incompleteApprove, 'INCOMPLETE_APPROVAL_REJECTED_SERVER_SIDE');
    const incompleteAfter = assertNoError(await admin.from('dietitian_profiles').select('verification_status,is_verified').eq('user_id', incompletePending.id).single(), 'incomplete unchanged');
    assert(incompleteAfter.verification_status === 'pending' && incompleteAfter.is_verified === false, 'INCOMPLETE_STATE_UNCHANGED');

    const approvedResult = (await rpcRows(clients.admin, 'admin_approve_dietitian', { p_user_id: completePending.id }, 'admin approve'))[0];
    assert(approvedResult.verification_status === 'approved' && approvedResult.is_verified === true && approvedResult.audit_id, 'ADMIN_APPROVE_RESULT');
    const approvedRetry = (await rpcRows(clients.admin, 'admin_approve_dietitian', { p_user_id: completePending.id }, 'admin approve retry'))[0];
    assert(approvedRetry.audit_id === approvedResult.audit_id && approvedRetry.verification_status === 'approved', 'ADMIN_APPROVE_IDEMPOTENT_RETRY');
    const approvedAuditRows = assertNoError(await admin.from('dietitian_verification_audit').select('*').eq('subject_user_id_snapshot', completePending.id), 'approved audit count');
    assert(approvedAuditRows.length === 1 && approvedAuditRows[0].new_status === 'approved', 'ADMIN_APPROVE_ONE_AUDIT');
    const approvedHistory = await rpcRows(clients.admin, 'admin_get_dietitian_verification_history', { p_user_id: completePending.id }, 'approved history');
    assert(approvedHistory.length === 1 && approvedHistory[0].decided_by_snapshot === adminActor.id, 'ADMIN_HISTORY_READ');
    assertRpcError(await clients.admin.rpc('admin_reject_dietitian', { p_user_id: completePending.id, p_reason: 'reverse' }), 'APPROVED_REVERSE_REJECT_DENY');

    assertRpcError(await clients.admin.rpc('admin_reject_dietitian', { p_user_id: rejectedPending.id, p_reason: '   ' }), 'REJECT_REASON_EMPTY_DENY');
    assertRpcError(await clients.admin.rpc('admin_reject_dietitian', { p_user_id: rejectedPending.id, p_reason: 'x'.repeat(1001) }), 'REJECT_REASON_TOO_LONG_DENY');
    const rejectedResult = (await rpcRows(clients.admin, 'admin_reject_dietitian', { p_user_id: rejectedPending.id, p_reason: '  Diploma doğrulaması başarısız.  ' }, 'admin reject'))[0];
    assert(rejectedResult.verification_status === 'rejected' && rejectedResult.is_verified === false
      && rejectedResult.rejection_reason === 'Diploma doğrulaması başarısız.', 'ADMIN_REJECT_RESULT');
    const rejectedRetry = (await rpcRows(clients.admin, 'admin_reject_dietitian', { p_user_id: rejectedPending.id, p_reason: 'farklı ikinci neden' }, 'admin reject retry'))[0];
    assert(rejectedRetry.audit_id === rejectedResult.audit_id && rejectedRetry.rejection_reason === rejectedResult.rejection_reason, 'ADMIN_REJECT_IDEMPOTENT_RETRY');
    const rejectedAuditRows = assertNoError(await admin.from('dietitian_verification_audit').select('*').eq('subject_user_id_snapshot', rejectedPending.id), 'rejected audit count');
    assert(rejectedAuditRows.length === 1 && rejectedAuditRows[0].new_status === 'rejected', 'ADMIN_REJECT_ONE_AUDIT');
    assert((await clients.rejected.rpc('is_current_user_platform_admin')).data === false, 'REJECTED_DIETITIAN_PREDICATE_FALSE');
    assertRpcError(await clients.admin.rpc('admin_approve_dietitian', { p_user_id: rejectedPending.id }), 'REJECTED_REVERSE_APPROVE_DENY');

    const concurrentResults = await Promise.all([
      clients.admin.rpc('admin_approve_dietitian', { p_user_id: concurrentPending.id }),
      clients.admin.rpc('admin_reject_dietitian', { p_user_id: concurrentPending.id, p_reason: 'Eşzamanlı ret denemesi.' }),
    ]);
    assert(concurrentResults.filter((result) => !result.error).length === 1, 'CONCURRENT_ONE_DECISION_SUCCEEDS');
    const concurrentRow = assertNoError(await admin.from('dietitian_profiles').select('verification_status,is_verified').eq('user_id', concurrentPending.id).single(), 'concurrent final state');
    const concurrentAuditRows = assertNoError(await admin.from('dietitian_verification_audit').select('id,new_status').eq('subject_user_id_snapshot', concurrentPending.id), 'concurrent audit count');
    assert(concurrentRow.is_verified === (concurrentRow.verification_status === 'approved') && concurrentAuditRows.length === 1, 'CONCURRENT_DECISION_SERIALIZED');

    const signedUrl = assertNoError(await clients.admin.storage.from(diplomaBucket)
      .createSignedUrl(canonicalDiplomaPath(completePending.id), 120), 'admin diploma signed URL');
    assert(typeof signedUrl?.signedUrl === 'string' && signedUrl.signedUrl.length > 0, 'ADMIN_DIPLOMA_SIGNED_URL_120S');
    assertRpcError(await clients.approvedNonAdmin.storage.from(diplomaBucket)
      .createSignedUrl(canonicalDiplomaPath(completePending.id), 120), 'NONADMIN_DIPLOMA_READ_DENY');
    assertRpcError(await clients.client.storage.from(diplomaBucket)
      .createSignedUrl(canonicalDiplomaPath(completePending.id), 120), 'CLIENT_DIPLOMA_READ_DENY');
    const unauthorizedUpload = await clients.admin.storage.from(diplomaBucket).upload(
      canonicalDiplomaPath(incompletePending.id), Buffer.from('%PDF unauthorized'), { contentType: 'application/pdf' },
    );
    const unauthorizedUploadObject = await admin.storage.from(diplomaBucket)
      .download(canonicalDiplomaPath(incompletePending.id));
    assert(Boolean(unauthorizedUpload.error) && Boolean(unauthorizedUploadObject.error), 'ADMIN_DIPLOMA_INSERT_DENY');
    const unauthorizedUpdate = await clients.admin.storage.from(diplomaBucket).update(
      canonicalDiplomaPath(completePending.id), Buffer.from('%PDF unauthorized update'), { contentType: 'application/pdf' },
    );
    const unchangedDiploma = assertNoError(await admin.storage.from(diplomaBucket)
      .download(canonicalDiplomaPath(completePending.id)), 'admin diploma unchanged check');
    const unchangedBytes = Buffer.from(await unchangedDiploma.arrayBuffer()).toString('utf8');
    assert(Boolean(unauthorizedUpdate.error) && unchangedBytes.includes('disposable product admin diploma'), 'ADMIN_DIPLOMA_UPDATE_DENY');
    const unauthorizedDelete = await clients.admin.storage.from(diplomaBucket)
      .remove([canonicalDiplomaPath(completePending.id)]);
    const retainedDiploma = await admin.storage.from(diplomaBucket)
      .download(canonicalDiplomaPath(completePending.id));
    assert(!retainedDiploma.error, 'ADMIN_DIPLOMA_DELETE_DENY', unauthorizedDelete.error ? 'storage error=' + unauthorizedDelete.error.status : 'object retained');

    const directAuditInsert = await clients.admin.from('dietitian_verification_audit').insert({
      subject_user_id_snapshot: completePending.id,
      previous_status: 'pending',
      new_status: 'approved',
      decided_by_snapshot: adminActor.id,
    });
    const auditAfterDirectInsert = assertNoError(await admin.from('dietitian_verification_audit')
      .select('id').eq('subject_user_id_snapshot', completePending.id), 'direct audit insert guard check');
    assert(Boolean(directAuditInsert.error) || auditAfterDirectInsert.length === 1, 'AUDIT_DIRECT_INSERT_DENY',
      'rows=' + auditAfterDirectInsert.length + (directAuditInsert.error ? ' error=' + directAuditInsert.error.code : ''));
    const directAuditUpdate = await clients.admin.from('dietitian_verification_audit').update({ rejection_reason: 'mutation' })
      .eq('subject_user_id_snapshot', completePending.id);
    const auditAfterDirectUpdate = assertNoError(await admin.from('dietitian_verification_audit')
      .select('id,rejection_reason').eq('subject_user_id_snapshot', completePending.id).single(), 'direct audit update guard check');
    assert(Boolean(directAuditUpdate.error) || auditAfterDirectUpdate.rejection_reason === null, 'AUDIT_DIRECT_UPDATE_DENY',
      directAuditUpdate.error ? 'error=' + directAuditUpdate.error.code : '');
    const directAuditDelete = await clients.admin.from('dietitian_verification_audit').delete()
      .eq('subject_user_id_snapshot', completePending.id);
    const auditAfterDirectDelete = assertNoError(await admin.from('dietitian_verification_audit')
      .select('id').eq('subject_user_id_snapshot', completePending.id), 'direct audit delete guard check');
    assert(Boolean(directAuditDelete.error) || auditAfterDirectDelete.length === 1, 'AUDIT_DIRECT_DELETE_DENY',
      'rows=' + auditAfterDirectDelete.length + (directAuditDelete.error ? ' error=' + directAuditDelete.error.code : ''));

    const deletionResult = (await rpcRows(clients.admin, 'admin_approve_dietitian', { p_user_id: deletionSubject.id }, 'deletion subject approve'))[0];
    const deletionAuditId = deletionResult.audit_id;
    assert(deletionAuditId, 'DELETION_AUDIT_CREATED');
    const deletionSubjectDiplomaPath = canonicalDiplomaPath(deletionSubject.id);
    assertNoError(await admin.storage.from(diplomaBucket).remove([deletionSubjectDiplomaPath]), 'subject diploma cleanup before Auth deletion');
    storagePaths.splice(storagePaths.indexOf(deletionSubjectDiplomaPath), 1);
    deleteAuthUserFromDisposableDatabase(project, deletionSubject.id, 'subject Auth deletion');
    deletedActorIds.add(deletionSubject.id);
    const adminDiplomaPath = canonicalDiplomaPath(adminActor.id);
    assertNoError(await admin.storage.from(diplomaBucket).remove([adminDiplomaPath]), 'actor diploma cleanup before Auth deletion');
    storagePaths.splice(storagePaths.indexOf(adminDiplomaPath), 1);
    deleteAuthUserFromDisposableDatabase(project, adminActor.id, 'decision actor Auth deletion');
    deletedActorIds.add(adminActor.id);
    const retainedAudit = assertNoError(await admin.from('dietitian_verification_audit').select('*')
      .eq('id', deletionAuditId).single(), 'retained audit after Auth deletion');
    assert(retainedAudit.subject_user_id === null && retainedAudit.decided_by === null
      && retainedAudit.subject_user_id_snapshot === deletionSubject.id
      && retainedAudit.decided_by_snapshot === adminActor.id, 'AUDIT_SNAPSHOTS_SURVIVE_AUTH_DELETION');

    const revokedAdmin = await createActor(admin, actorIds, 'revoked-admin', 'dietitian');
    await makeCompletePending(admin, storagePaths, revokedAdmin);
    await setVerification(admin, revokedAdmin, 'approved');
    assertNoError(await admin.from('platform_admins').insert({ user_id: revokedAdmin.id, granted_by: revokedAdmin.id }), 'revoked admin entitlement fixture');
    const revokedClient = await createActorClient(local, revokedAdmin);
    assert((await revokedClient.rpc('is_current_user_platform_admin')).data === true, 'SECOND_ADMIN_ACTIVE_PREDICATE_TRUE');
    assertNoError(await admin.from('platform_admins').update({ revoked_at: '2099-01-01T00:00:00.000Z', revoked_by: revokedAdmin.id })
      .eq('user_id', revokedAdmin.id), 'revoke admin entitlement');
    assert((await revokedClient.rpc('is_current_user_platform_admin')).data === false, 'REVOKED_ADMIN_PREDICATE_FALSE');
    assertRpcError(await revokedClient.rpc('admin_get_verification_summary'), 'REVOKED_ADMIN_SUMMARY_DENY');

    const schemaAssertions = [
      ['PLATFORM_ADMIN_RLS_ENABLED', readSchema(project, "select relrowsecurity from pg_class where oid='public.platform_admins'::regclass;") === 't'],
      ['AUDIT_RLS_ENABLED', readSchema(project, "select relrowsecurity from pg_class where oid='public.dietitian_verification_audit'::regclass;") === 't'],
      ['ADMIN_POLICY_CANONICAL_PATH', readSchema(project, "select count(*) from pg_policies where schemaname='storage' and tablename='objects' and policyname='Platform admins can view dietitian diplomas' and cmd='SELECT';") === '1'],
      ['PUSH_REPLAYED_BEFORE_ADMIN', readSchema(project, "select count(*) from supabase_migrations.schema_migrations where version='20260817120000';") === '1'],
      ['ADMIN_REPLAYED_AFTER_PUSH', readSchema(project, "select count(*) from supabase_migrations.schema_migrations where version='20260826133224';") === '1'],
    ];
    for (const [label, condition] of schemaAssertions) assert(condition, label);
  } finally {
    for (const path of storagePaths) {
      await admin.storage.from(diplomaBucket).remove([path]).catch(() => undefined);
    }
    for (const actorId of [...actorIds].reverse()) {
      if (deletedActorIds.has(actorId)) continue;
      try {
        deleteAuthUserFromDisposableDatabase(project, actorId, 'Auth cleanup');
      } catch (error) {
        process.stderr.write('[product-admin-runtime] Auth cleanup failed for ' + actorId + ': ' + redact(error.message) + '\n');
      }
    }
    await admin.storage.deleteBucket(diplomaBucket).catch(() => undefined);
    assert(countBySql(project, 'select count(*) from storage.objects where bucket_id = ' + "'" + diplomaBucket + "';") === 0, 'ADMIN_STORAGE_FIXTURE_CLEAN');
    const remainingAuthFixtures = countBySql(project, 'select count(*) from auth.users where email like ' + "'product-admin-%@example.invalid';");
    if (remainingAuthFixtures === 0) pass('ADMIN_AUTH_FIXTURE_CLEAN');
    else process.stderr.write('[product-admin-runtime] ADMIN_AUTH_FIXTURE_REMAINDER ' + remainingAuthFixtures + '\n');
  }
};

const runScenario = async ({ includePush }) => {
  let disposable;
  let stackStarted = false;
  let local;
  let admin;
  let mainError;
  const scenarioLabel = includePush ? 'FULL_CANONICAL_PUSH_THEN_ADMIN' : 'PRODUCTION_SHAPED_NO_PUSH';

  try {
    disposable = await runDisposableSupabaseLocalReplay({
      repoRoot,
      materializeOnly: true,
      keepTemp: true,
    });
    const runtimeMigrationDirectory = join(disposable.tempRoot, 'supabase', 'migrations');
    for (const migrationName of [notificationMigrationName, reminderMigrationName, ...(includePush ? [pushMigrationName] : [])]) {
      const destination = join(runtimeMigrationDirectory, migrationName);
      if (existsSync(destination)) throw new Error('Disposable migration destination already exists: ' + migrationName);
      copyFileSync(join(migrationDirectory, migrationName), destination, 1);
    }
    const runtimeFiles = readdirSync(runtimeMigrationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
    const expectedFiles = includePush ? 50 : 49;
    assert(runtimeFiles.length === expectedFiles, scenarioLabel + '_MIGRATION_FILE_COUNT', String(runtimeFiles.length));
    assert(runtimeFiles.at(-1) === adminMigrationName, scenarioLabel + '_ADMIN_MIGRATION_TAIL');
    if (includePush) assert(runtimeFiles.includes(pushMigrationName), scenarioLabel + '_PUSH_PRESENT');
    else assert(!runtimeFiles.includes(pushMigrationName), scenarioLabel + '_PUSH_ABSENT');

    await configureDisposableProject(disposable.configPath);
    runCli(disposable.tempRoot, ['start']);
    stackStarted = true;
    pass(scenarioLabel + '_LOCAL_STACK_STARTED', projectId);
    runCli(disposable.tempRoot, ['db', 'reset', '--local', '--no-seed']);
    local = parseStatus(runCli(disposable.tempRoot, ['status', '--output', 'env']));
    assert(local.API_URL.startsWith('http://127.0.0.1:'), scenarioLabel + '_LOOPBACK_API');
    admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const migrationCount = countBySql(projectId, 'select count(*) from supabase_migrations.schema_migrations;');
    assert(migrationCount === expectedFiles, scenarioLabel + '_SCHEMA_MIGRATION_COUNT', String(migrationCount));
    assert(countBySql(projectId, "select count(*) from supabase_migrations.schema_migrations where version='20260826133224';") === 1,
      scenarioLabel + '_ADMIN_MIGRATION_REPLAYED');
    assert(includePush
      ? countBySql(projectId, "select count(*) from pg_class where relname='push_installations' and relnamespace='private'::regnamespace;") === 1
      : countBySql(projectId, "select count(*) from pg_class where relname='push_installations' and relnamespace='private'::regnamespace;") === 0,
    scenarioLabel + '_PUSH_SCHEMA_SHAPE');

    runCli(disposable.tempRoot, ['db', 'advisors', '--local', '--type', 'security', '--level', 'error', '--fail-on', 'error']);
    pass(scenarioLabel + '_SECURITY_ADVISORS');
    runCli(disposable.tempRoot, ['db', 'lint', '--local', '--schema', 'private,public', '--fail-on', 'error']);
    pass(scenarioLabel + '_DB_LINT');

    if (includePush) {
      await runFullAdminMatrix({ local, admin, project: projectId });
      pass('PRODUCT_ADMIN_FULL_RUNTIME_MATRIX_PASS');
    } else {
      assert(countBySql(projectId, "select count(*) from pg_class where relname='platform_admins' and relnamespace='public'::regnamespace;") === 1,
        'NO_PUSH_ADMIN_TABLE_PRESENT');
      assert(countBySql(projectId, "select count(*) from pg_proc where pronamespace='public'::regnamespace and proname='is_current_user_platform_admin';") === 1,
        'NO_PUSH_ADMIN_PREDICATE_PRESENT');
      pass('PRODUCT_ADMIN_NO_PUSH_RUNTIME_MATRIX_PASS');
    }
  } catch (error) {
    mainError = error;
  } finally {
    if (admin && !includePush) {
      // No-Push scenario has no fixture users or bucket; this is an explicit safety assertion.
      assert(countBySql(projectId, "select count(*) from auth.users where email like 'product-admin-%@example.invalid';") === 0,
        'NO_PUSH_AUTH_FIXTURE_ZERO');
    }
    if (disposable?.tempRoot && stackStarted) {
      try {
        runCli(disposable.tempRoot, ['stop', '--project-id', projectId, '--no-backup']);
        pass(scenarioLabel + '_LOCAL_STACK_STOPPED', projectId);
      } catch (error) {
        if (mainError) mainError.message += '; local stack stop failed: ' + redact(error.message);
        else mainError = error;
      }
    }
    if (disposable?.tempRoot) {
      const tempParent = dirname(disposable.tempRoot);
      rmSync(tempParent, { recursive: true, force: true });
      assert(!existsSync(tempParent), scenarioLabel + '_TEMP_RESIDUE_ZERO');
    }
    try {
      const containerResidual = execFileSync('docker', [
        'ps', '-a', '--filter', 'name=^supabase_.*_' + projectId + '$', '--format', '{{.ID}}',
      ], { encoding: 'utf8', timeout: 30_000 }).trim();
      const volumeResidual = execFileSync('docker', [
        'volume', 'ls', '--filter', 'name=' + projectId, '--format', '{{.Name}}',
      ], { encoding: 'utf8', timeout: 30_000 }).trim();
      const networkResidual = execFileSync('docker', [
        'network', 'ls', '--filter', 'name=' + projectId, '--format', '{{.Name}}',
      ], { encoding: 'utf8', timeout: 30_000 }).trim();
      assert(containerResidual === '' && volumeResidual === '' && networkResidual === '', scenarioLabel + '_DOCKER_RESIDUE_ZERO');
    } catch (error) {
      if (mainError) mainError.message += '; Docker residue verification failed: ' + redact(error.message);
      else mainError = error;
    }
  }
  if (mainError) throw mainError;
};

try {
  const runtimeMode = process.env.DIETBRIDGE_PRODUCT_ADMIN_RUNTIME_MODE ?? 'both';
  if (!['full', 'no-push', 'both'].includes(runtimeMode)) throw new Error('Unsupported runtime mode.');
  if (runtimeMode === 'full' || runtimeMode === 'both') await runScenario({ includePush: true });
  if (runtimeMode === 'no-push' || runtimeMode === 'both') await runScenario({ includePush: false });
  pass('PRODUCT_ADMIN_DISPOSABLE_REPLAY_PASS');
} catch (error) {
  process.stderr.write('[product-admin-runtime] ' + redact(error instanceof Error ? error.message : error) + '\n');
  process.exitCode = 1;
}
