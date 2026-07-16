import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  EXPECTED_MIGRATIONS,
  evaluateAdoptionPackage,
} from './production-migration-history-adoption-validator.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
const manifest = JSON.parse(read('supabase/verification/production_migration_history_adoption_manifest.json'));
const validatorPath = path.join(root, 'scripts', 'production-migration-history-adoption-validator.mjs');
const validatorSource = read('scripts/production-migration-history-adoption-validator.mjs');
const runbook = read('docs/PRODUCTION_MIGRATION_HISTORY_ADOPTION_RUNBOOK.md');
const plan = read('docs/PRODUCTION_MIGRATION_HISTORY_RECONCILIATION_PLAN.md');
const legacyReport = read('docs/LEGACY_MEALS_UPDATE_POLICY_PRODUCTION_PREFLIGHT_REPORT.md');
const packageReport = read('docs/PRODUCTION_PRE_POLICY_RECONCILIATION_PACKAGE_REPORT.md');
const roadmap = read('docs/ROADMAP.md');

test('CHAIN-01: exact nine-file local migration order is pinned', () => {
  const actual = fs.readdirSync(path.join(root, 'supabase', 'migrations'))
    .filter((name) => name.endsWith('.sql')).sort();
  assert.deepEqual(actual, EXPECTED_MIGRATIONS);
  assert.equal(manifest.migrations.length, 9);
  assert.deepEqual(manifest.migrations.map((entry) => entry.filename), EXPECTED_MIGRATIONS);
});

test('HASH-01: every migration SHA-256 matches the adoption manifest', () => {
  for (const entry of manifest.migrations) {
    const content = fs.readFileSync(path.join(root, 'supabase', 'migrations', entry.filename));
    assert.equal(crypto.createHash('sha256').update(content).digest('hex'), entry.sha256);
    assert.match(entry.sha256, /^[0-9a-f]{64}$/);
  }
});

test('CLASS-01: all first eight versions are evaluated individually', () => {
  const firstEight = manifest.migrations.slice(0, 8);
  assert.equal(firstEight.length, 8);
  assert.equal(new Set(firstEight.map((entry) => entry.version)).size, 8);
  assert.ok(firstEight.every((entry) => entry.manual_approval_required === true));
  assert.ok(firstEight.every((entry) => plan.includes(entry.version) && runbook.includes(entry.version)));
});

test('CLASS-02: historical prelude is never an automatic MATCH or bulk-repair candidate', () => {
  const prelude = manifest.migrations[0];
  assert.equal(prelude.version, '20260713000000');
  assert.equal(prelude.classification, 'SUPERSEDED_MANUAL_REVIEW');
  assert.equal(prelude.history_adoption_eligible, false);
  assert.equal(manifest.bulk_repair_allowed, false);
  assert.ok(runbook.includes('AUTOMATIC_BULK_REPAIR_ALLOWED=NO'));
});

test('POLICY-01: policy-removal migration remains unapplied and exact', () => {
  const pending = manifest.migrations.at(-1);
  assert.equal(pending.version, '20260714010000');
  assert.equal(pending.classification, 'MISSING');
  assert.equal(pending.history_adoption_eligible, false);
  assert.equal(runbook.includes('migration repair 20260714010000'), false);

  const sql = read(`supabase/migrations/${pending.filename}`).replace(/--.*$/gm, '');
  assert.equal(sql.match(/\bdrop\s+policy\b/gi)?.length, 1);
  assert.match(sql, /drop policy "Clients can update own meal completion" on public\.meals;/i);
});

test('RUNBOOK-01: repair is version-by-version with no wildcard or multi-version command', () => {
  const repairLines = runbook.split('\n').filter((line) => /migration repair 202607/.test(line));
  assert.equal(repairLines.length, 8);
  for (const [index, line] of repairLines.entries()) {
    assert.equal(line.match(/202607\d{8}/g)?.length, 1);
    assert.ok(line.includes(EXPECTED_MIGRATIONS[index].slice(0, 14)));
    assert.ok(line.includes('--status applied --linked'));
  }
  assert.equal(repairLines.some((line) => /(?:\*|,|\.\.)/.test(line)), false);
});

test('RUNBOOK-02: db push is gated by exact one pending migration and no direct SQL policy drop', () => {
  assert.ok(runbook.includes('exactly one pending migration: 20260714010000'));
  assert.ok(runbook.includes('db push --linked --dry-run'));
  assert.ok(runbook.includes('db push --linked'));
  assert.equal(/```(?:sql)?[\s\S]*?drop\s+policy[\s\S]*?```/i.test(runbook), false);
  assert.equal(runbook.includes('--include-all'), true);
  assert.ok(runbook.includes('`--include-all` kullanılmaz'));
});

test('SAFETY-01: validator is networkless and cannot invoke Supabase CLI or database mutation', () => {
  for (const forbidden of [
    /node:child_process/,
    /\bfetch\s*\(/,
    /createClient\s*\(/,
    /https?:\/\//,
    /\bnpx\b/,
    /\bmigration\s+repair\b/,
    /\bdb\s+push\b/,
  ]) assert.equal(forbidden.test(validatorSource), false);
});

test('SAFETY-02: reconciliation preserves history and the exact legacy policy', () => {
  const reconciliation = read('supabase/reconciliation/production_pre_policy_removal_reconciliation.sql');
  assert.equal(/\b(?:insert\s+into|update|delete\s+from|truncate)\s+(?:table\s+)?supabase_migrations\./i.test(reconciliation), false);
  assert.equal(/drop\s+policy\s+"Clients can update own meal completion"/i.test(reconciliation), false);
  assert.ok(reconciliation.includes("nspname = 'supabase_migrations'"));
  assert.ok(reconciliation.includes("polname = 'Clients can update own meal completion'"));
});

test('STATE-01: updated documents record the authoritative production state', () => {
  const combined = [plan, runbook, legacyReport, packageReport, roadmap].join('\n');
  for (const phrase of [
    'Production reconciliation: APPLIED SUCCESSFULLY',
    'RPC production smoke tests: PASSED',
    'Physical Android production smoke: PASSED',
    'Fixture cleanup: PASSED',
    'Remaining fixture records: 0',
    'Legacy policy: STILL PRESENT',
    'Migration history adoption: BLOCKER',
  ]) assert.ok(combined.includes(phrase), `Missing current-state phrase: ${phrase}`);
});

test('GATE-01: validator emits only the five requested gates', () => {
  const result = spawnSync(process.execPath, [validatorPath], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.deepEqual(result.stdout.trim().split(/\r?\n/), [
    'LOCAL_MIGRATION_CHAIN_VALID=YES',
    'RECONCILIATION_EQUIVALENCE_VALID=YES',
    'HISTORY_ADOPTION_PLAN_COMPLETE=YES',
    'AUTOMATIC_BULK_REPAIR_ALLOWED=NO',
    'POLICY_REMOVAL_MIGRATION_READY_AFTER_ADOPTION=YES',
  ]);
});

test('GATE-02: pure evaluation has no hidden blocker', () => {
  const result = evaluateAdoptionPackage();
  assert.deepEqual(result.failures, []);
  assert.deepEqual(result.gates, {
    LOCAL_MIGRATION_CHAIN_VALID: true,
    RECONCILIATION_EQUIVALENCE_VALID: true,
    HISTORY_ADOPTION_PLAN_COMPLETE: true,
    AUTOMATIC_BULK_REPAIR_ALLOWED: false,
    POLICY_REMOVAL_MIGRATION_READY_AFTER_ADOPTION: true,
  });
});
