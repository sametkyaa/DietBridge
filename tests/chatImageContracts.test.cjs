const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const path = require('node:path');

const repoRoot = path.join(__dirname, '..');
const migrationNames = [
  '20260729090000_chat_image_schema.sql',
  '20260729090100_chat_image_rls_privileges.sql',
  '20260729090200_chat_image_rpc.sql',
  '20260729090300_chat_image_storage.sql',
  '20260729090400_chat_image_cleanup.sql',
];

const readMigration = (name) => fs.readFileSync(
  path.join(repoRoot, 'supabase', 'migrations', name),
  'utf8',
);

const migrations = Object.fromEntries(migrationNames.map((name) => [name, readMigration(name)]));
const combined = Object.values(migrations).join('\n');

const assertMatches = (source, pattern, message) => {
  assert.match(source, pattern, message);
};

test('chat image migrations are present in the approved order without activation migration', () => {
  const migrationDirectory = path.join(repoRoot, 'supabase', 'migrations');
  const present = fs.readdirSync(migrationDirectory)
    .filter((name) => name.includes('chat_image'))
    .sort();

  assert.deepEqual(present, migrationNames);
  assert.equal(fs.existsSync(path.join(
    migrationDirectory,
    '20260729090500_chat_image_activation.sql',
  )), false);
});

test('historical migrations stay immutable while disposable syntax edits are explicitly allowlisted', () => {
  const rules = JSON.parse(fs.readFileSync(
    path.join(repoRoot, 'tests', 'fixtures', 'canonicalReplaySyntaxEdits.json'),
    'utf8',
  ));
  assert.equal(rules.files.filter(({ phase }) => phase === 'canonical').length, 27);
  assert.equal(rules.files.filter(({ phase }) => phase === 'image').length, 5);
  assert.equal(rules.files.filter(({ edits }) => edits.length > 0).length, 16);
  for (const rule of rules.files) {
    const source = fs.readFileSync(path.join(repoRoot, rule.path));
    assert.equal(createHash('sha256').update(source).digest('hex'), rule.sourceSha256, rule.path);
    for (const edit of rule.edits) assert.equal(edit.after, `${edit.before};`, rule.path);
  }

  const avatarPolicy = readMigration('20260728160000_allow_active_clients_read_linked_dietitian_avatar.sql');
  assert.doesNotMatch(avatarPolicy, /insert into storage\.buckets/i);
  assertMatches(avatarPolicy, /Expected private avatars bucket is missing; migration stopped\./i);
});

test('schema is additive and keeps text as the default message contract', () => {
  const sql = migrations[migrationNames[0]];
  assertMatches(sql, /add column message_kind text not null default 'text'/i);
  assertMatches(sql, /message_kind in \('text', 'image'\)/i);
  assertMatches(sql, /create table public\.chat_upload_intents/i);
  assertMatches(sql, /unique \(created_by, client_message_id\)/i);
  assertMatches(sql, /unique \(bucket_id, object_path\)/i);
  assertMatches(sql, /create table public\.chat_attachments/i);
  assertMatches(sql, /message_id uuid not null unique/i);
  assertMatches(sql, /intent_id uuid not null unique/i);
  assertMatches(sql, /expected_mime = 'image\/jpeg'/i);
  assertMatches(sql, /validated_mime = 'image\/jpeg'/i);
  assertMatches(sql, /mime_type = 'image\/jpeg'/i);
  assertMatches(sql, /object_path ~ '[^']+\\\.jpg\$'/i);
  assertMatches(sql, /validated_width between 1 and 2048/i);
  assertMatches(sql, /validated_height between 1 and 2048/i);
  assertMatches(sql, /validated_width::bigint \* validated_height::bigint <= 4194304/i);
  assertMatches(sql, /width between 1 and 2048/i);
  assertMatches(sql, /height between 1 and 2048/i);
  assertMatches(sql, /width::bigint \* height::bigint <= 4194304/i);
  assertMatches(sql, /num_nonnulls\([\s\S]+validated_at[\s\S]+\) = 5/i);
  assertMatches(sql, /new\.message_kind = 'text' and new\.body is null/i);
  assertMatches(sql, /new\.message_kind not in \('text', 'image'\)/i);
  assert.doesNotMatch(combined, /alter\s+publication\s+supabase_realtime/i);
});

test('new migrations do not replace or alter the four canonical text RPCs', () => {
  const forbiddenDefinition = /create(?:\s+or\s+replace)?\s+function\s+public\.(?:send_chat_message|delete_chat_message|mark_chat_conversation_delivered|mark_chat_conversation_read)\s*\(/i;
  const forbiddenAlter = /alter\s+function\s+public\.(?:send_chat_message|delete_chat_message|mark_chat_conversation_delivered|mark_chat_conversation_read)\s*\(/i;
  assert.doesNotMatch(combined, forbiddenDefinition);
  assert.doesNotMatch(combined, forbiddenAlter);

  const sendSql = readMigration('20260726090300_chat_rpc.sql');
  const receiptSql = readMigration('20260728103000_chat_delete_delivery_receipts.sql');
  assertMatches(sendSql, /create function public\.send_chat_message\(\s*p_dietitian_client_id uuid,\s*p_client_message_id uuid,\s*p_body text/is);
  assertMatches(receiptSql, /create function public\.delete_chat_message\(p_message_id uuid\)/i);
  assertMatches(receiptSql, /create function public\.mark_chat_conversation_delivered\(p_conversation_id uuid, p_last_delivered_message_id uuid\)/i);
  assertMatches(receiptSql, /create or replace function public\.mark_chat_conversation_read\(p_conversation_id uuid, p_last_read_message_id uuid\)/i);
});

test('RLS exposes participant reads but no authenticated direct mutations', () => {
  const sql = migrations[migrationNames[1]];
  assertMatches(sql, /create policy chat_upload_intents_select_own/i);
  assertMatches(sql, /created_by = \(select auth\.uid\(\)\)/i);
  assertMatches(sql, /create policy chat_attachments_select_participant/i);
  assertMatches(sql, /m\.deleted_at is null/i);
  assertMatches(sql, /revoke all on table public\.chat_upload_intents from public, anon, authenticated/i);
  assertMatches(sql, /revoke all on table public\.chat_attachments from public, anon, authenticated/i);
  assertMatches(sql, /cmd in \('INSERT', 'UPDATE', 'DELETE'\)/i);
});

test('visual RPCs are dormant and path generation stays server-side', () => {
  const sql = migrations[migrationNames[2]];
  assertMatches(sql, /create function public\.create_chat_image_upload_intent\(\s*p_conversation_id uuid,\s*p_client_message_id uuid,\s*p_expected_mime text/is);
  assertMatches(sql, /format\('pending\/%s\/%s\.%s', v_intent_id, gen_random_uuid\(\), v_extension\)/i);
  assertMatches(sql, /v_extension constant text := 'jpg'/i);
  assertMatches(sql, /p_expected_mime is distinct from 'image\/jpeg'/i);
  assertMatches(sql, /p_validated_mime is distinct from 'image\/jpeg'/i);
  assertMatches(sql, /p_validated_width not between 1 and 2048/i);
  assertMatches(sql, /p_validated_height not between 1 and 2048/i);
  assertMatches(sql, /p_validated_width::bigint \* p_validated_height::bigint > 4194304/i);
  assert.doesNotMatch(sql, /image\/(?:png|webp)/i);
  assert.doesNotMatch(sql, /p_(?:object_path|bucket_id|sender_id)\b/i);
  assertMatches(sql, /now\(\) \+ interval '15 minutes'/i);
  assertMatches(sql, /create function public\.finalize_chat_image_message\(\s*p_intent_id uuid,\s*p_caption text/is);
  assertMatches(sql, /create function public\.abort_chat_image_upload\(p_intent_id uuid\)/i);
  assertMatches(sql, /create function public\.record_chat_image_validation/i);
  assertMatches(sql, /p_validated_mime is null[\s\S]+p_validated_height is null/i);
  assertMatches(sql, /grant execute on function public\.record_chat_image_validation[\s\S]+to service_role/i);
  assert.doesNotMatch(sql, /grant execute on function public\.(?:create_chat_image_upload_intent|finalize_chat_image_message|abort_chat_image_upload)[^;]+to authenticated/i);
});

test('chat-images bucket is private and has only insert/select policies', () => {
  const sql = migrations[migrationNames[3]];
  assertMatches(sql, /'chat-images',\s*'chat-images',\s*false,\s*4194304/is);
  assertMatches(sql, /array\['image\/jpeg'\]::text\[\]/i);
  assert.doesNotMatch(sql, /image\/(?:png|webp)/i);
  assertMatches(sql, /create policy chat_images_insert_pending_intent/i);
  assertMatches(sql, /i\.object_path = storage\.objects\.name/i);
  assertMatches(sql, /i\.expected_mime = 'image\/jpeg'/i);
  assertMatches(sql, /i\.expires_at > now\(\)/i);
  assertMatches(sql, /create policy chat_images_select_live_attachment/i);
  assertMatches(sql, /a\.deleted_at is null/i);
  assertMatches(sql, /m\.deleted_at is null/i);
  assert.doesNotMatch(sql, /for (?:update|delete)\s+to authenticated/i);
});

test('web and mobile must canonicalize picked images before creating an upload intent', () => {
  const sql = migrations[migrationNames[0]];
  assertMatches(sql, /web and mobile clients must decode a picked JPEG, PNG, or WebP/i);
  assertMatches(sql, /apply orientation/i);
  assertMatches(sql, /at most 2048 px on the longest edge/i);
  assertMatches(sql, /4194304 total pixels/i);
  assertMatches(sql, /re-encode as image\/jpeg at approximately 82 percent quality/i);
  assertMatches(sql, /strip EXIF and all other metadata/i);
  assertMatches(sql, /at or below 4194304 bytes/i);
});

test('cleanup is server-only, delayed and contains no scheduler or client polling', () => {
  const sql = migrations[migrationNames[4]];
  assertMatches(sql, /create table public\.chat_image_cleanup_queue/i);
  assertMatches(sql, /new\.deleted_at \+ interval '10 minutes'/i);
  assertMatches(sql, /for update skip locked/i);
  assertMatches(sql, /p_limit is null or p_limit not between 1 and 100/i);
  assertMatches(sql, /grant execute on function public\.claim_chat_image_cleanup_batch\(integer\) to service_role/i);
  assertMatches(sql, /grant execute on function public\.complete_chat_image_cleanup\(uuid\) to service_role/i);
  assert.doesNotMatch(sql, /\b(?:cron\.schedule|pg_cron|setInterval|removeAllChannels)\b/i);
});
