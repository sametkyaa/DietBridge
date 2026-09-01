'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migrationName = '20260901083212_client_grocery_list.sql';
const migrationPath = path.join(root, 'supabase', 'migrations', migrationName);
const deferredPushPath = path.join(root, 'supabase', 'migrations', '20260817120000_push_registry_outbox_backend.sql');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = () => fs.readFileSync(migrationPath, 'utf8');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex').toUpperCase();

test('grocery migration is the forward-only current tail and has no fixture writes', () => {
    const files = fs.readdirSync(path.join(root, 'supabase/migrations'))
        .filter((name) => /^\d+_.+\.sql$/.test(name))
        .sort();
    assert.equal(files.at(-1), migrationName);
    assert.match(migration(), /^begin;\s*$/m);
    assert.match(migration(), /commit;\s*$/m);
    assert.doesNotMatch(migration(), /insert\s+into\s+public\.|update\s+public\.|delete\s+from\s+public\./i);
});

test('grocery_items has the minimal typed schema and required defaults', () => {
    const source = migration();
    assert.match(source, /create table public\.grocery_items\s*\(/i);
    assert.match(source, /id uuid primary key default gen_random_uuid\(\)/i);
    assert.match(source, /client_id uuid not null/i);
    assert.match(source, /name text not null/i);
    assert.match(source, /is_completed boolean not null default false/i);
    assert.match(source, /created_at timestamptz not null default now\(\)/i);
    assert.match(source, /references public\.profiles\(id\) on delete cascade/i);
});

test('grocery name contract is a database check after trim', () => {
    assert.match(migration(), /constraint grocery_items_name_length_check[\s\S]*check \(char_length\(btrim\(name\)\) between 1 and 120\)/i);
});

test('duplicate grocery names are intentionally allowed', () => {
    const tableBlock = migration().slice(
        migration().indexOf('create table public.grocery_items'),
        migration().indexOf('\n);', migration().indexOf('create table public.grocery_items')) + 3,
    );
    assert.doesNotMatch(tableBlock, /unique[\s\S]*name/i);
    assert.doesNotMatch(tableBlock, /grocery_items_name_unique/i);
});

test('grocery list has one deterministic client completion index', () => {
    const source = migration();
    assert.match(source, /create index grocery_items_client_completion_created_idx[\s\S]*on public\.grocery_items \(client_id, is_completed, created_at, id\)/i);
    assert.equal((source.match(/create index /gi) || []).length, 1);
});

test('grocery_items enables RLS and creates exactly four policies', () => {
    const source = migration();
    assert.match(source, /alter table public\.grocery_items enable row level security/i);
    assert.equal((source.match(/create policy /gi) || []).length, 4);
});

test('all grocery policies are authenticated client policies bound to auth.uid', () => {
    const source = migration();
    const policies = source.split(/create policy /i).slice(1);
    assert.equal(policies.length, 4);
    for (const policy of policies) {
        assert.match(policy, /to authenticated/i);
        assert.match(policy, /client_id = \(select auth\.uid\(\)\)/i);
        assert.match(policy, /current_user_role\(\)\) = 'client'::public\.user_role/i);
    }
});

test('select and insert only expose or create the current client rows', () => {
    const source = migration();
    assert.match(source, /create policy grocery_items_select_own_client[\s\S]*for select[\s\S]*using \([\s\S]*client_id = \(select auth\.uid\(\)\)[\s\S]*current_user_role\(\)\) = 'client'/i);
    assert.match(source, /create policy grocery_items_insert_own_client[\s\S]*for insert[\s\S]*with check \([\s\S]*client_id = \(select auth\.uid\(\)\)[\s\S]*current_user_role\(\)\) = 'client'/i);
});

test('update uses both USING and WITH CHECK to prevent ownership transfer', () => {
    const source = migration();
    const start = source.indexOf('create policy grocery_items_update_own_client');
    const end = source.indexOf('\ncreate policy ', start + 1);
    const block = source.slice(start, end);
    assert.match(block, /for update/i);
    assert.match(block, /using \([\s\S]*client_id = \(select auth\.uid\(\)\)/i);
    assert.match(block, /with check \([\s\S]*client_id = \(select auth\.uid\(\)\)/i);
});

test('delete is current-client-only', () => {
    const source = migration();
    assert.match(source, /create policy grocery_items_delete_own_client[\s\S]*for delete[\s\S]*using \([\s\S]*client_id = \(select auth\.uid\(\)\)[\s\S]*current_user_role\(\)\) = 'client'/i);
});

test('grants follow least-privilege browser access', () => {
    const source = migration();
    assert.match(source, /revoke all privileges on table public\.grocery_items from public, anon, authenticated/i);
    assert.match(source, /grant select, insert, update, delete on table public\.grocery_items to authenticated/i);
    assert.doesNotMatch(source, /grant .* on table public\.grocery_items to anon/i);
    assert.doesNotMatch(source, /grant .* on table public\.grocery_items to public/i);
});

test('migration reuses canonical authorization and adds no helper or RPC', () => {
    const source = migration();
    assert.match(source, /public\.current_user_role\(\)/i);
    assert.doesNotMatch(source, /create(?:\s+or\s+replace)?\s+function/i);
    assert.doesNotMatch(source, /create\s+(?:or\s+replace\s+)?function\s+public\./i);
});

test('migration preflight and postflight fail closed around the new object', () => {
    const source = migration();
    assert.match(source, /to_regclass\('public\.profiles'\)/i);
    assert.match(source, /to_regprocedure\('public\.current_user_role\(\)'\)/i);
    assert.match(source, /to_regclass\('public\.grocery_items'\) is not null/i);
    assert.match(source, /grocery_items_name_length_check/i);
    assert.match(source, /grocery_items_client_completion_created_idx/i);
    assert.match(source, /has_table_privilege\('anon', 'public\.grocery_items', 'select'\)/i);
});

test('migration changes no unrelated public object', () => {
    const source = migration();
    const publicObjects = [...source.matchAll(/(?:create table|create index|alter table|create policy|comment on table) public\.([a-z_]+)/gi)]
        .map((match) => match[1]);
    assert.deepEqual([...new Set(publicObjects)], ['grocery_items']);
});

test('deferred Push migration remains byte-for-byte canonical', () => {
    const bytes = fs.readFileSync(deferredPushPath);
    const blob = execFileSync('git', ['hash-object', '--', 'supabase/migrations/20260817120000_push_registry_outbox_backend.sql'], { cwd: root, encoding: 'utf8' }).trim();
    assert.equal(bytes.length, 23771);
    assert.equal(blob, '810f5cad1ef0e991aa3fcf97798706ce535c6156');
    assert.equal(sha256(bytes), '83CF92EDB8ECC7EAC6581AC839694F9192303ADD7E522416FC1CB9AF6583A97B');
});

test('replay fixture includes the new migration without changing historical hashes', () => {
    const fixture = JSON.parse(read('tests/fixtures/canonicalReplaySyntaxEdits.json'));
    const entry = fixture.files.find(({ path: filePath }) => filePath.endsWith(migrationName));
    assert.equal(fixture.expectedCanonicalCount, 46);
    assert.equal(fixture.expectedImageCount, 7);
    assert.deepEqual(entry.edits, []);
    assert.equal(entry.sourceSha256.toUpperCase(), sha256(fs.readFileSync(migrationPath)));
    assert.equal(entry.materializedSha256, entry.sourceSha256);
});

test('no production-facing deployment or data mutation is encoded for this feature', () => {
    const source = migration();
    assert.doesNotMatch(source, /supabase_migrations|db\s+push|storage\.|net\.http|vault\./i);
    assert.doesNotMatch(source, /insert\s+into\s+public\.grocery_items/i);
});
