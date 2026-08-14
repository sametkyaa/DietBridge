import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = join(repoRoot, 'supabase', 'migrations');

const fail = (message) => {
  throw new Error(message);
};

const assert = (condition, label, detail = '') => {
  if (!condition) fail(label + (detail ? ': ' + detail : ''));
  process.stdout.write('PASS: ' + label + (detail ? ' ' + detail : '') + '\n');
};

const readMigrationInventory = () => readdirSync(migrationDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();

const files = readMigrationInventory();
assert(files.length === 45, 'NOTIFICATION_MIGRATION_COUNT_45', 'count=' + files.length);

const notificationFiles = files.filter((name) => /_notification_core_backend\.sql$/.test(name));
assert(notificationFiles.length === 1, 'ONE_NOTIFICATION_CORE_MIGRATION', notificationFiles.join(','));
const migrationName = notificationFiles[0];
assert(migrationName === '20260814214101_notification_core_backend.sql', 'NEXT_CANONICAL_MIGRATION_VERSION', migrationName);

const sql = readFileSync(join(migrationDirectory, migrationName), 'utf8');
const tableStart = sql.indexOf('create table public.notifications');
const tableEnd = sql.indexOf('\n\ncomment on table public.notifications', tableStart);
assert(tableStart >= 0 && tableEnd > tableStart, 'NOTIFICATIONS_TABLE_BLOCK_PRESENT');
const tableBlock = sql.slice(tableStart, tableEnd);

const requiredColumns = [
  ['id', '\\buuid\\s+primary key'],
  ['recipient_id', '\\buuid\\s+not null'],
  ['category', '\\btext\\s+not null'],
  ['event_type', '\\btext\\s+not null'],
  ['aggregation_key', '\\btext\\s+not null'],
  ['actor_id', '\\buuid'],
  ['actor_display_name', '\\btext'],
  ['conversation_id', '\\buuid'],
  ['appointment_id', '\\buuid'],
  ['dietitian_client_id', '\\buuid'],
  ['summary_key', '\\btext\\s+not null'],
  ['appointment_title_snapshot', '\\btext'],
  ['appointment_date', '\\bdate'],
  ['appointment_time', '\\btime\\s+without\\s+time\\s+zone'],
  ['appointment_status', '\\btext'],
  ['relationship_from_status', '\\bpublic\\.client_status'],
  ['relationship_to_status', '\\bpublic\\.client_status'],
  ['event_count', '\\binteger\\s+not null'],
  ['occurred_at', '\\btimestamptz\\s+not null'],
  ['seen_at', '\\btimestamptz'],
  ['read_at', '\\btimestamptz'],
  ['created_at', '\\btimestamptz\\s+not null'],
  ['updated_at', '\\btimestamptz\\s+not null'],
];

for (const [column, typePattern] of requiredColumns) {
  assert(new RegExp('^\\s*' + column + '\\s+' + typePattern, 'm').test(tableBlock), 'COLUMN_' + column);
}
assert(!/\bjsonb?\b/i.test(tableBlock), 'NO_JSON_METADATA_COLUMN');
assert(!/^\s*body\s+/im.test(tableBlock), 'NO_CHAT_BODY_COLUMN');

for (const constraint of [
  'notifications_recipient_fkey',
  'notifications_actor_fkey',
  'notifications_aggregation_key_check',
  'notifications_category_event_check',
  'notifications_source_consistency_check',
  'notifications_event_count_check',
  'notifications_read_requires_seen_check',
]) {
  assert(tableBlock.includes(constraint), 'CONSTRAINT_' + constraint);
}
assert(tableBlock.includes('on delete cascade'), 'RECIPIENT_DELETE_CASCADE_IS_EXPLICIT');
assert(tableBlock.includes('on delete set null'), 'ACTOR_DELETE_PRESERVES_HISTORY');
assert(/category\s*=\s*'chat_message'/.test(tableBlock)
  && /category\s*=\s*'appointment'/.test(tableBlock)
  && /category\s*=\s*'relationship'/.test(tableBlock), 'CATEGORY_DOMAIN_BOUNDED');
assert(/event_count\s*>=\s*1/.test(tableBlock), 'EVENT_COUNT_POSITIVE');
assert(/read_at\s+is null\s+or\s+seen_at\s+is not null/.test(tableBlock), 'READ_IMPLIES_SEEN');
assert(/conversation_id\s+is not null/.test(tableBlock)
  && /appointment_id\s+is not null/.test(tableBlock)
  && /dietitian_client_id\s+is not null/.test(tableBlock), 'SOURCE_FIELDS_TYPED_AND_SCOPED');

for (const indexName of [
  'notifications_recipient_aggregation_key_unique',
  'notifications_recipient_occurred_id_idx',
  'notifications_recipient_unseen_idx',
  'notifications_recipient_unread_idx',
]) {
  assert(sql.includes(indexName), 'INDEX_' + indexName);
}
assert(/where seen_at is null/.test(sql), 'PARTIAL_UNSEEN_INDEX');
assert(/where read_at is null/.test(sql), 'PARTIAL_UNREAD_INDEX');

assert(/alter table public\.notifications enable row level security/.test(sql), 'RLS_ENABLED');
assert(sql.includes('Notification recipients can select own notifications'), 'OWN_RECIPIENT_SELECT_POLICY');
assert(/revoke all on table public\.notifications from public, anon, authenticated/.test(sql), 'DIRECT_AUTHENTICATED_TABLE_DML_REVOKED');
assert(/grant select on table public\.notifications to authenticated/.test(sql), 'AUTHENTICATED_SELECT_GRANTED');
assert(!/grant (?:insert|update|delete|all) on table public\.notifications to authenticated/i.test(sql), 'NO_AUTHENTICATED_DIRECT_WRITE_GRANT');
assert(/revoke all on schema private from public, anon, authenticated, service_role/.test(sql), 'PRIVATE_SCHEMA_NOT_CLIENT_EXPOSED');

const functionBlock = (signature, nextSignature) => {
  const start = sql.indexOf(signature);
  const end = nextSignature ? sql.indexOf(nextSignature, start + signature.length) : sql.length;
  assert(start >= 0 && end > start, 'FUNCTION_' + signature.replaceAll(/\s+/g, '_'));
  return sql.slice(start, end);
};

const seenBlock = functionBlock('create function public.mark_notification_seen', 'create function public.mark_notification_read');
const readBlock = functionBlock('create function public.mark_notification_read', 'create function public.mark_notifications_seen');
const batchBlock = functionBlock('create function public.mark_notifications_seen', 'alter function public.mark_notification_seen');
const producerBlock = functionBlock('create function private.upsert_notification_aggregate', 'create function public.mark_notification_seen');

for (const [label, block] of [
  ['SEEN', seenBlock],
  ['READ', readBlock],
  ['BATCH', batchBlock],
]) {
  assert(/security definer/.test(block), label + '_RPC_SECURITY_DEFINER');
  assert(/auth\.uid\(\)/.test(block), label + '_RPC_AUTH_UID_BOUND');
  assert(/using errcode = '42501'/.test(block), label + '_RPC_FAIL_CLOSED');
}
assert(/seen_at\s*=\s*coalesce\(seen_at,\s*now\(\)\)/.test(readBlock), 'READ_REARMS_SEEN');
assert(/read_at\s*=\s*coalesce\(read_at,\s*now\(\)\)/.test(readBlock), 'READ_SETS_READ_AT');
assert(/cardinality\(p_notification_ids\)\s*>\s*100/.test(batchBlock), 'BATCH_LIMIT_100');
assert(/unnest\(p_notification_ids\)/.test(batchBlock), 'BATCH_FOREIGN_OWNERSHIP_VALIDATED');
assert(/where recipient_id = v_actor_id/.test(batchBlock), 'BATCH_RECIPIENT_SCOPED_UPDATE');
assert(/grant execute on function public\.mark_notification_seen\(uuid\) to authenticated/.test(sql)
  && /grant execute on function public\.mark_notification_read\(uuid\) to authenticated/.test(sql)
  && /grant execute on function public\.mark_notifications_seen\(uuid\[\]\) to authenticated/.test(sql), 'RPC_EXECUTE_AUTHENTICATED_ONLY');
const notificationGrantLines = sql.split(/\r?\n/)
  .filter((line) => /grant execute on function public\.mark_notification/.test(line));
assert(notificationGrantLines.every((line) => /to authenticated\s*;/.test(line)), 'RPC_ANON_EXECUTE_REVOKED');

assert(/security definer/.test(producerBlock), 'PRODUCER_SECURITY_DEFINER');
assert(/set search_path = pg_catalog, public, private/.test(producerBlock), 'PRODUCER_FIXED_SEARCH_PATH');
assert(/from public\.profiles/.test(producerBlock) && /full_name/.test(producerBlock), 'ACTOR_NAME_SERVER_DERIVED');
assert(/on conflict \(recipient_id, aggregation_key\) do update/.test(producerBlock), 'AGGREGATE_ATOMIC_UPSERT');
assert(/case when n\.read_at is null then n\.event_count \+ 1 else 1 end/.test(producerBlock), 'AGGREGATE_READ_RESET_RULE');
assert(/seen_at = null/.test(producerBlock) && /read_at = null/.test(producerBlock), 'AGGREGATE_REARM_RULE');
assert(!/grant execute on function private\.upsert_notification_aggregate/.test(sql), 'PRODUCER_NOT_GRANTED');

const sendBlock = functionBlock('create or replace function public.send_chat_message', 'alter function public.send_chat_message');
const imageBlock = functionBlock('create or replace function public.finalize_chat_image_message', 'create function private.notify_appointment_change');
assert(/on conflict \(sender_id, client_message_id\) do nothing/.test(sendBlock), 'CHAT_TEXT_IDEMPOTENCY_INSERT');
assert(sendBlock.indexOf('if v_message.id is null') < sendBlock.indexOf('private.upsert_notification_aggregate'), 'CHAT_TEXT_PRODUCER_AFTER_NEW_INSERT_GUARD');
assert(/format\('chat:%s', v_conversation_id\)/.test(sendBlock), 'CHAT_TEXT_CONVERSATION_AGGREGATION_KEY');
assert(/p_body/.test(sendBlock) && !/p_body\s*=>/.test(sendBlock.slice(sendBlock.indexOf('private.upsert_notification_aggregate'))), 'CHAT_BODY_NOT_IN_NOTIFICATION');
assert(/v_message_was_inserted boolean := false/.test(imageBlock), 'CHAT_IMAGE_INSERT_GUARD');
assert(/if v_message_was_inserted then/.test(imageBlock), 'CHAT_IMAGE_PRODUCER_ONLY_NEW_INSERT');
assert(/format\('chat:%s', v_intent\.conversation_id\)/.test(imageBlock), 'CHAT_IMAGE_CONVERSATION_AGGREGATION_KEY');
assert(!/grant execute on function public\.finalize_chat_image_message|revoke all on function public\.finalize_chat_image_message/.test(sql), 'CHAT_IMAGE_ACL_UNCHANGED');
assert(!/\bmeal\b|\bmeals\b|\bmeal_/i.test(sql), 'MEAL_ACTIVITY_HAS_NO_NOTIFICATION_PRODUCER');

const appointmentBlock = functionBlock('create function private.notify_appointment_change', 'create function private.notify_dietitian_client_change');
assert(/after insert or update on public\.appointments/.test(sql), 'APPOINTMENT_AFTER_INSERT_UPDATE_TRIGGER');
assert(!/after delete on public\.appointments|after insert or update or delete on public\.appointments/.test(sql), 'APPOINTMENT_DELETE_NOT_NOTIFIED');
assert(/old\.client_id is distinct from new\.client_id/.test(appointmentBlock), 'APPOINTMENT_REASSIGNMENT_NULL_SAFE');
assert(/old\.status = 'upcoming' and new\.status = 'cancelled'/.test(appointmentBlock), 'APPOINTMENT_CANCELLATION_TRANSITION');
for (const eventType of ['created', 'updated', 'cancelled', 'assigned', 'removed_from_client']) {
  assert(appointmentBlock.includes("'" + eventType + "'"), 'APPOINTMENT_EVENT_' + eventType);
}
assert(/format\('appointment:%s'/.test(appointmentBlock), 'APPOINTMENT_AGGREGATION_KEY');

const relationshipBlock = functionBlock('create function private.notify_dietitian_client_change', 'alter function private.notify_appointment_change');
assert(/after insert or update on public\.dietitian_clients/.test(sql), 'RELATIONSHIP_AFTER_INSERT_UPDATE_TRIGGER');
assert(!/after delete on public\.dietitian_clients|after insert or update or delete on public\.dietitian_clients/.test(sql), 'RELATIONSHIP_DELETE_NOT_NOTIFIED');
for (const transition of [
  "new.status = 'pending'::public.client_status",
  "old.status = 'pending'::public.client_status\n     and new.status = 'active'::public.client_status",
  "old.status = 'pending'::public.client_status\n        and new.status = 'rejected'::public.client_status",
  "old.status = 'active'::public.client_status\n        and new.status = 'removed'::public.client_status",
  "old.status in ('rejected'::public.client_status, 'removed'::public.client_status)\n        and new.status = 'pending'::public.client_status",
]) {
  assert(relationshipBlock.includes(transition), 'RELATIONSHIP_SUPPORTED_TRANSITION');
}
assert(!/old\.status = 'pending'::public\.client_status\s+and new\.status = 'removed'::public\.client_status/.test(relationshipBlock), 'RELATIONSHIP_PENDING_REMOVED_EXCLUDED');

assert(/alter publication supabase_realtime add table public\.notifications/.test(sql), 'REALTIME_NOTIFICATIONS_PUBLICATION');
assert(!/alter publication supabase_realtime add table public\.(?:chat_messages|chat_conversations|chat_read_states|meals)/.test(sql), 'EXISTING_REALTIME_PUBLICATIONS_UNTOUCHED');

process.stdout.write('NOTIFICATION_CORE_STATIC_CONTRACT_PASS\n');
