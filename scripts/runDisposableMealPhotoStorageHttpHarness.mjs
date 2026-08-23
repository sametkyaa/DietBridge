import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const BUCKET = 'meal-photos';
const PASSWORD = 'Disposable-MVP3-Only-7a!';

const workdirIndex = process.argv.indexOf('--workdir');
if (workdirIndex === -1 || !process.argv[workdirIndex + 1]) {
  throw new Error('Usage: node scripts/runDisposableMealPhotoStorageHttpHarness.mjs --workdir <disposable-project>');
}
const disposableWorkdir = resolve(process.argv[workdirIndex + 1]);
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const statusText = execFileSync(process.execPath, [
  npxCli, '--yes', `supabase@${SUPABASE_VERSION}`, '--workdir', disposableWorkdir, 'status', '--output', 'env',
], { encoding: 'utf8' });
const local = Object.fromEntries(statusText.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/)).filter(Boolean).map((match) => [match[1], match[2]]));
if (!/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? '')) {
  throw new Error('Refusing to run Storage mutation harness outside a loopback Supabase API.');
}

const admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const anonymous = () => createClient(local.API_URL, local.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
const actorIds = [];
const objectPaths = new Set();

const sql = (statement) => execFileSync('docker', [
  'exec', '-i', 'supabase_db_DietBridge-Web', 'psql', '-v', 'ON_ERROR_STOP=1',
  '-U', 'postgres', '-d', 'postgres', '-Atc', statement,
], { encoding: 'utf8' }).trim();

const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  process.stdout.write(`PASS: ${label}\n`);
};
const assertDenied = (error, label) => {
  if (!error) throw new Error(label);
  const status = error.statusCode ?? error.status ?? 'error';
  const category = error.name ?? error.constructor?.name ?? 'Error';
  process.stdout.write(`PASS: ${label} status=${status} category=${category}\n`);
};
const createActor = async (label, accountType) => {
  const email = `mvp3-http-${label}-${Date.now()}-${randomUUID()}@example.invalid`;
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { account_type: accountType, full_name: `Disposable ${label}` },
  });
  if (error) throw error;
  actorIds.push(data.user.id);
  return { id: data.user.id, email };
};
const clientFor = async (actor) => {
  const signInClient = anonymous();
  const { data, error } = await signInClient.auth.signInWithPassword({ email: actor.email, password: PASSWORD });
  if (error) throw error;
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${data.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
};
const activate = async (dietitian, client) => {
  let result = await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id, client_id: client.id, status: 'pending',
  });
  if (result.error) throw result.error;
  result = await admin.from('dietitian_clients').update({
    status: 'active', accepted_at: new Date().toISOString(),
  }).eq('dietitian_id', dietitian.id).eq('client_id', client.id);
  if (result.error) throw result.error;
};
const approve = async (actor, status = 'approved') => {
  const result = await admin.from('dietitian_profiles').update({
    verification_status: status,
    is_verified: status === 'approved',
    verified_at: status === 'approved' ? new Date().toISOString() : null,
  }).eq('user_id', actor.id);
  if (result.error) throw result.error;
};
const canonicalPath = (clientId, dietitianId, extension = 'jpg') =>
  `meal-plans/${clientId}/${dietitianId}/${randomUUID()}.${extension}`;
const bytes = {
  jpg: new Blob([Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])], { type: 'image/jpeg' }),
  png: new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' }),
  webp: new Blob([new TextEncoder().encode('RIFF0000WEBPVP8 ')], { type: 'image/webp' }),
};
const upload = async (storageClient, path, body, contentType = body.type) => {
  objectPaths.add(path);
  return storageClient.storage.from(BUCKET).upload(path, body, { contentType, upsert: false });
};

try {
  const approved = await createActor('approved', 'dietitian');
  const foreign = await createActor('foreign', 'dietitian');
  const pending = await createActor('pending', 'dietitian');
  const rejected = await createActor('rejected', 'dietitian');
  const missing = await createActor('missing-profile', 'dietitian');
  const client = await createActor('client', 'client');
  const foreignClient = await createActor('foreign-client', 'client');
  await approve(approved); await approve(foreign); await approve(rejected, 'rejected');
  await activate(approved, client); await activate(foreign, foreignClient);
  const missingProfileDelete = await admin.from('profiles').delete().eq('id', missing.id);
  if (missingProfileDelete.error) throw missingProfileDelete.error;
  assert(sql(`select count(*) from public.profiles where id='${missing.id}'`) === '0', 'MISSING_PROFILE_FIXTURE_CONFIRMED');

  const api = {
    approved: await clientFor(approved), foreign: await clientFor(foreign),
    pending: await clientFor(pending), rejected: await clientFor(rejected),
    missing: await clientFor(missing), client: await clientFor(client),
    foreignClient: await clientFor(foreignClient),
  };
  const anonApi = anonymous();

  for (const [extension, mime] of [['jpg', 'image/jpeg'], ['png', 'image/png'], ['webp', 'image/webp']]) {
    const path = canonicalPath(client.id, approved.id, extension);
    const result = await upload(api.approved, path, bytes[extension], mime);
    assert(!result.error, `APPROVED_${extension.toUpperCase()}_HTTP_UPLOAD`, result.error?.message);
  }

  const deniedUploads = [
    ['FOREIGN_UPLOAD_DENY', api.foreign, canonicalPath(client.id, foreign.id), bytes.jpg, 'image/jpeg'],
    ['UNLINKED_CLIENT_NAMESPACE_UPLOAD_DENY', api.approved, canonicalPath(foreignClient.id, approved.id), bytes.jpg, 'image/jpeg'],
    ['PENDING_UPLOAD_DENY', api.pending, canonicalPath(client.id, pending.id), bytes.jpg, 'image/jpeg'],
    ['REJECTED_UPLOAD_DENY', api.rejected, canonicalPath(client.id, rejected.id), bytes.jpg, 'image/jpeg'],
    ['MISSING_PROFILE_UPLOAD_DENY', api.missing, canonicalPath(client.id, missing.id), bytes.jpg, 'image/jpeg'],
    ['ANON_UPLOAD_DENY', anonApi, canonicalPath(client.id, approved.id), bytes.jpg, 'image/jpeg'],
    ['WRONG_PATH_UPLOAD_DENY', api.approved, `recipes/${approved.id}/${randomUUID()}.jpg`, bytes.jpg, 'image/jpeg'],
  ];
  for (const [label, actor, path, body, mime] of deniedUploads) {
    const result = await upload(actor, path, body, mime);
    assertDenied(result.error, label);
  }

  let path = canonicalPath(client.id, approved.id, 'jpg');
  let result = await upload(api.approved, path, new Blob([bytes.jpg], { type: 'image/gif' }), 'image/gif');
  assert(Boolean(result.error) && /mime|content.?type|not supported/i.test(result.error.message), 'BUCKET_UNSUPPORTED_MIME_DENY', result.error?.message);
  assertDenied(result.error, 'BUCKET_UNSUPPORTED_MIME_SAFE_ERROR');
  path = canonicalPath(client.id, approved.id, 'jpg');
  result = await upload(api.approved, path, new Blob([new Uint8Array(5242881)], { type: 'image/jpeg' }), 'image/jpeg');
  assert(Boolean(result.error) && /size|maximum|limit|large/i.test(result.error.message), 'BUCKET_OVER_5_MIB_DENY', result.error?.message);
  assertDenied(result.error, 'BUCKET_OVER_5_MIB_SAFE_ERROR');

  const referencedPath = canonicalPath(client.id, approved.id, 'jpg');
  result = await upload(api.approved, referencedPath, bytes.jpg, 'image/jpeg');
  assert(!result.error, 'UPLOAD_NEW_PATH_UPSERT_FALSE_FIRST_PASS', result.error?.message);
  result = await upload(api.approved, referencedPath, bytes.jpg, 'image/jpeg');
  assertDenied(result.error, 'UPLOAD_NEW_PATH_UPSERT_FALSE_DUPLICATE_DENY');

  const planId = randomUUID(); const mealId = randomUUID();
  result = await admin.from('meal_plans').insert({ id: planId, client_id: client.id, dietitian_id: approved.id, plan_date: '2099-12-01' });
  if (result.error) throw result.error;
  result = await admin.from('meals').insert({ id: mealId, plan_id: planId, type: 'breakfast', title: 'Disposable HTTP harness', photo_url: referencedPath, source: 'manual' });
  if (result.error) throw result.error;

  for (const [label, actor, expected] of [
    ['APPROVED_PRIVATE_READ', api.approved, true], ['LINKED_CLIENT_PRIVATE_READ', api.client, true],
    ['FOREIGN_CLIENT_PRIVATE_READ_DENY', api.foreignClient, false],
    ['FOREIGN_PRIVATE_READ_DENY', api.foreign, false], ['PENDING_PRIVATE_READ_DENY', api.pending, false],
    ['REJECTED_PRIVATE_READ_DENY', api.rejected, false], ['MISSING_PROFILE_PRIVATE_READ_DENY', api.missing, false],
    ['ANON_PRIVATE_READ_DENY', anonApi, false],
  ]) {
    const download = await actor.storage.from(BUCKET).download(referencedPath);
    if (expected) assert(!download.error, label, download.error?.message);
    else assertDenied(download.error, label);
  }

  const replacementPath = canonicalPath(client.id, approved.id, 'webp');
  result = await upload(api.approved, replacementPath, bytes.webp, 'image/webp');
  if (result.error) throw result.error;
  result = await admin.from('meals').update({ photo_url: replacementPath }).eq('id', mealId);
  if (result.error) throw result.error;
  assert(sql(`select count(*) from public.meal_photo_cleanup_queue where object_path='${referencedPath}' and completed_at is null`) === '1', 'REPLACEMENT_QUEUE_CREATED');
  const { data: claimed, error: claimError } = await admin.rpc('claim_meal_photo_cleanup_batch', { p_limit: 10 });
  if (claimError) throw claimError;
  const claim = claimed.find((row) => row.object_path === referencedPath);
  assert(Boolean(claim), 'CLEANUP_WORKER_CLAIM');
  result = await admin.storage.from(BUCKET).remove([referencedPath]);
  if (result.error) throw result.error;
  const completed = await admin.rpc('complete_meal_photo_cleanup', { p_cleanup_id: claim.cleanup_id });
  assert(!completed.error && completed.data === true, 'CLEANUP_WORKER_COMPLETE', completed.error?.message);
  assert(sql(`select count(*) from storage.objects where bucket_id='meal-photos' and name='${replacementPath}'`) === '1', 'ACTIVE_REPLACEMENT_REMAINS');
  assert(sql(`select count(*) from storage.objects where bucket_id='meal-photos' and name='${referencedPath}'`) === '0', 'OLD_OBJECT_REMOVED');
} finally {
  if (objectPaths.size) await admin.storage.from(BUCKET).remove([...objectPaths]);
  const exactPaths = [...objectPaths].map((path) => `'${path.replaceAll("'", "''")}'`).join(',');
  if (exactPaths) sql(`delete from public.meal_photo_cleanup_queue where object_path in (${exactPaths});`);
  sql("delete from public.meals where title='Disposable HTTP harness'; delete from public.meal_plans where plan_date='2099-12-01';");
  for (const id of actorIds.reverse()) await admin.auth.admin.deleteUser(id);
}

process.stdout.write('MEAL_PHOTO_STORAGE_HTTP_HARNESS_PASS\n');
