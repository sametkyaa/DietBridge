import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { materializeDisposableReplay } from './materializeDisposableSupabaseReplay.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const defaultRepoRoot = resolve(dirname(scriptPath), '..');
const SUPABASE_CLI_VERSION = '2.110.0';
const TEMP_PREFIX = 'dietbridge-supabase-replay-';
const ISOLATED_PHASE2_MIGRATIONS = new Set([
  '20260814214101_notification_core_backend.sql',
  '20260817084531_appointment_reminders_backend.sql',
  '20260817120000_push_registry_outbox_backend.sql',
  '20260901165402_client_account_deletion_backend.sql',
]);
export const LOCAL_PREREQUISITE_FILE = '20260728155959_disposable_avatar_bucket_prerequisite.sql';
export const LOCAL_PREREQUISITE_SQL = `-- Local-only disposable prerequisite. Never add this file to repository migrations.
begin;

do $$
declare
  v_name text;
  v_public boolean;
  v_file_size_limit bigint;
  v_allowed_mime_types text[];
  v_sorted_mime_types text[];
begin
  if to_regclass('storage.buckets') is null then
    raise exception 'Disposable Storage bucket prerequisite is missing.';
  end if;

  select b.name, b.public, b.file_size_limit, b.allowed_mime_types
    into v_name, v_public, v_file_size_limit, v_allowed_mime_types
    from storage.buckets as b
    where b.id = 'avatars'
    for update;

  if not found then
    if exists (select 1 from storage.buckets where name = 'avatars') then
      raise exception 'Disposable avatars bucket name is bound to a different id.';
    end if;

    insert into storage.buckets (
      id,
      name,
      public,
      file_size_limit,
      allowed_mime_types
    ) values (
      'avatars',
      'avatars',
      false,
      5242880,
      array['image/jpeg', 'image/png', 'image/webp']::text[]
    );
    return;
  end if;

  select array_agg(mime_type order by mime_type)
    into v_sorted_mime_types
    from unnest(v_allowed_mime_types) as mime_type;

  if v_name is distinct from 'avatars'
     or v_public is distinct from false
     or v_file_size_limit is distinct from 5242880
     or coalesce(cardinality(v_allowed_mime_types), 0) <> 3
     or v_sorted_mime_types is distinct from array['image/jpeg', 'image/png', 'image/webp']::text[] then
    raise exception 'Disposable avatars bucket does not match the exact prerequisite contract.';
  end if;
end
$$;

do $$
declare
  v_mime_types text[];
begin
  select array_agg(mime_type order by mime_type)
    into v_mime_types
    from storage.buckets as b,
         unnest(b.allowed_mime_types) as mime_type
   where b.id = 'meal-photos';

  if not exists (select 1 from storage.buckets where id = 'meal-photos') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'meal-photos', 'meal-photos', false, 5242880,
      array['image/jpeg', 'image/png', 'image/webp']::text[]
    );
  elsif not exists (
    select 1 from storage.buckets
     where id = 'meal-photos' and name = 'meal-photos' and public is false
       and file_size_limit = 5242880 and cardinality(allowed_mime_types) = 3
  ) or v_mime_types is distinct from array['image/jpeg', 'image/png', 'image/webp']::text[] then
    raise exception 'Disposable meal-photos bucket does not match the exact prerequisite contract.';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Give users access to own folder 1o5iea3_0'
  ) then
    create policy "Give users access to own folder 1o5iea3_0"
      on storage.objects for select to public
      using (bucket_id = 'meal-photos' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Give users access to own folder 1o5iea3_1'
  ) then
    create policy "Give users access to own folder 1o5iea3_1"
      on storage.objects for insert to public
      with check (bucket_id = 'meal-photos' and auth.uid()::text = (storage.foldername(name))[1]);
  end if;
end
$$;

do $$
declare
  v_name text;
  v_public boolean;
  v_file_size_limit bigint;
  v_allowed_mime_types text[];
  v_sorted_mime_types text[];
begin
  select b.name, b.public, b.file_size_limit, b.allowed_mime_types
    into v_name, v_public, v_file_size_limit, v_allowed_mime_types
    from storage.buckets as b
   where b.id = 'dietitian-diplomas'
   for update;

  if not found then
    if exists (select 1 from storage.buckets where name = 'dietitian-diplomas') then
      raise exception 'Disposable dietitian-diplomas bucket name is bound to a different id.';
    end if;

    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values (
      'dietitian-diplomas', 'dietitian-diplomas', false, 10485760,
      array['application/pdf']::text[]
    );
  else
    select array_agg(mime_type order by mime_type)
      into v_sorted_mime_types
      from unnest(v_allowed_mime_types) as mime_type;

    if v_name is distinct from 'dietitian-diplomas'
       or v_public is distinct from false
       or v_file_size_limit is distinct from 10485760
       or v_sorted_mime_types is distinct from array['application/pdf']::text[] then
      raise exception 'Disposable dietitian-diplomas bucket does not match the exact prerequisite contract.';
    end if;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Dietitians can view own diplomas'
  ) then
    create policy "Dietitians can view own diplomas"
      on storage.objects for select to authenticated
      using (bucket_id = 'dietitian-diplomas' and owner = auth.uid());
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Dietitians can upload own diplomas'
  ) then
    create policy "Dietitians can upload own diplomas"
      on storage.objects for insert to authenticated
      with check (
        bucket_id = 'dietitian-diplomas'
        and owner = auth.uid()
        and (storage.foldername(name))[1] = 'diplomas'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Dietitians can update own diplomas'
  ) then
    create policy "Dietitians can update own diplomas"
      on storage.objects for update to authenticated
      using (bucket_id = 'dietitian-diplomas' and owner = auth.uid())
      with check (
        bucket_id = 'dietitian-diplomas'
        and owner = auth.uid()
        and (storage.foldername(name))[1] = 'diplomas'
        and (storage.foldername(name))[2] = auth.uid()::text
      );
  end if;

  if not exists (
    select 1 from pg_catalog.pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'Dietitians can delete own diplomas'
  ) then
    create policy "Dietitians can delete own diplomas"
      on storage.objects for delete to authenticated
      using (bucket_id = 'dietitian-diplomas' and owner = auth.uid());
  end if;
end
$$;

commit;
`;
export const LOCAL_PREREQUISITE_SHA256 = '3cc06c6b520d585617918ef85c84a860ca96462febf09b643306283a824667fa';

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

const normalizePath = (value) => resolve(value).replaceAll('/', sep).toLowerCase();

const isChildPath = (parent, candidate) => {
  const normalizedParent = normalizePath(parent);
  const normalizedCandidate = normalizePath(candidate);
  return normalizedCandidate.startsWith(`${normalizedParent}${sep}`);
};

const assertExternalTempPath = ({ repoRoot, tempRoot }) => {
  const tempBase = resolve(tmpdir());
  if (!isChildPath(tempBase, tempRoot)) {
    throw new Error(`Disposable output must be a child of the system temp directory: ${tempRoot}`);
  }
  if (normalizePath(tempRoot) === normalizePath(repoRoot) || isChildPath(repoRoot, tempRoot)) {
    throw new Error(`Disposable output must remain outside the repository: ${tempRoot}`);
  }
};

const assertManifestMatchesSourceInventory = ({ repoRoot, runtimeManifest }) => {
  if (runtimeManifest.expectedHistory?.canonical !== 46
      || runtimeManifest.expectedHistory?.image !== 7
      || runtimeManifest.expectedHistory?.total !== 53
      || runtimeManifest.files?.length !== 53) {
    throw new Error('Unexpected disposable migration inventory; expected 46 canonical and 7 image migrations.');
  }

  const sourcePaths = readdirSync(join(repoRoot, 'supabase', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isFile()
      && /^\d+_.+\.sql$/.test(entry.name)
      && !ISOLATED_PHASE2_MIGRATIONS.has(entry.name))
    .map((entry) => `supabase/migrations/${entry.name}`)
    .sort();
  const materializedPaths = runtimeManifest.files.map(({ path }) => path);
  if (JSON.stringify(sourcePaths) !== JSON.stringify(materializedPaths)) {
    throw new Error('Materialized migration inventory or order does not match the source migration chain.');
  }
  if (!runtimeManifest.files.every((file) => file.syntaxOnly && /^[a-f0-9]{64}$/.test(file.sourceSha256)
      && /^[a-f0-9]{64}$/.test(file.materializedSha256))) {
    throw new Error('Disposable materialization manifest contains an invalid syntax-only or hash result.');
  }
  return materializedPaths;
};

export const writeLocalPrerequisite = ({ tempRoot }) => {
  const migrationDirectory = join(tempRoot, 'supabase', 'migrations');
  const destination = join(migrationDirectory, LOCAL_PREREQUISITE_FILE);
  if (resolve(destination) !== resolve(migrationDirectory, LOCAL_PREREQUISITE_FILE)
      || !isChildPath(migrationDirectory, destination)
      || existsSync(destination)) {
    throw new Error(`Invalid local-only prerequisite destination: ${destination}`);
  }
  const bytes = Buffer.from(LOCAL_PREREQUISITE_SQL, 'utf8');
  const actualHash = sha256(bytes);
  if (actualHash !== LOCAL_PREREQUISITE_SHA256) {
    throw new Error(`Local prerequisite hash mismatch: expected ${LOCAL_PREREQUISITE_SHA256}, got ${actualHash}`);
  }
  writeFileSync(destination, bytes, { flag: 'wx' });
  return {
    label: 'local-only disposable prerequisite',
    file: LOCAL_PREREQUISITE_FILE,
    path: `supabase/migrations/${LOCAL_PREREQUISITE_FILE}`,
    sha256: actualHash,
  };
};

const assertDisposableMigrationInventory = ({ repositoryPaths, tempRoot, localPrerequisite }) => {
  const disposablePaths = readdirSync(join(tempRoot, 'supabase', 'migrations'), { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d+_.+\.sql$/.test(entry.name))
    .map((entry) => `supabase/migrations/${entry.name}`)
    .sort();
  const expectedPaths = [...repositoryPaths, localPrerequisite.path].sort();
  if (JSON.stringify(disposablePaths) !== JSON.stringify(expectedPaths)) {
    throw new Error('Disposable migration inventory or order is unexpected.');
  }
  const localIndex = disposablePaths.indexOf(localPrerequisite.path);
  const avatarPolicyIndex = disposablePaths.indexOf(
    'supabase/migrations/20260728160000_allow_active_clients_read_linked_dietitian_avatar.sql',
  );
  if (localIndex === -1 || avatarPolicyIndex !== localIndex + 1) {
    throw new Error('Local prerequisite must appear immediately before the avatar policy migration.');
  }
  if (repositoryPaths.length !== 53 || disposablePaths.length !== 54) {
    throw new Error(`Unexpected repository/disposable counts: ${repositoryPaths.length}/${disposablePaths.length}`);
  }
  return {
    repositoryMigrationCount: repositoryPaths.length,
    localPrerequisiteCount: 1,
    disposableMigrationCount: disposablePaths.length,
    paths: disposablePaths,
  };
};

const copyRequiredProjectFiles = ({ repoRoot, tempRoot }) => {
  const sourceConfig = join(repoRoot, 'supabase', 'config.toml');
  const destinationConfig = join(tempRoot, 'supabase', 'config.toml');
  if (!existsSync(sourceConfig)) {
    throw new Error(`Required local Supabase config is missing: ${sourceConfig}`);
  }
  copyFileSync(sourceConfig, destinationConfig, 1);
  return destinationConfig;
};

const localOnlyEnvironment = (environment) => {
  const {
    SUPABASE_ACCESS_TOKEN: _accessToken,
    SUPABASE_TOKEN: _token,
    SUPABASE_DB_PASSWORD: _dbPassword,
    SUPABASE_SERVICE_ROLE_KEY: _serviceRole,
    ...safeEnvironment
  } = environment;
  return safeEnvironment;
};

const npxInvocation = (supabaseArgs) => {
  if (process.platform !== 'win32') return { command: 'npx', args: supabaseArgs };
  const npxCli = process.env.npm_execpath
    ? join(dirname(process.env.npm_execpath), 'npx-cli.js')
    : join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npx-cli.js');
  if (!existsSync(npxCli)) {
    throw new Error(`Pinned local npx CLI entry point is unavailable: ${npxCli}`);
  }
  return { command: process.execPath, args: [npxCli, ...supabaseArgs] };
};

const runChild = ({ command, args, cwd, environment, onChild }) => new Promise((resolveRun, rejectRun) => {
  const child = spawn(command, args, {
    cwd,
    env: localOnlyEnvironment(environment),
    shell: false,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  onChild?.(child);
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.once('error', rejectRun);
  child.once('close', (code, signal) => resolveRun({ code: code ?? 1, signal, stdout, stderr, child }));
});

const redactOutput = (value) => value
  .replace(/\b(sb_(?:secret|publishable)_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9._-]+)\b/g, '[redacted]')
  .replace(/\b([A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD))\s*[=:]\s*\S+/g, '$1=[redacted]');

const summarizeChildFailure = ({ code, signal, stdout = '', stderr = '' }) => {
  const combined = redactOutput(`${stderr}\n${stdout}`);
  const sqlState = combined.match(/SQLSTATE\s*[:=]\s*([A-Z0-9]+)/i)?.[1];
  const migration = combined.match(/\b(\d{14}_[^\s:]+\.sql)\b/)?.[1];
  const context = combined.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\b(ERROR|FATAL|STATEMENT|failed to apply|failed to execute|syntax error)\b/i.test(line))
    .slice(0, 3);
  const details = [
    `local db reset failed (exit ${code}${signal ? `, signal ${signal}` : ''})`,
    migration ? `migration ${migration}` : null,
    sqlState ? `SQLSTATE ${sqlState}` : null,
    ...context,
  ].filter(Boolean);
  return details.join('; ');
};

export const parseCliArguments = (argv) => {
  const options = { materializeOnly: false, keepTemp: false, help: false };
  for (const argument of argv) {
    if (argument === '--materialize-only') options.materializeOnly = true;
    else if (argument === '--keep-temp') options.keepTemp = true;
    else if (argument === '--help' || argument === '-h') options.help = true;
    else throw new Error(`Unsupported argument: ${argument}`);
  }
  return options;
};

export const usage = () => [
  'Usage: node scripts/runDisposableSupabaseLocalReplay.mjs [--materialize-only] [--keep-temp]',
  '',
  'Creates a hash-verified disposable Supabase project under the system temp directory.',
  'Without --materialize-only, runs only: supabase db reset --local --no-seed.',
].join('\n');

export const runDisposableSupabaseLocalReplay = async ({
  repoRoot = defaultRepoRoot,
  materializeOnly = false,
  keepTemp = false,
  createTemp = () => mkdtempSync(join(tmpdir(), TEMP_PREFIX)),
  executeCommand = runChild,
  environment = process.env,
} = {}) => {
  const resolvedRepoRoot = resolve(repoRoot);
  let tempParent;
  let tempRoot;
  let runtimeManifest;
  let localPrerequisite;
  let disposableHistory;
  let replay;
  let result;
  let mainError;
  let cleanupError;
  let activeChild;
  let receivedSignal;
  const onSignal = (signal) => {
    receivedSignal = signal;
    if (activeChild && !activeChild.killed) activeChild.kill(signal);
  };

  try {
    tempParent = createTemp();
    tempRoot = join(tempParent, 'project');
    assertExternalTempPath({ repoRoot: resolvedRepoRoot, tempRoot: tempParent });
    assertExternalTempPath({ repoRoot: resolvedRepoRoot, tempRoot });
    runtimeManifest = materializeDisposableReplay({ repoRoot: resolvedRepoRoot, outputRoot: tempRoot });
    const configPath = copyRequiredProjectFiles({ repoRoot: resolvedRepoRoot, tempRoot });
    const repositoryPaths = assertManifestMatchesSourceInventory({ repoRoot: resolvedRepoRoot, runtimeManifest });
    localPrerequisite = writeLocalPrerequisite({ tempRoot });
    disposableHistory = assertDisposableMigrationInventory({ repositoryPaths, tempRoot, localPrerequisite });

    if (!materializeOnly) {
      const invocation = npxInvocation([
        '--yes',
        `supabase@${SUPABASE_CLI_VERSION}`,
        '--workdir',
        tempRoot,
        'db',
        'reset',
        '--local',
        '--no-seed',
      ]);
      process.once('SIGINT', onSignal);
      process.once('SIGTERM', onSignal);
      replay = await executeCommand({
        ...invocation,
        cwd: resolvedRepoRoot,
        environment,
        onChild: (child) => { activeChild = child; },
      });
      process.removeListener('SIGINT', onSignal);
      process.removeListener('SIGTERM', onSignal);
      if (receivedSignal) {
        const error = new Error(`local db reset interrupted by ${receivedSignal}`);
        error.exitCode = 130;
        throw error;
      }
      if (replay.code !== 0) throw new Error(summarizeChildFailure(replay));
    }

    result = {
      status: materializeOnly ? 'materialized' : 'replayed',
      tempRoot: keepTemp ? tempRoot : null,
      configPath: keepTemp ? configPath : null,
      manifest: runtimeManifest,
      localPrerequisite,
      disposableHistory,
      replay: replay ? { code: replay.code, signal: replay.signal } : null,
      cleanup: { attempted: !keepTemp, succeeded: false, residualPath: null },
    };
  } catch (error) {
    mainError = error;
  } finally {
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    if (tempParent && !keepTemp) {
      try {
        rmSync(tempParent, { recursive: true, force: true });
        if (result) result.cleanup.succeeded = true;
      } catch (error) {
        cleanupError = error;
        if (result) result.cleanup.residualPath = tempParent;
      }
    }
  }
  if (mainError) {
    if (keepTemp && tempRoot) {
      mainError.message = `${mainError.message}; disposable workdir retained at ${tempRoot}`;
    }
    if (cleanupError) {
      mainError.message = `${mainError.message}; cleanup also failed and left ${tempParent}: ${cleanupError.message}`;
    }
    throw mainError;
  }
  return result;
};

const runCli = async () => {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  const result = await runDisposableSupabaseLocalReplay(options);
  process.stdout.write(`${JSON.stringify({
    status: result.status,
    repositoryHistory: result.manifest.expectedHistory,
    localPrerequisite: result.localPrerequisite,
    disposableHistory: result.disposableHistory,
    tempRoot: result.tempRoot,
    replay: result.replay,
  })}\n`);
};

if (resolve(process.argv[1] ?? '') === resolve(scriptPath)) {
  runCli().catch((error) => {
    process.stderr.write(`[disposable-local-replay] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = error?.exitCode ?? 1;
  });
}
