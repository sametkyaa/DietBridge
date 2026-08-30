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
assert(files.length === 53, 'NOTIFICATION_MIGRATION_COUNT_53_WITH_MEAL_PLAN_SAVE', 'count=' + files.length);

const notificationFiles = files.filter((name) => /_notification_core_backend\.sql$/.test(name));
assert(notificationFiles.length === 1, 'ONE_NOTIFICATION_CORE_MIGRATION', notificationFiles.join(','));
const migrationName = notificationFiles[0];
assert(migrationName === '20260814214101_notification_core_backend.sql', 'NEXT_CANONICAL_MIGRATION_VERSION', migrationName);
const markAllReadMigrationName = '20260816101405_mark_all_notifications_read.sql';
const appointmentReminderMigrationName = '20260817084531_appointment_reminders_backend.sql';
const pushRegistryMigrationName = '20260817120000_push_registry_outbox_backend.sql';
assert(files.includes(markAllReadMigrationName), 'MARK_ALL_READ_MIGRATION_PRESENT', markAllReadMigrationName);
assert(files.includes(appointmentReminderMigrationName), 'APPOINTMENT_REMINDER_MIGRATION_PRESENT', appointmentReminderMigrationName);
assert(files.includes(pushRegistryMigrationName), 'PUSH_REGISTRY_MIGRATION_PRESENT', files.at(-1));
assert(files.at(-5) === '20260826133224_product_admin_dietitian_verification.sql', 'PRODUCT_ADMIN_MIGRATION_BEFORE_STANDALONE_ADMIN', files.at(-5));
assert(files.at(-4) === '20260827084741_standalone_platform_admin_access.sql', 'STANDALONE_ADMIN_MIGRATION_BEFORE_DIPLOMA_STORAGE', files.at(-4));
assert(files.at(-3) === '20260830060342_dietitian_diploma_storage_hardening.sql', 'DIPLOMA_STORAGE_MIGRATION_BEFORE_MEAL_PLAN_SAVE', files.at(-3));
assert(files.at(-2) === '20260830141202_meal_plan_cross_day_identity_preservation.sql', 'CROSS_DAY_MEAL_PLAN_SAVE_BEFORE_SNAPSHOT_EDIT', files.at(-2));
assert(files.at(-1) === '20260830185101_meal_plan_snapshot_edit_contract.sql', 'MEAL_PLAN_SAVE_MIGRATION_TAIL', files.at(-1));
const markAllReadSql = readFileSync(join(migrationDirectory, markAllReadMigrationName), 'utf8');
const appointmentReminderSql = readFileSync(join(migrationDirectory, appointmentReminderMigrationName), 'utf8');

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
const markAllReadStart = markAllReadSql.indexOf('create function public.mark_all_notifications_read()');
const markAllReadEnd = markAllReadSql.indexOf('\nalter function public.mark_all_notifications_read()', markAllReadStart);
assert(markAllReadStart >= 0 && markAllReadEnd > markAllReadStart, 'FUNCTION_mark_all_notifications_read');
const markAllReadBlock = markAllReadSql.slice(markAllReadStart, markAllReadEnd);

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

assert(/create function public\.mark_all_notifications_read\(\)/.test(markAllReadSql), 'MARK_ALL_READ_NO_PARAMETERS');
assert(/returns integer/.test(markAllReadBlock), 'MARK_ALL_READ_SCALAR_RETURN');
assert(/security definer/.test(markAllReadBlock), 'MARK_ALL_READ_SECURITY_DEFINER');
assert(/set search_path = pg_catalog, public/.test(markAllReadBlock), 'MARK_ALL_READ_FIXED_SEARCH_PATH');
assert(/auth\.uid\(\)/.test(markAllReadBlock), 'MARK_ALL_READ_AUTH_UID_BOUND');
assert(/v_operation_at timestamptz := now\(\)/.test(markAllReadBlock), 'MARK_ALL_READ_STABLE_TIMESTAMP');
assert(/update public\.notifications/.test(markAllReadBlock), 'MARK_ALL_READ_NOTIFICATION_TABLE_ONLY');
assert(/seen_at = coalesce\(seen_at, v_operation_at\)/.test(markAllReadBlock), 'MARK_ALL_READ_SETS_SEEN');
assert(/read_at = coalesce\(read_at, v_operation_at\)/.test(markAllReadBlock), 'MARK_ALL_READ_SETS_READ');
assert(/updated_at = v_operation_at/.test(markAllReadBlock), 'MARK_ALL_READ_UPDATES_TIMESTAMP');
assert(/where recipient_id = v_actor_id\s+and read_at is null/.test(markAllReadBlock), 'MARK_ALL_READ_RECIPIENT_UNREAD_SCOPE');
assert(/get diagnostics v_count = row_count/.test(markAllReadBlock), 'MARK_ALL_READ_AFFECTED_COUNT');
assert(!/p_recipient_id|p_notification_id|p_notification_ids/.test(markAllReadBlock), 'MARK_ALL_READ_NO_CALLER_ID');
assert(!/\b(category|event_type|aggregation_key|actor_id|event_count|occurred_at)\s*=/.test(markAllReadBlock), 'MARK_ALL_READ_SOURCE_FIELDS_UNCHANGED');
assert(/revoke all on function public\.mark_all_notifications_read\(\) from public, anon, authenticated, service_role/.test(markAllReadSql), 'MARK_ALL_READ_EXECUTE_REVOKED_BY_DEFAULT');
assert(/grant execute on function public\.mark_all_notifications_read\(\) to authenticated/.test(markAllReadSql), 'MARK_ALL_READ_EXECUTE_AUTHENTICATED_ONLY');
assert(!/grant execute on function public\.mark_all_notifications_read\(\) to (?:public|anon|service_role)/.test(markAllReadSql), 'MARK_ALL_READ_NO_UNTRUSTED_EXECUTE');

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

assert(appointmentReminderSql.includes('drop constraint notifications_category_event_check'), 'REMINDER_FORWARD_ONLY_CONSTRAINT_REPLACEMENT');
assert(appointmentReminderSql.includes("event_type = 'reminder_24h'"), 'REMINDER_EVENT_24H');
assert(appointmentReminderSql.includes("event_type = 'reminder_1h'"), 'REMINDER_EVENT_1H');
assert(appointmentReminderSql.includes("summary_key = 'appointment_reminder_24h'"), 'REMINDER_SUMMARY_24H');
assert(appointmentReminderSql.includes("summary_key = 'appointment_reminder_1h'"), 'REMINDER_SUMMARY_1H');
assert(appointmentReminderSql.includes('notifications_appointment_reminder_contract_check'), 'REMINDER_SAFE_SNAPSHOT_CONSTRAINT');
assert(appointmentReminderSql.includes('appointments_upcoming_reminder_candidate_idx'), 'REMINDER_CANDIDATE_INDEX');
assert(/format\(\s*'appointment_reminder:%s:%s:%s:%s'/.test(appointmentReminderSql), 'REMINDER_OCCURRENCE_KEY_BACKEND_GENERATED');
assert(/to_char\(p_appointment_time,\s*'HH24:MI'\)/.test(appointmentReminderSql), 'REMINDER_OCCURRENCE_KEY_CIVIL_TIME');

const reminderProducerStart = appointmentReminderSql.indexOf('create function private.insert_appointment_reminder_once');
const reminderProcessorStart = appointmentReminderSql.indexOf('create function private.process_appointment_reminders_at');
assert(reminderProducerStart >= 0 && reminderProcessorStart > reminderProducerStart, 'REMINDER_FUNCTION_ORDER');
const reminderProducerBlock = appointmentReminderSql.slice(reminderProducerStart, reminderProcessorStart);
const reminderProcessorBlock = appointmentReminderSql.slice(reminderProcessorStart);
assert(/returns boolean/.test(reminderProducerBlock), 'REMINDER_PRODUCER_BOOLEAN_RESULT');
assert(/security definer/.test(reminderProducerBlock), 'REMINDER_PRODUCER_SECURITY_DEFINER');
assert(/set search_path = pg_catalog, public, private/.test(reminderProducerBlock), 'REMINDER_PRODUCER_FIXED_SEARCH_PATH');
assert(/on conflict \(recipient_id, aggregation_key\) do nothing/.test(reminderProducerBlock), 'REMINDER_PRODUCER_INSERT_ONCE');
assert(!/on conflict[\s\S]*do update/.test(reminderProducerBlock), 'REMINDER_PRODUCER_NO_UPDATE_ON_CONFLICT');
assert(/event_count,/.test(reminderProducerBlock) && /\n\s*1,/.test(reminderProducerBlock), 'REMINDER_PRODUCER_EVENT_COUNT_ONE');
assert(/seen_at,\s*read_at/.test(reminderProducerBlock) && /\n\s*null,\s*null/.test(reminderProducerBlock), 'REMINDER_PRODUCER_UNSEEN_UNREAD');
assert(/revoke all on function private\.insert_appointment_reminder_once/.test(reminderProducerBlock), 'REMINDER_PRODUCER_PRIVATE_ACL');
assert(/for update of a skip locked/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_ROW_LOCKING');
assert(/status = 'upcoming'/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_UPCOMING_ONLY');
assert(/p\.role = 'client'::public\.user_role/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_CLIENT_ROLE');
assert(/status = 'active'::public\.client_status/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_ACTIVE_RELATIONSHIP');
assert(/at time zone 'Europe\/Istanbul'/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_ISTANBUL_TIMEZONE');
assert(/interval '24 hours'/.test(reminderProcessorBlock) && /interval '1 hour'/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_OFFSETS');
assert(/interval '10 minutes'/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_BOUNDED_WINDOW');
assert(/created_at <= reminder\.target_at/.test(reminderProcessorBlock)
  && /v_current\.created_at > v_target_at/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_NO_LATE_CATCHUP');
assert(!/update public\.appointments/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_NO_APPOINTMENT_MUTATION');
assert(/create function private\.process_appointment_reminders\(\)/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_PRODUCTION_WRAPPER');
assert(/revoke all on function private\.process_appointment_reminders\(\)/.test(reminderProcessorBlock), 'REMINDER_PROCESSOR_PRIVATE_ACL');
assert(/cron\.schedule\(\s*'appointment-reminders-every-5-minutes',\s*'\*\/5 \* \* \* \*'/.test(appointmentReminderSql), 'REMINDER_CRON_NAME_AND_SCHEDULE');
assert(/select private\.process_appointment_reminders\(\);/.test(appointmentReminderSql), 'REMINDER_CRON_DATABASE_TARGET');
assert(!/net\.http_post|vault\.decrypted_secrets|pg_net|service_role_key/i.test(appointmentReminderSql), 'REMINDER_CRON_NO_HTTP_SECRET_DEPENDENCY');

process.stdout.write('NOTIFICATION_CORE_STATIC_CONTRACT_PASS\n');
