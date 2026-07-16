#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const MANIFEST_PATH = path.join(ROOT, 'supabase', 'verification', 'production_migration_history_adoption_manifest.json');

export const EXPECTED_MIGRATIONS = [
  '20260713000000_staging_default_table_privileges.sql',
  '20260713000001_production_public_baseline.sql',
  '20260713010000_function_security_hardening.sql',
  '20260713010100_verification_consistency.sql',
  '20260713010200_auth_onboarding_hardening.sql',
  '20260713010300_critical_table_rls.sql',
  '20260713010400_meal_completion_rpc.sql',
  '20260713010500_ensure_auth_user_onboarding_trigger.sql',
  '20260714010000_remove_legacy_client_meals_update_policy.sql',
];

const EXPECTED_HASHES = {
  '20260713000000_staging_default_table_privileges.sql': '38678e843c01f48218c8835f93b63a07ef91ecb98cfb93c55d0d169e378abe35',
  '20260713000001_production_public_baseline.sql': '68d99574628b599756ce604f670d9f3e51983eedbfc4fb7b18d57a444e99c698',
  '20260713010000_function_security_hardening.sql': 'f8979f0942614cf8de83974373eb22134847b2053e0dee612afecd0172b26ef4',
  '20260713010100_verification_consistency.sql': 'ed9985b473bc34fe60fbfff03720652f87a80a1d64882665c382204c5e6b85cc',
  '20260713010200_auth_onboarding_hardening.sql': 'f141578443637b8fd903bdfef533f2e9a7c12d88b7c759d4163e2f653f42e6df',
  '20260713010300_critical_table_rls.sql': 'd0d265526d60a0245bef8a7661eaa9c6bf4b90fba5b0ba0efff8a1cc90f6a72c',
  '20260713010400_meal_completion_rpc.sql': '15dd1e62db814ec9c06b7580c5a8e9e9c48b0d63327402d35ad5665ebec74eba',
  '20260713010500_ensure_auth_user_onboarding_trigger.sql': '41b21526f679f8f9150f1c972f2f188cc30cd7f37e9a51daa6c6615efd116ce4',
  '20260714010000_remove_legacy_client_meals_update_policy.sql': 'a40f47953190a83970340bd18b82c87948c9176356fbce63103c2e09dd1e52f6',
};

const ALLOWED_CLASSIFICATIONS = new Set([
  'MATCH',
  'MATCH_VIA_RECONCILIATION',
  'SUPERSEDED_MANUAL_REVIEW',
  'MISSING',
  'MISMATCH',
  'NOT_APPLICABLE',
]);

const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8').replace(/\r\n/g, '\n');
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stripComments = (value) => value.replace(/--.*$/gm, '');
const normalizeSql = (value) => value
  .toLowerCase()
  .replace(/execute\s+\$ddl\$/g, '')
  .replace(/\$ddl\$/g, '')
  .replace(/[";]/g, '')
  .replace(/\s+/g, ' ')
  .trim();

function extractDollarBody(text, marker) {
  const start = text.toLowerCase().indexOf(marker.toLowerCase());
  if (start < 0) return null;
  const asIndex = text.toLowerCase().indexOf('as ', start);
  if (asIndex < 0) return null;
  const opening = /\$[a-z_]*\$/i.exec(text.slice(asIndex));
  if (!opening) return null;
  const openingIndex = asIndex + opening.index;
  const bodyStart = openingIndex + opening[0].length;
  const bodyEnd = text.indexOf(opening[0], bodyStart);
  return bodyEnd < 0 ? null : text.slice(bodyStart, bodyEnd);
}

function extractPolicy(text, policyName) {
  const marker = `create policy "${policyName}"`;
  const start = text.toLowerCase().indexOf(marker.toLowerCase());
  if (start < 0) return null;
  const ddlEnd = text.indexOf('$ddl$;', start);
  const sqlEnd = text.indexOf(';', start);
  const end = ddlEnd >= 0 && (sqlEnd < 0 || ddlEnd < sqlEnd) ? ddlEnd + '$ddl$;'.length : sqlEnd + 1;
  return end > start ? normalizeSql(text.slice(start, end)) : null;
}

function count(text, pattern) {
  return text.match(pattern)?.length ?? 0;
}

function sameFunctionBody(migration, migrationMarker, reconciliation, reconciliationMarker) {
  const left = extractDollarBody(migration, migrationMarker);
  const right = extractDollarBody(reconciliation, reconciliationMarker);
  return left !== null && right !== null && left === right;
}

export function evaluateAdoptionPackage() {
  const failures = [];
  const check = (condition, name) => { if (!condition) failures.push(name); };
  const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  const localFiles = fs.readdirSync(MIGRATIONS_DIR).filter((name) => name.endsWith('.sql')).sort();

  check(JSON.stringify(localFiles) === JSON.stringify(EXPECTED_MIGRATIONS), 'local-migration-order');
  check(manifest.schema_version === 1, 'manifest-schema-version');
  check(manifest.bulk_repair_allowed === false, 'bulk-repair-disabled');
  check(manifest.policy_removal_version === '20260714010000', 'policy-removal-version');
  check(manifest.migrations.length === EXPECTED_MIGRATIONS.length, 'manifest-migration-count');

  for (const filename of EXPECTED_MIGRATIONS) {
    const content = fs.readFileSync(path.join(MIGRATIONS_DIR, filename));
    const entry = manifest.migrations.find((candidate) => candidate.filename === filename);
    check(sha256(content) === EXPECTED_HASHES[filename], `file-hash:${filename}`);
    check(entry?.sha256 === EXPECTED_HASHES[filename], `manifest-hash:${filename}`);
    check(entry?.version === filename.slice(0, 14), `manifest-version:${filename}`);
    check(ALLOWED_CLASSIFICATIONS.has(entry?.classification), `manifest-classification:${filename}`);
    check(entry?.manual_approval_required === true, `manual-approval:${filename}`);
    check(typeof entry?.reason === 'string' && entry.reason.length > 24, `manifest-reason:${filename}`);
  }

  const first = manifest.migrations[0];
  const pending = manifest.migrations.at(-1);
  check(first.classification === 'SUPERSEDED_MANUAL_REVIEW', 'prelude-manual-review');
  check(first.history_adoption_eligible === false, 'prelude-not-auto-eligible');
  check(!['MATCH', 'MATCH_VIA_RECONCILIATION'].includes(first.classification), 'prelude-not-automatic-match');
  check(manifest.migrations.slice(1, 8).every((entry) => entry.history_adoption_eligible === true), 'seven-adoption-candidates');
  check(pending.version === '20260714010000' && pending.classification === 'MISSING'
    && pending.history_adoption_eligible === false, 'policy-removal-remains-pending');

  const basis = manifest.production_state_basis;
  check(Object.values(basis).every((value) => value === true), 'production-state-basis');

  const baseline = read('supabase/migrations/20260713000001_production_public_baseline.sql');
  check(count(baseline, /^CREATE TYPE /gim) === 3, 'baseline-types');
  check(count(baseline, /^CREATE TABLE IF NOT EXISTS /gim) === 21, 'baseline-tables');
  check(count(baseline, /ADD CONSTRAINT /gim) === 58, 'baseline-constraints');
  check(count(baseline, /^CREATE (?:UNIQUE )?INDEX /gim) === 21, 'baseline-indexes');
  check(count(baseline, /^CREATE OR REPLACE FUNCTION /gim) === 10, 'baseline-functions');
  check(count(baseline, /^CREATE OR REPLACE TRIGGER /gim) === 7, 'baseline-triggers');
  check(count(baseline, /^CREATE POLICY /gim) === 51, 'baseline-policies');
  check(count(baseline, /^ALTER TABLE .* ENABLE ROW LEVEL SECURITY;/gim) === 18, 'baseline-rls');
  check(count(baseline, /^ALTER DEFAULT PRIVILEGES /gim) === 12, 'baseline-default-privileges');

  const prelude = read('supabase/migrations/20260713000000_staging_default_table_privileges.sql');
  check(normalizeSql(stripComments(prelude)) === normalizeSql('alter default privileges in schema public revoke all on tables from anon, authenticated'), 'prelude-contract');

  const reconciliation = read('supabase/reconciliation/production_pre_policy_removal_reconciliation.sql');
  const verification = read('supabase/migrations/20260713010100_verification_consistency.sql');
  const onboarding = read('supabase/migrations/20260713010200_auth_onboarding_hardening.sql');
  const criticalRls = read('supabase/migrations/20260713010300_critical_table_rls.sql');
  const rpc = read('supabase/migrations/20260713010400_meal_completion_rpc.sql');
  const trigger = read('supabase/migrations/20260713010500_ensure_auth_user_onboarding_trigger.sql');

  check(sameFunctionBody(
    verification,
    'create function public.sync_dietitian_verification_fields()',
    reconciliation,
    'CREATE FUNCTION public.sync_dietitian_verification_fields()',
  ), 'verification-function-equivalence');
  check(sameFunctionBody(
    onboarding,
    'create or replace function public.handle_new_user()',
    reconciliation,
    'CREATE OR REPLACE FUNCTION public.handle_new_user()',
  ), 'onboarding-function-equivalence');
  check(sameFunctionBody(
    rpc,
    'create function public.set_my_meal_completion',
    reconciliation,
    'CREATE OR REPLACE FUNCTION public.set_my_meal_completion',
  ), 'rpc-function-equivalence');

  const verificationConstraint = "check (is_verified is not distinct from (verification_status = 'approved'))";
  check(verification.toLowerCase().includes(verificationConstraint)
    && reconciliation.toLowerCase().includes(verificationConstraint), 'verification-constraint-equivalence');

  const criticalPolicies = [...criticalRls.matchAll(/create policy "([^"]+)"/gi)].map((match) => match[1]);
  check(criticalPolicies.length === 11, 'critical-policy-count');
  for (const policyName of criticalPolicies) {
    check(extractPolicy(criticalRls, policyName) === extractPolicy(reconciliation, policyName), `policy-equivalence:${policyName}`);
  }
  for (const table of ['dietitian_profiles', 'appointments', 'chat_messages']) {
    const rlsContract = `alter table public.${table} enable row level security;`;
    check(criticalRls.toLowerCase().includes(rlsContract) && reconciliation.toLowerCase().includes(rlsContract), `rls-equivalence:${table}`);
  }
  for (const marker of ['on_auth_user_created', 'public.handle_new_user()']) {
    check(trigger.toLowerCase().includes(marker) && reconciliation.toLowerCase().includes(marker), `auth-trigger-equivalence:${marker}`);
  }
  check(trigger.toLowerCase().includes('auth.users')
    && reconciliation.toLowerCase().includes("n.nspname = 'auth'")
    && reconciliation.toLowerCase().includes("c.relname = 'users'"), 'auth-trigger-equivalence:target-table');
  check(trigger.toLowerCase().includes("v_trigger.tgenabled = 'd'")
    && reconciliation.toLowerCase().includes("t.tgenabled <> 'd'"), 'auth-trigger-equivalence:enabled-state');

  check(!/\b(?:insert\s+into|update|delete\s+from|truncate)\s+(?:table\s+)?supabase_migrations\./i.test(reconciliation), 'reconciliation-preserves-history');
  check(!/drop\s+policy\s+"clients can update own meal completion"/i.test(reconciliation), 'reconciliation-preserves-legacy-policy');
  check(reconciliation.includes("nspname = 'supabase_migrations'")
    && reconciliation.includes("polname = 'Clients can update own meal completion'"), 'reconciliation-preconditions');

  const policyRemoval = stripComments(read('supabase/migrations/20260714010000_remove_legacy_client_meals_update_policy.sql'));
  check(count(policyRemoval, /\bdrop\s+policy\b/gi) === 1, 'single-policy-drop');
  check(/drop\s+policy\s+"Clients can update own meal completion"\s+on\s+public\.meals\s*;/i.test(policyRemoval), 'exact-policy-drop');
  check(!/\b(?:alter\s+table|create\s+(?:table|function|policy)|insert\s+into|update\s+public\.|delete\s+from|truncate)\b/i.test(policyRemoval), 'policy-removal-isolated');

  const plan = read('docs/PRODUCTION_MIGRATION_HISTORY_RECONCILIATION_PLAN.md');
  const runbook = read('docs/PRODUCTION_MIGRATION_HISTORY_ADOPTION_RUNBOOK.md');
  const legacyReport = read('docs/LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_PREFLIGHT_REPORT.md');
  const packageReport = read('docs/PRODUCTION_PRE_POLICY_RECONCILIATION_PACKAGE_REPORT.md');
  const roadmap = read('docs/ROADMAP.md');
  const combinedDocs = [plan, runbook, legacyReport, packageReport, roadmap].join('\n');

  for (const version of EXPECTED_MIGRATIONS.slice(0, 8).map((name) => name.slice(0, 14))) {
    check(plan.includes(version) && runbook.includes(version), `version-documented:${version}`);
  }
  for (const phrase of [
    'Production reconciliation: APPLIED SUCCESSFULLY',
    'RPC production smoke tests: PASSED',
    'Physical Android production smoke: PASSED',
    'Fixture cleanup: PASSED',
    'Remaining fixture records: 0',
    'Legacy policy: STILL PRESENT',
    'Migration history adoption: BLOCKER',
  ]) check(combinedDocs.includes(phrase), `current-state:${phrase}`);

  check(runbook.includes('AUTOMATIC_BULK_REPAIR_ALLOWED=NO'), 'runbook-bulk-repair-blocked');
  check(runbook.includes('exactly one pending migration: 20260714010000'), 'single-pending-condition');
  check(!/sql editor[\s\S]{0,100}drop policy/i.test(runbook), 'no-direct-sql-policy-removal');

  const localMigrationChainValid = failures.filter((failure) =>
    failure.startsWith('local-') || failure.startsWith('file-hash:') || failure.startsWith('manifest-hash:')
    || failure.startsWith('baseline-') || failure.startsWith('prelude-contract') || failure.startsWith('single-policy')
    || failure.startsWith('exact-policy') || failure.startsWith('policy-removal-isolated')).length === 0;
  const reconciliationEquivalenceValid = failures.filter((failure) =>
    failure.includes('equivalence') || failure.startsWith('reconciliation-') || failure.startsWith('auth-trigger-')).length === 0;
  const historyAdoptionPlanComplete = failures.filter((failure) =>
    failure.startsWith('manifest-') || failure.startsWith('manual-') || failure.startsWith('prelude-')
    || failure.startsWith('seven-') || failure.startsWith('policy-removal-remains') || failure.startsWith('production-state')
    || failure.startsWith('version-documented') || failure.startsWith('current-state') || failure.startsWith('runbook-')
    || failure.startsWith('single-pending') || failure.startsWith('no-direct')).length === 0;
  const policyRemovalMigrationReadyAfterAdoption = localMigrationChainValid
    && reconciliationEquivalenceValid
    && historyAdoptionPlanComplete
    && basis.rpc_smoke_passed && basis.mobile_smoke_passed && basis.fixture_cleanup_passed
    && basis.legacy_policy_present && basis.remote_history_empty;

  return {
    gates: {
      LOCAL_MIGRATION_CHAIN_VALID: localMigrationChainValid,
      RECONCILIATION_EQUIVALENCE_VALID: reconciliationEquivalenceValid,
      HISTORY_ADOPTION_PLAN_COMPLETE: historyAdoptionPlanComplete,
      AUTOMATIC_BULK_REPAIR_ALLOWED: false,
      POLICY_REMOVAL_MIGRATION_READY_AFTER_ADOPTION: policyRemovalMigrationReadyAfterAdoption,
    },
    failures,
  };
}

function printGates(gates) {
  for (const [name, value] of Object.entries(gates)) console.log(`${name}=${value ? 'YES' : 'NO'}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = evaluateAdoptionPackage();
  printGates(result.gates);
  if (result.failures.length > 0) process.exitCode = 1;
}
