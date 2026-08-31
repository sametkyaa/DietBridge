import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationDirectory = join(repoRoot, 'supabase', 'migrations');
const migrationName = '20260817120000_push_registry_outbox_backend.sql';
const reminderName = '20260817084531_appointment_reminders_backend.sql';
const reminderSha256 = 'e3dd24c784e62131dfd3ee1ee611cc7634b3a30042331d2caf70e1af1946f474';

const fail = (message) => { throw new Error(message); };
const pass = (label, detail = '') => process.stdout.write(`PASS: ${label}${detail ? ` ${detail}` : ''}\n`);
const assert = (condition, label, detail = '') => {
  if (!condition) fail(label + (detail ? `: ${detail}` : ''));
  pass(label, detail);
};

const files = readdirSync(migrationDirectory)
  .filter((name) => /^\d+_.+\.sql$/.test(name))
  .sort();
const sql = readFileSync(join(migrationDirectory, migrationName), 'utf8');
const reminderSql = readFileSync(join(migrationDirectory, reminderName), 'utf8')
  .replaceAll('\r\n', '\n');
const reminderHash = createHash('sha256').update(reminderSql).digest('hex');

assert(files.length === 54, 'MIGRATION_INVENTORY_54_WITH_MEAL_PLAN_SAVE');
assert(files.includes(migrationName), 'PUSH_MIGRATION_REMAINS_CANONICAL');
assert(files.at(-6) === '20260826133224_product_admin_dietitian_verification.sql', 'PRODUCT_ADMIN_MIGRATION_BEFORE_STANDALONE_ADMIN');
assert(files.at(-5) === '20260827084741_standalone_platform_admin_access.sql', 'STANDALONE_ADMIN_MIGRATION_BEFORE_DIPLOMA_STORAGE');
assert(files.at(-4) === '20260830060342_dietitian_diploma_storage_hardening.sql', 'DIPLOMA_STORAGE_MIGRATION_BEFORE_MEAL_PLAN_SAVE');
assert(files.at(-3) === '20260830141202_meal_plan_cross_day_identity_preservation.sql', 'CROSS_DAY_MEAL_PLAN_SAVE_BEFORE_SNAPSHOT_EDIT');
assert(files.at(-2) === '20260830185101_meal_plan_snapshot_edit_contract.sql', 'SNAPSHOT_EDIT_BEFORE_NEW_RECIPE_CUSTOM_SNAPSHOT');
assert(files.at(-1) === '20260831071948_meal_plan_new_recipe_custom_snapshot_contract.sql', 'NEW_RECIPE_CUSTOM_SNAPSHOT_MIGRATION_IS_TAIL');
assert(!/\b(?:pg_net|net\.http_post|http_post|vault\.decrypted_secrets|fetch\s*\()/i.test(sql), 'NO_PROVIDER_NETWORK_OR_SECRET_ACCESS');
assert(!/alter publication|create publication|create webhook/i.test(sql), 'NO_REALTIME_OR_DATABASE_WEBHOOK');
assert(!/insert\s+into\s+public\.notifications|update\s+public\.notifications/i.test(sql), 'PUSH_DOES_NOT_MUTATE_NOTIFICATION_SOURCE');

for (const table of ['private.push_installations', 'private.push_occurrences', 'private.push_deliveries']) {
  assert(sql.includes(`create table ${table}`), `TABLE_${table.replaceAll('.', '_')}`);
  assert(sql.includes(`alter table ${table} enable row level security`), `RLS_${table.replaceAll('.', '_')}`);
}

for (const required of [
  'installation_id uuid not null',
  'expo_push_token text not null',
  'project_id uuid not null',
  "platform in ('android', 'ios')",
  'push_installations_active_installation_unique',
  'push_installations_active_token_unique',
  'push_deliveries_occurrence_installation_unique',
  "'pending'",
  "'claimed'",
  "'ticketed'",
  "'receipt_ok'",
  "'retryable'",
  "'permanent'",
  "'disabled'",
  "'coalesced'",
]) {
  assert(sql.includes(required), 'REQUIRED_CONTRACT_' + required.replaceAll(/[^a-z0-9]+/gi, '_').toUpperCase());
}

assert(/create unique index push_installations_active_installation_unique[\s\S]*?where enabled/.test(sql), 'ACTIVE_INSTALLATION_UNIQUE_PARTIAL');
assert(/create unique index push_installations_active_token_unique[\s\S]*?where enabled/.test(sql), 'ACTIVE_TOKEN_UNIQUE_PARTIAL');
assert(/notification_id, occurred_at, event_count, event_type/.test(sql), 'OCCURRENCE_LOGICAL_IDENTITY');
assert(/new\.event_count > old\.event_count/.test(sql), 'MEANINGFUL_AGGREGATE_INCREMENT');
assert(/old\.read_at is not null[\s\S]*?new\.read_at is null[\s\S]*?new\.occurred_at is distinct from old\.occurred_at[\s\S]*?new\.event_count = 1/.test(sql), 'READ_AGGREGATE_REARM');
assert(/seen_at/.test(sql) && /read_at/.test(sql) && /mark-all/i.test(sql) === false, 'READ_SEEN_ONLY_DO_NOT_QUEUE_BY_ABSENCE');
assert(/now\(\) \+ interval '60 seconds'/.test(sql), 'CHAT_COALESCING_AVAILABILITY');
assert(/installation\.enabled[\s\S]*?installation\.user_id = new\.recipient_id/.test(sql), 'OCCURRENCE_ACTIVE_OWNER_FANOUT');
assert(/on conflict \(occurrence_id, installation_id\) do nothing/.test(sql), 'DELIVERY_IDEMPOTENCY');
assert(/installation\.user_id != delivery\.recipient_id|current owner|current enabled installation owner/i.test(sql), 'CURRENT_OWNER_CONTRACT_DOCUMENTED');

for (const event of [
  'chat_message', 'new_message',
  'created', 'updated', 'cancelled', 'assigned', 'removed_from_client',
  'reminder_24h', 'reminder_1h',
  'request_pending', 'accepted', 'rejected', 'removed',
]) {
  assert(sql.includes(`'${event}'`), 'ALLOWLIST_' + event.toUpperCase());
}
assert(!/meal_completion|meal_photo|meal activity/i.test(sql), 'MEAL_ACTIVITY_EXCLUDED');

assert(/create function public\.register_push_installation/.test(sql), 'REGISTER_RPC_PRESENT');
assert(/create function public\.revoke_push_installation/.test(sql), 'REVOKE_RPC_PRESENT');
assert(/auth\.uid\(\)/.test(sql), 'RPC_AUTH_UID_BOUND');
assert(!/p_user_id|p_recipient_id/.test(sql), 'RPC_HAS_NO_CALLER_USER_ID');
assert(/security definer/.test(sql), 'RPC_SECURITY_DEFINER');
assert(/set search_path = pg_catalog, public, private/.test(sql), 'RPC_FIXED_SEARCH_PATH');
assert(/grant execute on function public\.register_push_installation[\s\S]*?to authenticated/.test(sql), 'REGISTER_AUTH_EXECUTE');
assert(/grant execute on function public\.revoke_push_installation[\s\S]*?to authenticated/.test(sql), 'REVOKE_AUTH_EXECUTE');
assert(!/grant execute on function public\.(?:register|revoke)_push_installation[\s\S]*?to (?:anon|service_role)/.test(sql), 'NO_UNTRUSTED_RPC_EXECUTE');
assert(/revoke all on table private\.push_installations from public, anon, authenticated, service_role/.test(sql), 'REGISTRY_DIRECT_ACCESS_REVOKED');
assert(/revoke all on table private\.push_occurrences from public, anon, authenticated, service_role/.test(sql), 'OCCURRENCE_DIRECT_ACCESS_REVOKED');
assert(/revoke all on table private\.push_deliveries from public, anon, authenticated, service_role/.test(sql), 'DELIVERY_DIRECT_ACCESS_REVOKED');
assert(!/grant (?:select|insert|update|delete|all).*to authenticated/i.test(sql), 'NO_AUTHENTICATED_PRIVATE_TABLE_GRANT');
assert(/grant select, update on table private\.push_installations to service_role/.test(sql), 'FUTURE_WORKER_REGISTRY_GRANT');
assert(/grant select, update on table private\.push_deliveries to service_role/.test(sql), 'FUTURE_WORKER_DELIVERY_GRANT');
assert(/trg_guard_push_delivery_status_transition/.test(sql), 'STATUS_TRANSITION_GUARD');
assert(/receipt_ok.*permanent.*disabled.*coalesced.*terminal/i.test(sql), 'TERMINAL_STATUS_DOCUMENTED');
assert(reminderHash === reminderSha256, 'APPOINTMENT_REMINDER_HASH_PRESERVED', reminderHash);

process.stdout.write('PUSH_REGISTRY_STATIC_CONTRACT_PASS\n');
