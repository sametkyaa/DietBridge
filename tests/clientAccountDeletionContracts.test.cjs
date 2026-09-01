'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migrationName = '20260901165402_client_account_deletion_backend.sql';
const hardeningMigrationName = '20260901193000_client_account_deletion_hardening.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const hardeningMigrationPath = path.join(root, 'supabase', 'migrations', hardeningMigrationName);
const functionPath = path.join(root, 'supabase', 'functions', 'delete-client-account', 'handler.ts');
const configPath = path.join(root, 'supabase', 'config.toml');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = () => fs.readFileSync(hardeningMigrationPath, 'utf8');
const handler = () => fs.readFileSync(functionPath, 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();

const functionBody = () => {
    const source = migration();
    const start = source.indexOf('create or replace function public.delete_client_account_data');
    const end = source.indexOf('\n$function$;', start);
    assert.ok(start >= 0 && end > start, 'cleanup function body is present');
    return source.slice(start, end);
};

const preparationBody = () => {
    const source = migration();
    const start = source.indexOf('create function public.prepare_client_account_deletion');
    const end = source.indexOf('\n$function$;', start);
    assert.ok(start >= 0 && end > start, 'preparation function body is present');
    return source.slice(start, end);
};

const assertInOrder = (source, fragments, label) => {
    let previous = -1;
    for (const fragment of fragments) {
        const current = source.indexOf(fragment);
        assert.ok(current > previous, `${label}: ${fragment}`);
        previous = current;
    }
};

test('account deletion migration is a forward-only isolated canonical tail', () => {
    const source = migration();
    const files = fs.readdirSync(path.join(root, 'supabase/migrations'))
        .filter((name) => /^\d+_.+\.sql$/.test(name))
        .sort();
    assert.equal(files.at(-1), hardeningMigrationName);
    assert.match(source, /^begin;\s*$/m);
    assert.match(source, /commit;\s*$/m);
    assert.match(read('scripts/runDisposableSupabaseLocalReplay.mjs'), new RegExp(`'${hardeningMigrationName}'`));
    assert.match(read('scripts/addCurrentIsolatedMigrations.mjs'), new RegExp(`'${hardeningMigrationName}'`));
    assert.doesNotMatch(read('scripts/runDisposableClientAccountDeletionRuntimeHarness.mjs'), /addCurrentIsolatedMigrations/);
    assert.doesNotMatch(source, /supabase_migrations|db\s+push|storage\.objects|net\.http|vault\./i);
});

test('the service-only RPC validates service role, client role, and admin entitlement', () => {
    const source = migration();
    const body = functionBody();
    const preparation = preparationBody();
    assert.match(body, /auth\.jwt\(\)\s*->>\s*'role'[\s\S]*is distinct from 'service_role'/i);
    assert.match(body, /p_client_id is null/i);
    assert.match(preparation, /v_role is distinct from 'client'::public\.user_role/i);
    assert.match(preparation, /from public\.platform_admins as pa/i);
    assert.match(preparation, /pa\.revoked_at is null/i);
    assert.match(preparation, /v_is_retry/);
    assert.match(preparation, /p_storage_objects <> '\[\]'::jsonb/i);
    assert.match(preparation, /on conflict \(user_id\) do nothing/i);
    assert.match(source, /security definer/i);
    assert.match(source, /set search_path = ''/i);
    assert.match(source, /alter function public\.delete_client_account_data\(uuid\) owner to postgres/i);
    for (const functionName of [
        'delete_client_account_data(uuid)',
        'prepare_client_account_deletion(uuid, jsonb)',
        'get_client_account_deletion_state(uuid)',
        'mark_client_account_storage_cleaned(uuid)',
    ]) {
        const escaped = functionName.replace(/[() ,]/g, '\\$&');
        assert.match(source, new RegExp(`revoke all on function public\\.${escaped}[\\s\\S]*from public, anon, authenticated, service_role`, 'i'));
        assert.match(source, new RegExp(`grant execute on function public\\.${escaped} to service_role`, 'i'));
    }
    assert.match(source, /has_function_privilege\('anon', v_function, 'EXECUTE'\)/i);
    assert.match(source, /has_function_privilege\('authenticated', v_function, 'EXECUTE'\)/i);
    assert.match(source, /has_function_privilege\('service_role', v_function, 'EXECUTE'\)/i);
});

test('the relational cleanup order covers every discovered client-linked table', () => {
    const body = functionBody();
    assertInOrder(body, [
        'delete from public.notifications',
        'delete from public.chat_image_cleanup_queue',
        'delete from public.chat_read_states',
        'update public.chat_conversations',
        'delete from public.chat_attachments',
        'delete from public.chat_upload_intents',
        'delete from public.chat_messages',
        'delete from public.chat_conversations',
        'delete from public.dietitian_clients',
        'delete from public.appointments',
        'delete from public.meal_change_requests',
        'delete from public.daily_tasks',
        'delete from public.dietitian_notes',
        'delete from public.meal_completion_photo_cleanup_queue',
        'delete from public.meals',
        'delete from public.meal_plans',
        'delete from public.grocery_items',
        'delete from public.daily_logs',
        'delete from public.measurements',
        'delete from public.body_measurements',
        'delete from public.client_medical_conditions',
        'delete from public.client_medications',
        'delete from public.client_profiles',
        'delete from public.profiles',
    ], 'dependency order');
    for (const protectedTable of [
        'public.recipes',
        'public.dietitian_profiles',
        'public.medical_conditions',
        'public.medications_catalog',
        'public.activity_levels',
        'public.alcohol_statuses',
        'public.blood_types',
        'public.client_goals',
        'public.nutrition_types',
    ]) {
        assert.doesNotMatch(body, new RegExp(`delete\\s+from\\s+${protectedTable.replace('.', '\\.')}`, 'i'), protectedTable);
    }
});

test('the schema coverage regression assertion names every current profiles dependency', () => {
    const body = functionBody();
    const expectedCleanupTables = [
        'appointments',
        'body_measurements',
        'chat_messages',
        'chat_conversations',
        'chat_read_states',
        'chat_upload_intents',
        'client_medical_conditions',
        'client_medications',
        'client_profiles',
        'daily_logs',
        'daily_tasks',
        'dietitian_clients',
        'dietitian_notes',
        'meal_change_requests',
        'meal_plans',
        'meals',
        'measurements',
        'notifications',
        'grocery_items',
    ];
    for (const table of expectedCleanupTables) assert.match(body, new RegExp(`public\\.${table}\\b`), table);
    const harness = read('supabase/tests/client_account_deletion_harness.sql');
    assert.match(harness, /client_account_deletion_profile_fk_allowlist/);
    for (const table of [
        'public.appointments',
        'public.chat_conversations',
        'public.chat_messages',
        'public.chat_read_states',
        'public.chat_upload_intents',
        'public.client_profiles',
        'public.daily_logs',
        'public.daily_tasks',
        'public.dietitian_clients',
        'public.dietitian_notes',
        'public.dietitian_profiles',
        'public.dietitian_subscriptions',
        'public.grocery_items',
        'public.meal_change_requests',
        'public.meal_plans',
        'public.measurements',
        'public.notifications',
        'public.recipes',
    ]) assert.match(harness, new RegExp(`'${table.replace('.', '\\.')}'`), table);
    assert.match(harness, /UNREVIEWED_PROFILES_FK_DEPENDENCY/);
    assert.match(harness, /EXPECTED_PROFILES_FK_DEPENDENCY_MISSING/);
    assert.match(migration(), /profiles to Auth cascade is missing/i);
});

test('owned Storage cleanup is exact and excludes dietitian/global buckets', () => {
    const source = handler();
    for (const bucket of ['avatars', 'chat-images', 'meal-completion-photos']) {
        assert.match(source, new RegExp(`"${bucket}"`));
    }
    for (const forbiddenBucket of ['meal-photos', 'recipe-images', 'dietitian-diplomas']) {
        assert.doesNotMatch(source, new RegExp(forbiddenBucket));
    }
    assert.match(source, /storage\/v1\/object\/list\//);
    assert.match(source, /storage\/v1\/object\/\$\{\s*encodeURIComponent\(bucket\)\s*\}/);
    assert.match(source, /body: JSON\.stringify\(\{ prefixes: batch \}\)/);
    assert.match(source, /chat_conversations/);
    assert.match(source, /conversation_id: `eq\.\$\{conversationId\}`/);
    assert.match(source, /created_by: `eq\.\$\{userId\}`/);
    assert.match(source, /CHAT_IMAGE_PATH_PATTERN/);
    assert.match(source, /COMPLETION_FILE_PATTERN/);
    assert.match(source, /AVATAR_FILE_PATTERN/);
    assert.doesNotMatch(source, /listStorageObjects\([\s\S]*,[\s\S]*['"]['"]\s*[,)]/i);
});

test('Edge Function uses validated JWT identity, rejects target bodies, and gates client role', () => {
    const source = handler();
    const config = read('supabase/config.toml');
    assert.match(config, /\[functions\.delete-client-account\][\s\S]*verify_jwt = true/i);
    assert.match(source, /authorization/);
    assert.match(source, /Bearer \(\[\^\\s\]\+\)/);
    assert.match(source, /auth\/v1\/user/);
    assert.match(source, /parseUserId\(await parseJson\(response\)\)/);
    assert.match(source, /requestBodyIsEmptyObject/);
    assert.match(source, /Object\.keys\(value\)\.length === 0/);
    assert.match(source, /profile\.role !== "client"/);
    assert.match(source, /hasActivePlatformAdminEntitlement/);
    assert.doesNotMatch(source, /request\.json\(\)/);
    assert.doesNotMatch(source, /user_id.*request|request.*user_id/i);
});

test('service cleanup, relational cleanup, and Auth deletion have fail-closed ordering', () => {
    const source = handler();
    const requestBody = source.slice(source.indexOf('async function handleRequest'));
    assert.match(source, /SUPABASE_SERVICE_ROLE_KEY/);
    assert.match(source, /createClient\(baseUrl, serviceRoleKey/);
    assert.match(source, /admin\.auth\.admin\.deleteUser\(userId, false\)/);
    assertInOrder(requestBody, [
        'collectOwnedStoragePaths',
        'invokeTransactionalDeletion',
        'removeExactStoragePaths',
        'markStorageCleanupComplete',
        'dependencies.deleteAuthUser',
    ], 'side-effect ordering');
    assert.match(source, /if \(!response\.ok\) throw new Error\("storage_delete_failed"\)/);
    assert.match(source, /if \(!response\.ok\) throw new Error\("transactional_deletion_failed"\)/);
    assert.match(source, /if \(!response\.ok\) throw new Error\("storage_cleanup_marker_failed"\)/);
    assert.match(source, /client_account_deletion_failed/);
    assert.doesNotMatch(source, /console\.log/);
    assert.doesNotMatch(source, /log\([^)]*(?:email|health|token|object_path|userId)/i);
});

test('tombstone and exact manifest are Auth-cascaded, browser-inaccessible, and profile-independent', () => {
    const source = migration();
    assert.match(source, /create table public\.client_account_deletion_tombstones/);
    assert.match(source, /create table public\.client_account_deletion_storage_manifest/);
    assert.match(source, /references auth\.users\(id\) on delete cascade/gi);
    assert.doesNotMatch(source, /client_account_deletion_(?:tombstones|storage_manifest)[\s\S]*references public\.profiles/i);
    assert.match(source, /alter table public\.client_account_deletion_tombstones enable row level security/i);
    assert.match(source, /alter table public\.client_account_deletion_storage_manifest enable row level security/i);
    assert.match(source, /storage_objects jsonb/i);
    assert.match(source, /delete from public\.profiles as p/i);
    assert.match(source, /relational_cleanup_at is not null/i);
    assert.match(source, /storage_cleanup_at = coalesce\(storage_cleanup_at, now\(\)\)/i);
});

test('deferred Push migration remains byte-for-byte unchanged', () => {
    const relativePath = 'supabase/migrations/20260817120000_push_registry_outbox_backend.sql';
    const bytes = fs.readFileSync(path.join(root, relativePath));
    const blob = execFileSync('git', ['hash-object', '--', relativePath], { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(bytes.length, 23771);
    assert.equal(blob, '810f5cad1ef0e991aa3fcf97798706ce535c6156');
    assert.equal(sha256(bytes), '83CF92EDB8ECC7EAC6581AC839694F9192303ADD7E522416FC1CB9AF6583A97B');
});
