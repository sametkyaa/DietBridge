'use strict';

// Static contracts for the Faz 2 backend migrations. Runtime behaviour is
// proven by scripts/runDisposableFaz2RuntimeHarness.mjs; these checks keep the
// security-relevant shape from drifting in review.
const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync, readdirSync } = require('node:fs');
const { join } = require('node:path');

const root = join(__dirname, '..');
const migrations = join(root, 'supabase', 'migrations');
const read = (name) => readFileSync(join(migrations, name), 'utf8');
const FAZ2 = [
  '20261006090000_meal_change_request_security.sql',
  '20261006090100_dietitian_unread_message_counts.sql',
  '20261006090200_client_nutrition_targets.sql',
  '20261006090300_profile_legal_acceptance.sql',
  '20261006090400_dietitian_activity_notifications.sql',
  '20261006090500_meal_slot_label.sql',
  '20261006090600_application_result_email_outbox.sql',
];

test('Faz 2 migrations are the ordered tail of the canonical chain', () => {
  const all = readdirSync(migrations).filter((name) => /^\d+_.+\.sql$/.test(name)).sort();
  assert.deepEqual(all.slice(-FAZ2.length), FAZ2);
  for (const name of FAZ2) {
    const sql = read(name);
    assert.match(sql, /^begin;$/m, `${name} is transactional`);
    assert.match(sql, /^commit;\s*$/m, `${name} commits`);
    assert.match(sql, /\$preflight\$/, `${name} has a preflight`);
    assert.match(sql, /\$postflight\$/, `${name} has a postflight`);
  }
});

test('Faz 2 migrations are registered for disposable replay, runtime and E2E', () => {
  const replay = readFileSync(join(root, 'scripts', 'runDisposableSupabaseLocalReplay.mjs'), 'utf8');
  const helper = readFileSync(join(root, 'scripts', 'addCurrentIsolatedMigrations.mjs'), 'utf8');
  const gate = readFileSync(join(root, 'scripts', 'runBackendQualityGate.mjs'), 'utf8');
  const e2e = readFileSync(join(root, 'scripts', 'runCriticalE2E.mjs'), 'utf8');
  for (const name of FAZ2) {
    assert.ok(replay.includes(`'${name}'`), `${name} isolated from the base replay`);
    assert.ok(helper.includes(`'${name}'`), `${name} applied by addFaz2Migrations`);
  }
  assert.ok(gate.includes('scripts/runDisposableFaz2RuntimeHarness.mjs'));
  assert.ok(e2e.includes('addFaz2Migrations('));
});

test('meal change requests: no direct status writes, decision only through the RPC', () => {
  const sql = read(FAZ2[0]);
  assert.match(sql, /drop policy if exists "meal_change_requests_update_parties"/);
  assert.match(sql, /drop policy if exists "meal_change_requests_insert_client"/);
  assert.match(sql, /revoke update, delete, truncate on table public\.meal_change_requests from anon, authenticated/);
  assert.doesNotMatch(sql, /create policy[^;]+for update/i);
  const insertPolicy = sql.match(/create policy "meal_change_requests_insert_client_active_dietitian"[\s\S]+?\);\n/)[0];
  for (const clause of [
    "status = 'pending'",
    'reviewed_at is null',
    "dc.status = 'active'::public.client_status",
    'dc.dietitian_id = meal_change_requests.dietitian_id',
  ]) assert.ok(insertPolicy.includes(clause), `insert policy requires ${clause}`);
  assert.match(sql, /v_request\.dietitian_id is distinct from v_actor_id/);
  assert.match(sql, /grant execute on function public\.review_meal_change_request\(uuid, text, text\) to authenticated/);
});

test('unread counts count only non-deleted client messages after the read cursor', () => {
  const sql = read(FAZ2[1]);
  assert.match(sql, /m\.sender_id = c\.client_id/);
  assert.match(sql, /m\.deleted_at is null/);
  assert.match(sql, /\(m\.created_at, m\.id\) > \(rs\.last_read_at, rs\.last_read_message_id\)/);
  assert.match(sql, /dc\.status = 'active'::public\.client_status/);
  assert.match(sql, /is_current_user_dietitian/);
});

test('nutrition targets are dietitian-owned and never on client_profiles', () => {
  const sql = read(FAZ2[2]);
  assert.doesNotMatch(sql, /alter table public\.client_profiles/);
  assert.match(sql, /revoke all on table public\.client_nutrition_targets from public, anon, authenticated/);
  assert.match(sql, /grant select on table public\.client_nutrition_targets to authenticated/);
  assert.match(sql, /min_kcal is null or max_kcal is null or min_kcal <= max_kcal/);
});

test('legal acceptance timestamps are server-written and backward compatible', () => {
  const sql = read(FAZ2[3]);
  assert.match(sql, /v_terms_accepted_at := now\(\)/);
  assert.match(sql, /v_kvkk_accepted_at := now\(\)/);
  assert.match(sql, /current_user in \('authenticated', 'anon'\)/);
  // The sign-up path must never reject metadata that lacks the flags.
  const signUp = sql.match(/create or replace function public\.handle_new_user\(\)[\s\S]+?\$function\$;/)[0];
  assert.doesNotMatch(signUp, /raise exception[^;]*(kvkk|terms|onay)/i);
});

test('new notification shapes are gated, deduplicated and never push-eligible', () => {
  const sql = read(FAZ2[4]);
  assert.match(sql, /\('client_meal_plan_updated', false, 'client'/);
  assert.doesNotMatch(sql, /create or replace function private\.is_push_eligible_notification/);
  assert.match(sql, /on conflict \(recipient_id, aggregation_key\) do nothing/);
  assert.match(sql, /where n\.read_at is not null\s+and n\.occurred_at < now\(\) - interval '6 hours'/);
  for (const key of ['client_meal_photo:%s', 'client_meal_change_request:%s', 'client_meal_inactivity:%s:%s', 'meal_plan_updated:%s:%s']) {
    assert.ok(sql.includes(key), `deterministic aggregation key ${key}`);
  }
});

test('slot label save keeps stored labels for payloads without the key', () => {
  const sql = read(FAZ2[5]);
  assert.match(sql, /if not \(v_meal \? 'slot_label'\) then\s+v_slot_label := v_existing_slot_label;/);
  assert.match(sql, /'slot_label', m\.slot_label/);
  assert.match(sql, /perform private\.notify_client_meal_plan_updated\(p_client_id, v_actor_id, p_week_start\);/);
  assert.match(sql, /char_length\(slot_label\) between 1 and 40/);
});

test('application e-mail RPCs are service_role only and the queue is private', () => {
  const sql = read(FAZ2[6]);
  assert.match(sql, /create table private\.application_result_emails/);
  assert.match(sql, /revoke all on function public\.claim_application_result_emails\(integer\) from public, anon, authenticated;/);
  assert.match(sql, /grant execute on function public\.claim_application_result_emails\(integer\) to service_role;/);
  assert.match(sql, /after insert on public\.dietitian_verification_audit/);
  const config = readFileSync(join(root, 'supabase', 'config.toml'), 'utf8');
  assert.match(config, /\[functions\.send-application-result-emails\]\s+verify_jwt = true/);
  const entry = readFileSync(join(root, 'supabase', 'functions', 'send-application-result-emails', 'index.ts'), 'utf8');
  assert.doesNotMatch(entry, /re_[A-Za-z0-9]{10,}/, 'no provider key committed');
  assert.match(entry, /Deno\.env\.get\('RESEND_API_KEY'\)/);
});
