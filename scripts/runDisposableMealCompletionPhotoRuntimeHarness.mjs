#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';
import { assertCiSafeEnvironment } from './ciSafetyGuard.mjs';
import { addCurrentIsolatedMigrations } from './addCurrentIsolatedMigrations.mjs';
import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-MealCompletionPhoto-4m!';
const projectId = `dietbridge-completion-${process.pid}-${randomUUID().slice(0, 8)}`;
const completionBucket = 'meal-completion-photos';
const mealPhotoBucket = 'meal-photos';
const recipePhotoBucket = 'recipe-images';
const migrationName = '20260831190352_meal_completion_photo_contract.sql';

const npxCandidates = [
  process.env.npm_execpath ? join(dirname(process.env.npm_execpath), 'npx-cli.js') : null,
  process.env.ProgramFiles ? join(process.env.ProgramFiles, 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js') : null,
  join('C:\\Program Files', 'nodejs', 'node_modules', 'npm', 'bin', 'npx-cli.js'),
  join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js'),
].filter((candidate, index, all) => candidate && all.indexOf(candidate) === index);
const npxCli = npxCandidates.find((candidate) => existsSync(candidate));
if (!npxCli) throw new Error('Pinned local npx CLI entry point is unavailable.');

const actorIds = [];
const relationshipIds = [];
const subscriptionDietitianIds = [];
const planIds = [];
const mealIds = [];
const recipeIds = [];
const storagePaths = new Set();
let disposable;
let local;
let admin;
let stackStartAttempted = false;
let stackStarted = false;
let mainError;

assertCiSafeEnvironment();

const pass = (label, detail = '') => process.stdout.write(`PASS: ${label}${detail ? ` ${detail}` : ''}\n`);
const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  pass(label, detail);
};
const assertNoError = (result, label) => {
  if (!result || result.error) throw new Error(`${label}: ${result?.error ? JSON.stringify(result.error) : 'missing result'}`);
  return result.data;
};
const assertDenied = (result, label) => {
  assert(Boolean(result?.error), label, result?.error?.code ?? result?.error?.message ?? 'denied');
};
const cleanEnvironment = (environment) => Object.fromEntries(
  Object.entries(environment).filter(([key]) => !(
    /^(?:SUPABASE|VITE_SUPABASE|EXPO_PUBLIC_SUPABASE|DATABASE_URL$|POSTGRES_|PGHOST$|PGPORT$|PGDATABASE$|PGUSER$|PGPASSWORD$|PGSERVICE$)/.test(key)
  )),
);

const runCli = (tempRoot, args) => {
  try {
    return execFileSync(process.execPath, [
      npxCli,
      '--yes',
      `supabase@${SUPABASE_VERSION}`,
      '--workdir',
      tempRoot,
      ...args,
    ], {
      cwd: repoRoot,
      encoding: 'utf8',
      env: cleanEnvironment(process.env),
      maxBuffer: 32 * 1024 * 1024,
      timeout: 15 * 60 * 1000,
    });
  } catch (error) {
    throw new Error(`Supabase ${args.join(' ')} failed: ${error.message}\n${String(error.stdout ?? '').slice(-6000)}\n${String(error.stderr ?? '').slice(-6000)}`);
  }
};

const parseStatus = (value) => Object.fromEntries(value.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
  .filter(Boolean)
  .map((match) => [match[1], match[2]]));

const isPortFree = (port) => new Promise((resolvePromise) => {
  const server = createServer();
  server.once('error', () => resolvePromise(false));
  server.listen(port, '127.0.0.1', () => server.close(() => resolvePromise(true)));
});

const choosePortBase = async () => {
  const first = 59000 + (process.pid % 400);
  for (let offset = 0; offset < 4000; offset += 20) {
    const base = first + offset;
    const ports = [base, base + 1, base + 2, base + 3, base + 4, base + 7, base + 9, base + 83];
    if ((await Promise.all(ports.map(isPortFree))).every(Boolean)) return base;
  }
  throw new Error('No disposable loopback port range is available.');
};

const configureDisposableProject = async (configPath) => {
  const base = await choosePortBase();
  const config = readFileSync(configPath, 'utf8')
    .replace(/^project_id\s*=\s*"[^"]+"$/m, `project_id = "${projectId}"`)
    .replace(/^port\s*=\s*54321$/m, `port = ${base}`)
    .replace(/^port\s*=\s*54322$/m, `port = ${base + 1}`)
    .replace(/^shadow_port\s*=\s*54320$/m, `shadow_port = ${base + 2}`)
    .replace(/^port\s*=\s*54329$/m, `port = ${base + 9}`)
    .replace(/^port\s*=\s*54323$/m, `port = ${base + 3}`)
    .replace(/^port\s*=\s*54324$/m, `port = ${base + 4}`)
    .replace(/^port\s*=\s*54327$/m, `port = ${base + 7}`)
    .replace(/^inspector_port\s*=\s*8083$/m, `inspector_port = ${base + 83}`);
  writeFileSync(configPath, config, 'utf8');
};

const createAnonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActorClient = async (actor) => {
  const session = assertNoError(
    await createAnonymousClient().auth.signInWithPassword({ email: actor.email, password: PASSWORD }),
    `${actor.label} sign-in`,
  );
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const createActor = async (label, role) => {
  const email = `meal-completion-${label}-${randomUUID()}@example.invalid`;
  const result = assertNoError(await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: `Disposable ${label}`,
      meal_completion_photo_harness: 'disposable-only',
    },
  }), `${label} Auth fixture`);
  assert(Boolean(result.user?.id), `${label.toUpperCase()}_AUTH_CREATED`);
  actorIds.push(result.user.id);
  return { id: result.user.id, email, label, role };
};

const approveDietitian = async (actor) => {
  const row = assertNoError(await admin.from('dietitian_profiles').update({
    verification_status: 'approved',
    is_verified: true,
    verified_at: '2026-08-31T12:00:00.000Z',
  }).eq('user_id', actor.id).select('user_id,verification_status,is_verified').single(), `${actor.label} approval`);
  assert(row.verification_status === 'approved' && row.is_verified === true, `${actor.label.toUpperCase()}_APPROVED`);
};

const bootstrapDietitian = async (actor) => {
  const row = assertNoError(await admin.from('dietitian_subscriptions').upsert({
    dietitian_id: actor.id,
    plan_id: 'core',
    status: 'active',
    client_limit_override: null,
  }).select('dietitian_id,plan_id,status').single(), `${actor.label} subscription`);
  subscriptionDietitianIds.push(row.dietitian_id);
  assert(row.plan_id === 'core' && row.status === 'active', `${actor.label.toUpperCase()}_CORE_SUBSCRIPTION`);
};

const activateRelationship = async (dietitian, client, status = 'active') => {
  const row = assertNoError(await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id,
    client_id: client.id,
    status: 'pending',
  }).select('id').single(), `${dietitian.label}/${client.label} relationship`);
  relationshipIds.push(row.id);
  const transitionStatus = status === 'removed' ? 'active' : status;
  const updated = assertNoError(await admin.from('dietitian_clients').update({
    status: transitionStatus,
    accepted_at: transitionStatus === 'active' ? '2026-08-31T12:00:00.000Z' : null,
    removed_at: null,
  }).eq('id', row.id).select('id,dietitian_id,client_id,status').single(), `${dietitian.label}/${client.label} relationship status`);
  if (status === 'removed') {
    return assertNoError(await admin.from('dietitian_clients').update({
      status: 'removed',
      removed_at: '2026-08-31T12:00:00.000Z',
    }).eq('id', row.id).select('id,dietitian_id,client_id,status').single(), `${dietitian.label}/${client.label} relationship removal`);
  }
  assert(updated.status === status, `${dietitian.label.toUpperCase()}_${client.label.toUpperCase()}_${status.toUpperCase()}_RELATION`);
  return updated;
};

const uploadFixture = async (bucket, path, body, contentType) => {
  storagePaths.add(`${bucket}:${path}`);
  return admin.storage.from(bucket).upload(path, body, { contentType, upsert: false });
};

const readMeal = async (mealId) => assertNoError(await admin.from('meals')
  .select('id,plan_id,is_eaten,completed_at,completion_photo_url,photo_url,recipe_id')
  .eq('id', mealId)
  .single(), `Meal ${mealId} read`);

const readQueue = async (path) => {
  const rows = runSql(`select id::text, object_path, reason, coalesce(completed_at::text, ''), attempt_count::text from public.meal_completion_photo_cleanup_queue where object_path = '${path}' order by created_at desc`);
  return rows
    ? rows.split(/\r?\n/).filter(Boolean).map((row) => {
      const [id, objectPath, reason, completedAt, attemptCount] = row.split('|');
      return {
        id,
        object_path: objectPath,
        reason,
        completed_at: completedAt || null,
        attempt_count: Number(attemptCount),
      };
    })
    : [];
};

const runSql = (statement) => execFileSync('docker', [
  'exec', `supabase_db_${projectId}`, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'postgres', '-Atc', statement,
], { encoding: 'utf8', timeout: 30_000 }).trim();

const runFlows = async () => {
  const dietitianA = await createActor('dietitian-a', 'dietitian');
  const dietitianB = await createActor('dietitian-b', 'dietitian');
  const clientA = await createActor('client-a', 'client');
  const clientB = await createActor('client-b', 'client');
  await approveDietitian(dietitianA);
  await approveDietitian(dietitianB);
  await bootstrapDietitian(dietitianA);
  await bootstrapDietitian(dietitianB);
  await activateRelationship(dietitianA, clientA);
  const clientBRelation = await activateRelationship(dietitianA, clientB);
  assert(clientBRelation.status === 'active', 'ACTIVE_RELATION_FIXTURE_READY');

  const clientAApi = await createActorClient(clientA);
  const clientBApi = await createActorClient(clientB);
  const dietitianAApi = await createActorClient(dietitianA);
  const dietitianBApi = await createActorClient(dietitianB);
  const anonymous = createAnonymousClient();

  const recipeId = randomUUID();
  const recipeImagePath = `recipes/${dietitianA.id}/${recipeId}/${randomUUID()}.jpg`;
  recipeIds.push(recipeId);
  assertNoError(await admin.from('recipes').insert({
    id: recipeId,
    dietitian_id: dietitianA.id,
    name: 'Disposable recipe snapshot',
    description: 'Recipe master remains unchanged during completion.',
    meal_type: 'breakfast',
    calories: 420,
    protein: 30,
    carbs: 45,
    fat: 14,
    image_path: recipeImagePath,
  }), 'Recipe fixture');
  await uploadFixture(
    recipePhotoBucket,
    recipeImagePath,
    new Blob([Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])], { type: 'image/jpeg' }),
    'image/jpeg',
  );

  const planAId = randomUUID();
  const planBId = randomUUID();
  const manualMealId = randomUUID();
  const recipeMealId = randomUUID();
  const foreignMealId = randomUUID();
  const manualSnapshotPath = `meal-plans/${clientA.id}/${dietitianA.id}/${randomUUID()}.jpg`;
  planIds.push(planAId, planBId);
  mealIds.push(manualMealId, recipeMealId, foreignMealId);
  await uploadFixture(
    mealPhotoBucket,
    manualSnapshotPath,
    new Blob([Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])], { type: 'image/jpeg' }),
    'image/jpeg',
  );
  assertNoError(await admin.from('meal_plans').insert([
    { id: planAId, client_id: clientA.id, dietitian_id: dietitianA.id, plan_date: '2099-12-01', notes: 'Completion photo plan' },
    { id: planBId, client_id: clientB.id, dietitian_id: dietitianA.id, plan_date: '2099-12-01', notes: 'Foreign/inactive plan' },
  ]), 'Meal plan fixtures');
  assertNoError(await admin.from('meals').insert([
    {
      id: manualMealId,
      plan_id: planAId,
      type: 'breakfast',
      title: 'Disposable manual meal',
      calories: 420,
      macros: { protein: 30, carbs: 45, fat: 14 },
      time: '08:00',
      sort_order: 0,
      source: 'manual',
      recipe_id: null,
      photo_url: manualSnapshotPath,
    },
    {
      id: recipeMealId,
      plan_id: planAId,
      type: 'lunch',
      title: 'Disposable recipe meal',
      calories: 510,
      macros: { protein: 35, carbs: 52, fat: 18 },
      time: '13:00',
      sort_order: 1,
      source: 'recipe',
      recipe_id: recipeId,
      photo_url: recipeImagePath,
    },
    {
      id: foreignMealId,
      plan_id: planBId,
      type: 'dinner',
      title: 'Disposable foreign meal',
      calories: 600,
      macros: { protein: 40, carbs: 60, fat: 20 },
      time: '19:00',
      sort_order: 0,
      source: 'manual',
      recipe_id: null,
      photo_url: null,
    },
  ]), 'Meal fixtures');
  assert(runSql(`select count(*) from public.meals where id in ('${manualMealId}','${recipeMealId}','${foreignMealId}')`) === '3', 'MEAL_FIXTURES_PRESENT');

  const initialManual = await readMeal(manualMealId);
  const initialRecipe = await readMeal(recipeMealId);
  const initialMasterRecipe = assertNoError(await admin.from('recipes').select('*').eq('id', recipeId).single(), 'Recipe master before completion');

  // Legacy two-argument clients remain valid and explicitly mean no photo.
  assertNoError(await clientAApi.rpc('set_my_meal_completion', {
    p_meal_id: manualMealId,
    p_is_eaten: true,
  }), 'Legacy two-argument completion');
  const noPhotoCompletion = await readMeal(manualMealId);
  assert(noPhotoCompletion.is_eaten === true && typeof noPhotoCompletion.completed_at === 'string', 'CLIENT_COMPLETES_WITHOUT_PHOTO');
  assert(noPhotoCompletion.completion_photo_url === null, 'NO_PHOTO_COMPLETION_PATH_NULL');
  assert(noPhotoCompletion.photo_url === initialManual.photo_url && noPhotoCompletion.recipe_id === initialManual.recipe_id, 'NO_PHOTO_PLAN_PROVENANCE_UNCHANGED');

  // A client may upload only its own active meal namespace. A foreign meal
  // identifier is rejected before an object can become an orphan.
  const foreignClientUploadPath = `${clientB.id}/${manualMealId}/${randomUUID()}.jpg`;
  assertDenied(await clientBApi.storage.from(completionBucket).upload(
    foreignClientUploadPath,
    new Blob([Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])], { type: 'image/jpeg' }),
    { contentType: 'image/jpeg', upsert: false },
  ), 'FOREIGN_CLIENT_UPLOAD_DENY');
  const dietitianUploadPath = `${dietitianA.id}/${manualMealId}/${randomUUID()}.jpg`;
  assertDenied(await dietitianAApi.storage.from(completionBucket).upload(
    dietitianUploadPath,
    new Blob([Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])], { type: 'image/jpeg' }),
    { contentType: 'image/jpeg', upsert: false },
  ), 'NON_CLIENT_UPLOAD_DENY');
  const completionPathOne = `${clientA.id}/${manualMealId}/${randomUUID()}.jpg`;
  const ownUpload = await clientAApi.storage.from(completionBucket).upload(
    completionPathOne,
    new Blob([Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])], { type: 'image/jpeg' }),
    { contentType: 'image/jpeg', upsert: false },
  );
  storagePaths.add(`${completionBucket}:${completionPathOne}`);
  assertNoError(ownUpload, 'OWN_COMPLETION_PHOTO_UPLOAD');

  assertNoError(await clientAApi.rpc('set_my_meal_completion_with_photo', {
    p_meal_id: manualMealId,
    p_is_eaten: true,
    p_completion_photo_url: completionPathOne,
  }), 'Own completion with valid photo');
  const completedWithPhoto = await readMeal(manualMealId);
  assert(completedWithPhoto.is_eaten === true && completedWithPhoto.completion_photo_url === completionPathOne, 'CLIENT_COMPLETES_WITH_OWN_PHOTO');
  assert(completedWithPhoto.photo_url === initialManual.photo_url && completedWithPhoto.recipe_id === initialManual.recipe_id, 'COMPLETION_PHOTO_DOES_NOT_OVERWRITE_MEAL_SNAPSHOT');

  const replacementPath = `${clientA.id}/${manualMealId}/${randomUUID()}.jpg`;
  const replacementUpload = await clientAApi.storage.from(completionBucket).upload(
    replacementPath,
    new Blob([Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])], { type: 'image/jpeg' }),
    { contentType: 'image/jpeg', upsert: false },
  );
  storagePaths.add(`${completionBucket}:${replacementPath}`);
  assertNoError(replacementUpload, 'REPLACEMENT_COMPLETION_PHOTO_UPLOAD');
  assertNoError(await clientAApi.rpc('set_my_meal_completion_with_photo', {
    p_meal_id: manualMealId,
    p_is_eaten: true,
    p_completion_photo_url: replacementPath,
  }), 'Replacement completion photo');
  const replacementQueue = await readQueue(completionPathOne);
  assert(replacementQueue.some((row) => row.reason === 'replaced' && row.completed_at === null), 'REPLACED_COMPLETION_PHOTO_QUEUED');
  assert((await readMeal(manualMealId)).completion_photo_url === replacementPath, 'REPLACEMENT_COMPLETION_PHOTO_REFERENCED');

  // Completion evidence is readable only by the linked actors; the bucket is
  // not a public image source.
  for (const [label, actor, expected] of [
    ['CLIENT_COMPLETION_PHOTO_READ', clientAApi, true],
    ['LINKED_DIETITIAN_COMPLETION_PHOTO_READ', dietitianAApi, true],
    ['UNRELATED_CLIENT_COMPLETION_PHOTO_DENY', clientBApi, false],
    ['UNRELATED_DIETITIAN_COMPLETION_PHOTO_DENY', dietitianBApi, false],
    ['ANON_COMPLETION_PHOTO_DENY', anonymous, false],
  ]) {
    const download = await actor.storage.from(completionBucket).download(replacementPath);
    if (expected) assertNoError(download, label);
    else assertDenied(download, label);
  }

  // The separate recipe-derived snapshot must remain byte-for-byte equivalent.
  const recipeCompletionPath = `${clientA.id}/${recipeMealId}/${randomUUID()}.jpg`;
  const recipePhotoUpload = await clientAApi.storage.from(completionBucket).upload(
    recipeCompletionPath,
    new Blob([Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])], { type: 'image/jpeg' }),
    { contentType: 'image/jpeg', upsert: false },
  );
  storagePaths.add(`${completionBucket}:${recipeCompletionPath}`);
  assertNoError(recipePhotoUpload, 'RECIPE_COMPLETION_PHOTO_UPLOAD');
  assertNoError(await clientAApi.rpc('set_my_meal_completion_with_photo', {
    p_meal_id: recipeMealId,
    p_is_eaten: true,
    p_completion_photo_url: recipeCompletionPath,
  }), 'Recipe meal completion with photo');
  const completedRecipe = await readMeal(recipeMealId);
  const finalMasterRecipe = assertNoError(await admin.from('recipes').select('*').eq('id', recipeId).single(), 'Recipe master after completion');
  assert(completedRecipe.is_eaten === true && completedRecipe.completion_photo_url === recipeCompletionPath, 'RECIPE_MEAL_COMPLETION_PHOTO_PERSISTED');
  assert(completedRecipe.photo_url === initialRecipe.photo_url && completedRecipe.recipe_id === initialRecipe.recipe_id, 'RECIPE_MEAL_SNAPSHOT_UNCHANGED');
  assert(JSON.stringify(finalMasterRecipe) === JSON.stringify(initialMasterRecipe), 'RECIPE_MASTER_BEFORE_AFTER_EQUAL');

  // All authorization and malformed-path failures leave the target state as
  // it was and never grant cross-tenant access.
  const beforeDeniedCalls = await readMeal(manualMealId);
  const foreignPath = `${clientB.id}/${foreignMealId}/${randomUUID()}.jpg`;
  const nonexistentPath = `${clientA.id}/${manualMealId}/${randomUUID()}.jpg`;
  const failurePath = `${clientB.id}/${foreignMealId}/${randomUUID()}.jpg`;
  const failureUpload = await clientBApi.storage.from(completionBucket).upload(
    failurePath,
    new Blob([Uint8Array.from([255, 216, 255, 224, 0, 16, 74, 70, 73, 70, 0, 1, 255, 217])], { type: 'image/jpeg' }),
    { contentType: 'image/jpeg', upsert: false },
  );
  storagePaths.add(`${completionBucket}:${failurePath}`);
  assertNoError(failureUpload, 'FAILURE_PATH_UPLOAD');
  const inactiveRelation = assertNoError(await admin.from('dietitian_clients').update({
    status: 'removed',
    removed_at: '2026-08-31T12:00:00.000Z',
  }).eq('id', clientBRelation.id).select('id,dietitian_id,client_id,status').single(), 'Client-B relationship removal');
  assert(inactiveRelation.status === 'removed', 'INACTIVE_RELATION_FIXTURE_READY');
  assertDenied(await clientAApi.rpc('set_my_meal_completion', {
    p_meal_id: foreignMealId,
    p_is_eaten: true,
  }), 'FOREIGN_CLIENT_MEAL_REJECTED');
  assertDenied(await dietitianAApi.rpc('set_my_meal_completion', {
    p_meal_id: manualMealId,
    p_is_eaten: true,
  }), 'NON_CLIENT_ROLE_REJECTED');
  assertDenied(await clientBApi.rpc('set_my_meal_completion', {
    p_meal_id: foreignMealId,
    p_is_eaten: true,
  }), 'INACTIVE_RELATION_REJECTED');
  assertDenied(await clientAApi.rpc('set_my_meal_completion_with_photo', {
    p_meal_id: manualMealId,
    p_is_eaten: true,
    p_completion_photo_url: foreignPath,
  }), 'FOREIGN_COMPLETION_PHOTO_PATH_REJECTED');
  assertDenied(await clientAApi.rpc('set_my_meal_completion_with_photo', {
    p_meal_id: manualMealId,
    p_is_eaten: true,
    p_completion_photo_url: 'not-a-canonical-path',
  }), 'MALFORMED_COMPLETION_PHOTO_PATH_REJECTED');
  assertDenied(await clientAApi.rpc('set_my_meal_completion_with_photo', {
    p_meal_id: manualMealId,
    p_is_eaten: true,
    p_completion_photo_url: nonexistentPath,
  }), 'NONEXISTENT_COMPLETION_OBJECT_REJECTED');
  assert(JSON.stringify(await readMeal(manualMealId)) === JSON.stringify(beforeDeniedCalls), 'DENIED_COMPLETION_STATE_UNCHANGED');

  // Simulate upload success followed by an inactive-relation failure. The
  // meal stays incomplete and the client can enqueue only its own object.
  const beforeFailureCall = await readMeal(foreignMealId);
  assertDenied(await clientBApi.rpc('set_my_meal_completion_with_photo', {
    p_meal_id: foreignMealId,
    p_is_eaten: true,
    p_completion_photo_url: failurePath,
  }), 'RPC_FAILURE_AFTER_UPLOAD_REJECTED');
  assert(JSON.stringify(await readMeal(foreignMealId)) === JSON.stringify(beforeFailureCall), 'RPC_FAILURE_LEAVES_MEAL_UNCHANGED');
  assertNoError(await clientBApi.rpc('enqueue_my_unreferenced_meal_completion_photo_cleanup', {
    p_object_path: failurePath,
  }), 'FAILED_UPLOAD_ORPHAN_ENQUEUED');
  assert((await readQueue(failurePath)).some((row) => row.completed_at === null), 'FAILED_UPLOAD_ORPHAN_PENDING');

  // Undo clears both completion metadata fields; a later no-photo completion
  // must not resurrect the previous evidence path.
  assertNoError(await clientAApi.rpc('set_my_meal_completion', {
    p_meal_id: manualMealId,
    p_is_eaten: false,
  }), 'Undo completion');
  const undone = await readMeal(manualMealId);
  assert(undone.is_eaten === false && undone.completed_at === null && undone.completion_photo_url === null, 'UNDO_CLEARS_COMPLETION_PHOTO_AND_TIMESTAMP');
  assert(undone.photo_url === initialManual.photo_url, 'UNDO_PRESERVES_MEAL_SNAPSHOT');
  assert((await readQueue(replacementPath)).some((row) => row.reason === 'meal_undone' && row.completed_at === null), 'UNDO_QUEUES_OLD_COMPLETION_PHOTO');
  assertNoError(await clientAApi.rpc('set_my_meal_completion', {
    p_meal_id: manualMealId,
    p_is_eaten: true,
  }), 'Re-complete without photo');
  const recompleted = await readMeal(manualMealId);
  assert(recompleted.is_eaten === true && typeof recompleted.completed_at === 'string' && recompleted.completion_photo_url === null, 'RECOMPLETE_WITHOUT_PHOTO_DOES_NOT_RESURRECT_STALE_PATH');

  // Service-role worker claims only unreferenced paths and marks them complete
  // only after the Storage object has actually disappeared.
  const claimed = assertNoError(await admin.rpc('claim_meal_completion_photo_cleanup_batch', { p_limit: 50 }), 'Completion cleanup worker claim');
  const claimedPaths = new Set((claimed ?? []).map((row) => row.object_path));
  for (const path of [completionPathOne, replacementPath, failurePath]) {
    assert(claimedPaths.has(path), 'CLEANUP_WORKER_CLAIMS_UNREFERENCED_PATH', path);
  }
  for (const row of claimed ?? []) {
    assertNoError(await admin.storage.from(completionBucket).remove([row.object_path]), 'Completion cleanup object delete');
    assertNoError(await admin.rpc('complete_meal_completion_photo_cleanup', { p_cleanup_id: row.cleanup_id }), 'Completion cleanup worker complete');
  }
  assert((await readQueue(completionPathOne)).some((row) => row.completed_at !== null), 'CLEANUP_QUEUE_COMPLETION_PATH_ONE_DONE');
  assert((await readQueue(replacementPath)).some((row) => row.completed_at !== null), 'CLEANUP_QUEUE_REPLACEMENT_DONE');
  assert((await readQueue(failurePath)).some((row) => row.completed_at !== null), 'CLEANUP_QUEUE_FAILURE_PATH_DONE');
};

const run = async () => {
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  addCurrentIsolatedMigrations({ repoRoot, tempRoot: disposable.tempRoot });
  const migrationDirectory = join(disposable.tempRoot, 'supabase', 'migrations');
  const migrationFiles = readdirSync(migrationDirectory).filter((name) => /^\d+_.+\.sql$/.test(name));
  assert(migrationFiles.includes(migrationName), 'COMPLETION_MIGRATION_MATERIALIZED');
  assert(migrationFiles.length === 59, 'DISPOSABLE_MIGRATION_CHAIN_59');
  await configureDisposableProject(disposable.configPath);
  stackStartAttempted = true;
  runCli(disposable.tempRoot, ['start']);
  stackStarted = true;
  pass('DISPOSABLE_LOCAL_STACK_STARTED', projectId);
  runCli(disposable.tempRoot, ['db', 'reset', '--local', '--no-seed']);
  local = parseStatus(runCli(disposable.tempRoot, ['status', '--output', 'env']));
  assertCiSafeEnvironment({ SUPABASE_URL: local.API_URL }, { requireLoopback: true });
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? ''), 'LOOPBACK_API_ONLY');
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'DISPOSABLE_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  assert(runSql('select count(*) from supabase_migrations.schema_migrations') === '59', 'SCHEMA_MIGRATION_REPLAY_59');
  assert(runSql("select count(*) from pg_proc where proname = 'set_my_meal_completion_with_photo' and pronamespace = 'public'::regnamespace") === '1', 'COMPLETION_RPC_PRESENT');
  await runFlows();
  pass('MEAL_COMPLETION_PHOTO_RUNTIME_PASS');
};

try {
  await run();
} catch (error) {
  mainError = error;
} finally {
  if (admin) {
    try {
      for (const descriptor of storagePaths) {
        const separator = descriptor.indexOf(':');
        const bucket = descriptor.slice(0, separator);
        const path = descriptor.slice(separator + 1);
        await admin.storage.from(bucket).remove([path]);
      }
      if (mealIds.length) await admin.from('meals').delete().in('id', mealIds);
      if (mealIds.length) runSql(`delete from public.meal_completion_photo_cleanup_queue where meal_id in (${mealIds.map((id) => `'${id}'::uuid`).join(',')})`);
      if (planIds.length) await admin.from('meal_plans').delete().in('id', planIds);
      if (recipeIds.length) await admin.from('recipes').delete().in('id', recipeIds);
      if (relationshipIds.length) await admin.from('dietitian_clients').delete().in('id', relationshipIds);
      if (subscriptionDietitianIds.length) await admin.from('dietitian_subscriptions').delete().in('dietitian_id', subscriptionDietitianIds);
      for (const actorId of [...actorIds].reverse()) await admin.auth.admin.deleteUser(actorId);
    } catch (cleanupError) {
      mainError = mainError
        ? new Error(`${mainError.message}; fixture cleanup failed: ${cleanupError.message}`)
        : cleanupError;
    }
  }
  if (stackStartAttempted && disposable?.tempRoot) {
    try {
      runCli(disposable.tempRoot, ['stop']);
    } catch (stopError) {
      mainError = mainError
        ? new Error(`${mainError.message}; local stack stop failed: ${stopError.message}`)
        : stopError;
    }
  }
  if (disposable?.tempRoot) {
    try {
      rmSync(dirname(disposable.tempRoot), { recursive: true, force: true });
    } catch (removeError) {
      mainError = mainError
        ? new Error(`${mainError.message}; disposable workdir cleanup failed: ${removeError.message}`)
        : removeError;
    }
  }
}

if (mainError) {
  process.stderr.write(`[meal-completion-photo-runtime] ${mainError.message}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write('MEAL_COMPLETION_PHOTO_RUNTIME_HARNESS_PASS\n');
}
