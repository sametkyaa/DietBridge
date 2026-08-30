import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

import { runDisposableSupabaseLocalReplay } from './runDisposableSupabaseLocalReplay.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SUPABASE_VERSION = '2.110.0';
const PASSWORD = 'Disposable-NOTES-Only-9b!';
const projectId = `dietbridge-notes-${process.pid}-${randomUUID().slice(0, 8)}`;
const npxCli = join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
const actorIds = [];
const noteIds = [];
const relationshipIds = [];
const browserManifestPath = join(tmpdir(), 'dietbridge-notes-browser-manifest.json');
const browserDonePath = `${browserManifestPath}.done`;
let disposable;
let local;
let admin;
let stackStarted = false;
let stackStartAttempted = false;
let mainError;
let signalCleanupRunning = false;

const cleanEnvironment = ({
  SUPABASE_ACCESS_TOKEN: _accessToken,
  SUPABASE_TOKEN: _token,
  SUPABASE_DB_PASSWORD: _databasePassword,
  SUPABASE_SERVICE_ROLE_KEY: _serviceRole,
  SUPABASE_URL: _remoteUrl,
  SUPABASE_ANON_KEY: _remoteAnon,
  VITE_SUPABASE_URL: _remoteViteUrl,
  VITE_SUPABASE_ANON_KEY: _remoteViteAnon,
  ...environment
}) => ({ ...environment, TZ: 'Europe/Istanbul' });

const cli = (args, options = {}) => execFileSync(process.execPath, [
  npxCli,
  '--yes',
  `supabase@${SUPABASE_VERSION}`,
  '--workdir',
  disposable.tempRoot,
  ...args,
], {
  cwd: repoRoot,
  encoding: 'utf8',
  env: cleanEnvironment(process.env),
  maxBuffer: 16 * 1024 * 1024,
  timeout: 10 * 60 * 1000,
  ...options,
});

const pass = (label, detail = '') => {
  process.stdout.write(`PASS: ${label}${detail ? ` ${detail}` : ''}\n`);
};

const assert = (condition, label, detail = '') => {
  if (!condition) throw new Error(`${label}${detail ? `: ${detail}` : ''}`);
  pass(label, detail);
};

const assertNoError = (result, label) => {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
};

const assertNoRows = (result, label) => {
  if (result.error) {
    pass(label, `denied=${result.error.code ?? result.error.name ?? 'error'}`);
    return;
  }
  const rows = Array.isArray(result.data) ? result.data : result.data ? [result.data] : [];
  assert(rows.length === 0, label, `unexpected_rows=${rows.length}`);
};

const parseStatus = (value) => Object.fromEntries(value.split(/\r?\n/)
  .map((line) => line.match(/^([A-Z_]+)="(.*)"$/))
  .filter(Boolean)
  .map((match) => [match[1], match[2]]));

const anonymousClient = () => createClient(local.API_URL, local.ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const createActor = async (label, role) => {
  const email = `notes-${label}-${randomUUID()}@example.invalid`;
  const result = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: {
      account_type: role,
      role,
      full_name: `Disposable ${label}`,
      mvp7_harness: 'disposable-test-identity',
    },
  });
  const user = assertNoError(result, `${label} auth fixture`);
  assert(user.user?.id, `${label.toUpperCase()}_AUTH_CREATED`);
  actorIds.push(user.user.id);
  return { id: user.user.id, email, label, role, disposableTestIdentity: true };
};

const actorClient = async (actor) => {
  const signIn = anonymousClient();
  const session = assertNoError(
    await signIn.auth.signInWithPassword({ email: actor.email, password: PASSWORD }),
    `${actor.label} local sign-in`,
  );
  return createClient(local.API_URL, local.ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${session.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
};

const verifyDietitian = async (actor, verificationStatus) => {
  const result = await admin.from('dietitian_profiles').update({
    verification_status: verificationStatus,
    is_verified: verificationStatus === 'approved',
    verified_at: verificationStatus === 'approved' ? new Date().toISOString() : null,
    rejection_reason: verificationStatus === 'rejected' ? 'Disposable rejection' : null,
  }).eq('user_id', actor.id).select('user_id,verification_status,is_verified').single();
  const row = assertNoError(result, `${actor.label} verification fixture`);
  assert(
    row.verification_status === verificationStatus,
    `${actor.label.toUpperCase()}_${verificationStatus.toUpperCase()}_FIXTURE`,
  );
};

const bootstrapDisposableCore = async (dietitian) => {
  assert(
    local.API_URL.startsWith('http://127.0.0.1:') || local.API_URL.startsWith('http://localhost:'),
    'DISPOSABLE_BOOTSTRAP_LOOPBACK_ONLY',
  );
  assert(
    dietitian.role === 'dietitian'
      && dietitian.disposableTestIdentity === true
      && dietitian.email.endsWith('@example.invalid'),
    'DISPOSABLE_BOOTSTRAP_IDENTITY_EXPLICITLY_VERIFIED',
    dietitian.email,
  );
  const user = assertNoError(
    await admin.auth.admin.getUserById(dietitian.id),
    `${dietitian.label} bootstrap Auth identity read`,
  );
  assert(
    user.user?.user_metadata?.mvp7_harness === 'disposable-test-identity',
    'DISPOSABLE_BOOTSTRAP_METADATA_VERIFIED',
    dietitian.email,
  );
  const profile = assertNoError(
    await admin.from('profiles').select('id,role').eq('id', dietitian.id).single(),
    `${dietitian.label} bootstrap profile read`,
  );
  const dietitianProfile = assertNoError(
    await admin.from('dietitian_profiles')
      .select('user_id,verification_status,is_verified')
      .eq('user_id', dietitian.id)
      .single(),
    `${dietitian.label} bootstrap dietitian profile read`,
  );
  assert(
    profile.role === 'dietitian'
      && dietitianProfile.verification_status === 'approved'
      && dietitianProfile.is_verified === true,
    'DISPOSABLE_BOOTSTRAP_APPROVED_DIETITIAN_VERIFIED',
    dietitian.email,
  );
  assertNoError(
    await admin.from('dietitian_subscriptions').upsert({
      dietitian_id: dietitian.id,
      plan_id: 'core',
      status: 'active',
      client_limit_override: null,
    }).select('dietitian_id').single(),
    `${dietitian.label} disposable Core bootstrap`,
  );
  pass('DISPOSABLE_TEST_CORE_BOOTSTRAP', dietitian.email);
};

const activateRelationship = async (dietitian, client) => {
  let result = await admin.from('dietitian_clients').insert({
    dietitian_id: dietitian.id,
    client_id: client.id,
    status: 'pending',
  }).select('id').single();
  const pending = assertNoError(result, 'relationship pending fixture');
  relationshipIds.push(pending.id);
  result = await admin.from('dietitian_clients').update({ status: 'active' })
    .eq('id', pending.id).select('id,status,accepted_at').single();
  const active = assertNoError(result, 'relationship active fixture');
  assert(active.status === 'active' && Boolean(active.accepted_at), 'ACTIVE_RELATIONSHIP_FIXTURE');
  return active.id;
};

const directNotePayload = (dietitianId, clientId, title) => ({
  dietitian_id: dietitianId,
  client_id: clientId,
  title,
  content: 'Disposable runtime note content',
});

const noteDraft = (overrides = {}) => ({
  clientId: null,
  title: 'Disposable general note',
  content: 'Disposable runtime note content',
  ...overrides,
});

const compileNoteService = () => {
  const sourceRoot = join(disposable.tempRoot, 'note-service-source');
  const buildRoot = join(disposable.tempRoot, 'note-service-build');
  const sources = [
    'features/notes/services/noteService.ts',
    'features/notes/types/note.ts',
    'features/notes/utils/noteContract.ts',
  ];
  for (const source of sources) {
    const destination = join(sourceRoot, source);
    mkdirSync(dirname(destination), { recursive: true });
    writeFileSync(destination, readFileSync(join(repoRoot, source)));
  }
  const proxyPath = join(sourceRoot, 'lib', 'supabaseClient.ts');
  mkdirSync(dirname(proxyPath), { recursive: true });
  writeFileSync(proxyPath, `let activeClient: any;
export const setSupabaseClient = (client: any) => { activeClient = client; };
export const supabase: any = new Proxy({}, {
  get: (_target, property) => {
    if (!activeClient) throw new Error('Disposable Supabase actor is not selected.');
    const value = activeClient[property];
    return typeof value === 'function' ? value.bind(activeClient) : value;
  },
});
`, 'utf8');
  execFileSync(process.execPath, [
    join(repoRoot, 'node_modules', 'typescript', 'bin', 'tsc'),
    '--rootDir', sourceRoot,
    '--outDir', buildRoot,
    '--module', 'commonjs',
    '--moduleResolution', 'node',
    '--target', 'ES2022',
    '--esModuleInterop',
    '--skipLibCheck',
    ...sources.map((source) => join(sourceRoot, source)),
    proxyPath,
  ], { cwd: repoRoot, encoding: 'utf8', timeout: 120_000 });
  const require = createRequire(import.meta.url);
  return {
    service: require(join(buildRoot, 'features', 'notes', 'services', 'noteService.js')),
    actorProxy: require(join(buildRoot, 'lib', 'supabaseClient.js')),
  };
};

const assertServiceError = async (operation, ServiceError, label) => {
  try {
    await operation();
  } catch (error) {
    assert(error instanceof ServiceError, label, `unexpected=${error?.constructor?.name ?? typeof error}`);
    return;
  }
  throw new Error(`${label}: operation unexpectedly succeeded`);
};

const waitForBrowserAcceptance = async (actor) => {
  if (process.env.NOTES_BROWSER_E2E !== '1') return;
  rmSync(browserManifestPath, { force: true });
  rmSync(browserDonePath, { force: true });
  writeFileSync(browserManifestPath, JSON.stringify({
    apiUrl: local.API_URL,
    anonKey: local.ANON_KEY,
    email: actor.email,
    password: PASSWORD,
    donePath: browserDonePath,
  }), { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  pass('BROWSER_ACCEPTANCE_READY', browserManifestPath);
  while (!existsSync(browserDonePath)) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  pass('BROWSER_ACCEPTANCE_COMPLETE');
};

const stopExactDisposableStack = () => {
  if (!disposable?.tempRoot || !stackStartAttempted || !stackStarted) return;
  cli(['stop', '--project-id', projectId, '--no-backup']);
  stackStarted = false;
};

const handleTerminationSignal = () => {
  if (signalCleanupRunning) return;
  signalCleanupRunning = true;
  try {
    stopExactDisposableStack();
    if (disposable?.tempRoot) rmSync(dirname(disposable.tempRoot), { recursive: true, force: true });
  } finally {
    process.exitCode = 130;
    process.exit();
  }
};

process.once('SIGINT', () => handleTerminationSignal('SIGINT'));
process.once('SIGTERM', () => handleTerminationSignal('SIGTERM'));

try {
  disposable = await runDisposableSupabaseLocalReplay({ materializeOnly: true, keepTemp: true });
  const configText = readFileSync(disposable.configPath, 'utf8');
  assert(/^project_id\s*=\s*"[^"]+"/m.test(configText), 'DISPOSABLE_CONFIG_PROJECT_ID_PRESENT');
  const portOffset = 1000 + (process.pid % 1000);
  const isolatedConfig = configText
    .replace(/port = 54321/g, `port = ${54321 + portOffset}`)
    .replace(/port = 54322/g, `port = ${54322 + portOffset}`)
    .replace(/shadow_port = 54320/g, `shadow_port = ${54320 + portOffset}`)
    .replace(/port = 54323/g, `port = ${54323 + portOffset}`)
    .replace(/port = 54324/g, `port = ${54324 + portOffset}`)
    .replace(/port = 54327/g, `port = ${54327 + portOffset}`)
    .replace(/port = 54329/g, `port = ${54329 + portOffset}`);
  writeFileSync(
    disposable.configPath,
    isolatedConfig.replace(/^project_id\s*=\s*"[^"]+"/m, `project_id = "${projectId}"`),
    'utf8',
  );

  stackStartAttempted = true;
  cli(['start']);
  stackStarted = true;
  pass('DISPOSABLE_LOCAL_STACK_STARTED', `project=${projectId}`);
  cli(['db', 'reset', '--local', '--no-seed']);
  pass('DISPOSABLE_50_MIGRATION_REPLAY');

  local = parseStatus(cli(['status', '--output', 'env']));
  assert(/^http:\/\/(?:127\.0\.0\.1|localhost):\d+$/.test(local.API_URL ?? ''), 'LOOPBACK_API_GUARD', local.API_URL);
  assert(/^postgresql:\/\/postgres:[^@]+@(?:127\.0\.0\.1|localhost):\d+\/postgres$/.test(local.DB_URL ?? ''), 'LOOPBACK_DB_GUARD');
  assert(Boolean(local.ANON_KEY && local.SERVICE_ROLE_KEY), 'LOCAL_KEYS_PRESENT');
  admin = createClient(local.API_URL, local.SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  const approvedA = await createActor('approved-a', 'dietitian');
  const approvedB = await createActor('approved-b', 'dietitian');
  const pending = await createActor('pending', 'dietitian');
  const rejected = await createActor('rejected', 'dietitian');
  const missing = await createActor('missing-profile', 'dietitian');
  const clientA = await createActor('client-a', 'client');
  const clientB = await createActor('client-b', 'client');
  await verifyDietitian(approvedA, 'approved');
  await verifyDietitian(approvedB, 'approved');
  await bootstrapDisposableCore(approvedA);
  await bootstrapDisposableCore(approvedB);
  await verifyDietitian(rejected, 'rejected');
  const relationshipA = await activateRelationship(approvedA, clientA);
  await activateRelationship(approvedB, clientB);
  assertNoError(await admin.from('profiles').delete().eq('id', missing.id), 'missing profile fixture');
  const missingRows = assertNoError(
    await admin.from('profiles').select('id').eq('id', missing.id),
    'missing profile check',
  );
  assert(missingRows.length === 0, 'MISSING_PROFILE_FIXTURE');

  const api = {
    approvedA: await actorClient(approvedA),
    approvedB: await actorClient(approvedB),
    pending: await actorClient(pending),
    rejected: await actorClient(rejected),
    missing: await actorClient(missing),
    clientA: await actorClient(clientA),
    clientB: await actorClient(clientB),
    anonymous: anonymousClient(),
  };

  const { service, actorProxy } = compileNoteService();
  actorProxy.setSupabaseClient(api.approvedA);
  pass('REAL_NOTE_SERVICE_COMPILED');
  await waitForBrowserAcceptance(approvedA);

  const generalNote = await service.createNote(noteDraft());
  noteIds.push(generalNote.id);
  assert(
    generalNote.clientId === null && generalNote.content === 'Disposable runtime note content',
    'APPROVED_GENERAL_CREATE',
  );

  let linkedNote = await service.createNote(noteDraft({
    clientId: clientA.id,
    title: 'Disposable linked note',
    content: 'Private linked content',
  }));
  noteIds.push(linkedNote.id);
  assert(linkedNote.clientId === clientA.id, 'APPROVED_ACTIVE_CLIENT_CREATE');

  let fetched = await service.fetchNotes();
  assert(
    fetched.some(({ id }) => id === generalNote.id) && fetched.some(({ id }) => id === linkedNote.id),
    'APPROVED_SERVICE_READ',
  );

  const freshApprovedA = await actorClient(approvedA);
  actorProxy.setSupabaseClient(freshApprovedA);
  fetched = await service.fetchNotes();
  assert(fetched.some(({ id }) => id === linkedNote.id), 'FRESH_SESSION_CREATE_PERSISTED');
  actorProxy.setSupabaseClient(api.approvedA);

  linkedNote = await service.updateNote(linkedNote.id, noteDraft({
    clientId: clientA.id,
    title: 'Disposable linked note updated',
    content: 'Updated through the real service',
  }));
  assert(
    linkedNote.title === 'Disposable linked note updated'
      && linkedNote.content === 'Updated through the real service',
    'APPROVED_SERVICE_UPDATE',
  );

  let result = await api.approvedB.from('dietitian_notes').select('id').eq('id', linkedNote.id);
  assert(assertNoError(result, 'foreign approved read').length === 0, 'FOREIGN_DIETITIAN_READ_ZERO');
  assertNoRows(
    await api.approvedB.from('dietitian_notes').update({ title: 'foreign update' })
      .eq('id', linkedNote.id).select('id'),
    'FOREIGN_DIETITIAN_UPDATE_ZERO',
  );
  assertNoRows(
    await api.approvedB.from('dietitian_notes').delete().eq('id', linkedNote.id).select('id'),
    'FOREIGN_DIETITIAN_DELETE_ZERO',
  );

  await assertServiceError(
    () => service.createNote(noteDraft({ clientId: clientB.id, title: 'Foreign linked client' })),
    service.NoteServiceError,
    'UNRELATED_CLIENT_SERVICE_CREATE_DENY',
  );
  assertNoRows(
    await api.approvedA.from('dietitian_notes')
      .insert(directNotePayload(approvedA.id, clientB.id, 'Foreign linked direct'))
      .select('id'),
    'UNRELATED_CLIENT_DIRECT_CREATE_DENY',
  );

  for (const [label, actor, actorId] of [
    ['CLIENT_A', api.clientA, clientA.id],
    ['CLIENT_B', api.clientB, clientB.id],
    ['PENDING', api.pending, pending.id],
    ['REJECTED', api.rejected, rejected.id],
    ['MISSING_PROFILE', api.missing, missing.id],
    ['ANONYMOUS', api.anonymous, approvedA.id],
  ]) {
    const read = await actor.from('dietitian_notes').select('id').eq('id', linkedNote.id);
    if (read.error) pass(`${label}_READ_DENY`, `denied=${read.error.code ?? 'error'}`);
    else assert(read.data.length === 0, `${label}_READ_DENY`);
    assertNoRows(
      await actor.from('dietitian_notes')
        .insert(directNotePayload(actorId, null, `${label} denied`))
        .select('id'),
      `${label}_CREATE_DENY`,
    );
    assertNoRows(
      await actor.from('dietitian_notes').update({ title: `${label} denied` })
        .eq('id', linkedNote.id).select('id'),
      `${label}_UPDATE_DENY`,
    );
    assertNoRows(
      await actor.from('dietitian_notes').delete().eq('id', linkedNote.id).select('id'),
      `${label}_DELETE_DENY`,
    );
  }

  const immutableBefore = assertNoError(
    await admin.from('dietitian_notes').select('id,dietitian_id,created_at').eq('id', linkedNote.id).single(),
    'immutable baseline',
  );
  assertNoRows(
    await api.approvedA.from('dietitian_notes').update({ dietitian_id: approvedB.id })
      .eq('id', linkedNote.id).select('id'),
    'IMMUTABLE_OWNER_DENY',
  );
  assertNoRows(
    await api.approvedA.from('dietitian_notes').update({ id: randomUUID() })
      .eq('id', linkedNote.id).select('id'),
    'IMMUTABLE_ID_DENY',
  );
  assertNoRows(
    await api.approvedA.from('dietitian_notes').update({ created_at: '2000-01-01T00:00:00.000Z' })
      .eq('id', linkedNote.id).select('id'),
    'IMMUTABLE_CREATED_AT_DENY',
  );
  const immutableAfter = assertNoError(
    await admin.from('dietitian_notes').select('id,dietitian_id,created_at').eq('id', linkedNote.id).single(),
    'immutable postflight',
  );
  assert(
    JSON.stringify(immutableAfter) === JSON.stringify(immutableBefore),
    'IMMUTABLE_FIELDS_UNCHANGED',
  );

  assertNoError(
    await admin.from('dietitian_clients').update({ status: 'removed' }).eq('id', relationshipA),
    'inactive relationship fixture',
  );
  actorProxy.setSupabaseClient(api.approvedA);
  fetched = await service.fetchNotes();
  assert(fetched.some(({ id }) => id === linkedNote.id), 'REMOVED_RELATIONSHIP_NOTE_REMAINS_READABLE');
  assertNoRows(
    await api.approvedA.from('dietitian_notes').update({ content: 'Stale link mutation denied' })
      .eq('id', linkedNote.id).select('id'),
    'REMOVED_RELATIONSHIP_STALE_LINK_UPDATE_DENY',
  );

  linkedNote = await service.updateNote(linkedNote.id, noteDraft({
    clientId: null,
    title: 'Unlinked after relationship removal',
    content: 'Still private after unlink',
  }));
  assert(linkedNote.clientId === null, 'REMOVED_RELATIONSHIP_UNLINK_ALLOWED');
  await assertServiceError(
    () => service.updateNote(linkedNote.id, noteDraft({
      clientId: clientA.id,
      title: 'Relink denied',
    })),
    service.NoteServiceError,
    'REMOVED_RELATIONSHIP_RELINK_DENY',
  );
  await assertServiceError(
    () => service.createNote(noteDraft({
      clientId: clientA.id,
      title: 'Inactive create denied',
    })),
    service.NoteServiceError,
    'REMOVED_RELATIONSHIP_SERVICE_CREATE_DENY',
  );
  assertNoRows(
    await api.approvedA.from('dietitian_notes')
      .insert(directNotePayload(approvedA.id, clientA.id, 'Inactive direct create'))
      .select('id'),
    'REMOVED_RELATIONSHIP_DIRECT_CREATE_DENY',
  );

  await service.deleteNote(linkedNote.id);
  pass('APPROVED_LINKED_DELETE');
  const freshAfterDelete = await actorClient(approvedA);
  result = await freshAfterDelete.from('dietitian_notes').select('id').eq('id', linkedNote.id);
  assert(assertNoError(result, 'fresh linked delete read').length === 0, 'FRESH_SESSION_DELETE_PERSISTED');
  await service.deleteNote(generalNote.id);
  pass('APPROVED_GENERAL_DELETE');

  process.stdout.write('NOTE_RUNTIME_MATRIX_PASS\n');
} catch (error) {
  mainError = error;
} finally {
  if (admin) {
    try {
      if (actorIds.length) await admin.from('dietitian_notes').delete().in('dietitian_id', actorIds);
      if (relationshipIds.length) await admin.from('dietitian_clients').delete().in('id', relationshipIds);
      if (actorIds.length) await admin.from('dietitian_subscriptions').delete().in('dietitian_id', actorIds);
      const noteResidue = actorIds.length
        ? assertNoError(
            await admin.from('dietitian_notes').select('id').in('dietitian_id', actorIds),
            'note residue check',
          ).length
        : 0;
      const relationshipResidue = relationshipIds.length
        ? assertNoError(
            await admin.from('dietitian_clients').select('id').in('id', relationshipIds),
            'relationship residue check',
          ).length
        : 0;
      assert(noteResidue === 0, 'TEMPORARY_NOTES_ZERO');
      assert(relationshipResidue === 0, 'TEMPORARY_RELATIONSHIPS_ZERO');
      const subscriptionResidue = actorIds.length
        ? assertNoError(
            await admin.from('dietitian_subscriptions').select('dietitian_id').in('dietitian_id', actorIds),
            'subscription residue check',
          ).length
        : 0;
      assert(subscriptionResidue === 0, 'TEMPORARY_SUBSCRIPTIONS_ZERO');
      for (const id of [...actorIds].reverse()) await admin.auth.admin.deleteUser(id);
      const authResidue = [];
      let page = 1;
      while (true) {
        const listed = assertNoError(
          await admin.auth.admin.listUsers({ page, perPage: 100 }),
          'auth residue check',
        );
        authResidue.push(...listed.users.filter(({ id }) => actorIds.includes(id)));
        if (listed.users.length < 100) break;
        page += 1;
      }
      assert(authResidue.length === 0, 'TEMPORARY_AUTH_USERS_ZERO');
    } catch (cleanupError) {
      if (mainError) mainError.message += `; fixture cleanup failed: ${cleanupError.message}`;
      else mainError = cleanupError;
    }
  }
  if (disposable?.tempRoot && stackStartAttempted) {
    try {
      stopExactDisposableStack();
      pass('DISPOSABLE_LOCAL_STACK_STOPPED', `project=${projectId}`);
    } catch (stopError) {
      if (mainError) {
        if (stackStarted) mainError.message += `; local stack stop failed: ${stopError.message}`;
      } else {
        mainError = stopError;
      }
    }
  }
  if (disposable?.tempRoot) {
    const tempParent = dirname(disposable.tempRoot);
    rmSync(tempParent, { recursive: true, force: true });
    pass('DISPOSABLE_TEMP_RESIDUE_ZERO');
  }
  rmSync(browserManifestPath, { force: true });
  rmSync(browserDonePath, { force: true });
  try {
    const containerResidual = execFileSync('docker', [
      'ps', '-a', '--filter', `name=^supabase_.*_${projectId}$`, '--format', '{{.ID}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    const volumeResidual = execFileSync('docker', [
      'volume', 'ls', '--filter', `name=${projectId}`, '--format', '{{.Name}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    const networkResidual = execFileSync('docker', [
      'network', 'ls', '--filter', `name=${projectId}`, '--format', '{{.Name}}',
    ], { encoding: 'utf8', timeout: 30_000 }).trim();
    assert(
      containerResidual === '' && volumeResidual === '' && networkResidual === '',
      'DISPOSABLE_DOCKER_RESIDUE_ZERO',
    );
  } catch (dockerError) {
    if (mainError) mainError.message += `; Docker residue verification failed: ${dockerError.message}`;
    else mainError = dockerError;
  }
}

if (mainError) throw mainError;
