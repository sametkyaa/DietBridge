const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const migrationPath = path.join(root, 'supabase', 'migrations', '20260830060342_dietitian_diploma_storage_hardening.sql');
const migration = () => fs.readFileSync(migrationPath, 'utf8');

const policyBlock = (source, name) => {
  const start = source.indexOf(`create policy ${name}`);
  assert.ok(start >= 0, `missing policy ${name}`);
  const nextPolicy = source.indexOf('\ncreate policy ', start + 1);
  const postflight = source.indexOf('\ndo $postflight$', start + 1);
  const endCandidates = [nextPolicy, postflight].filter((value) => value >= 0);
  const end = endCandidates.length ? Math.min(...endCandidates) : source.length;
  return source.slice(start, end);
};

test('diploma Storage migration is forward-only, drift-aware, and isolated', () => {
  const source = migration();
  assert.match(source, /^begin;\s*$/m);
  assert.match(source, /drop policy "Dietitians can upload own diplomas" on storage\.objects;/);
  assert.match(source, /drop policy "Dietitians can update own diplomas" on storage\.objects;/);
  assert.match(source, /drop policy "Dietitians can delete own diplomas" on storage\.objects;/);
  assert.match(source, /Unknown Storage object policy may reach dietitian-diplomas/);
  assert.match(source, /Dietitian diploma bucket does not match the private PDF contract/);
  assert.match(source, /file_size_limit[\s\S]*10485760/);
  assert.match(source, /array\['application\/pdf'\]::text\[\]/);
  assert.doesNotMatch(source, /create bucket|alter table storage\.buckets|update storage\.buckets/i);
  assert.doesNotMatch(source, /20260817120000|push_registry|captcha|smtp|auth\.config/i);
  assert.doesNotMatch(source, /meal-photos|avatars|chat-images/);
  assert.match(source, /Platform admins can view dietitian diplomas/);
  assert.match(source, /commit;\s*$/m);
});

test('preflight pins the reviewed legacy diploma policy inventory', () => {
  const source = migration();
  for (const policyName of [
    'Dietitians can view own diplomas',
    'Dietitians can upload own diplomas',
    'Dietitians can update own diplomas',
    'Dietitians can delete own diplomas',
    'Platform admins can view dietitian diplomas',
  ]) {
    assert.match(source, new RegExp(`policyname = '${policyName.replaceAll(' ', ' ')}'`));
  }
  assert.match(source, /roles = array\['authenticated'\]::name\[\]/);
  assert.match(source, /permissive = 'PERMISSIVE'/);
  assert.match(source, /current_user_role\(\)/);
  assert.match(source, /verification_status = 'pending'/);
  assert.match(source, /is_verified is false/);
});

test('new policies enforce one canonical pending-owner object', () => {
  const source = migration();
  const select = policyBlock(source, 'dietitian_diploma_select_own_canonical');
  const insert = policyBlock(source, 'dietitian_diploma_insert_own_pending');
  const update = policyBlock(source, 'dietitian_diploma_update_own_pending');
  const remove = policyBlock(source, 'dietitian_diploma_delete_own_pending');
  const common = [
    /bucket_id = 'dietitian-diplomas'/,
    /owner = \(select auth\.uid\(\)\)/,
    /name = format\('diplomas\/%s\/diploma\.pdf', \(select auth\.uid\(\)\)\)/,
    /\(select public\.current_user_role\(\)\) = 'dietitian'::public\.user_role/,
  ];
  for (const expression of common) {
    assert.match(select, expression);
    assert.match(insert, expression);
    assert.match(update, expression);
    assert.match(remove, expression);
  }
  assert.match(insert, /verification_status = 'pending'/);
  assert.match(insert, /is_verified is false/);
  assert.match(update, /for update[\s\S]*using \([\s\S]*verification_status = 'pending'/i);
  assert.match(update, /with check \([\s\S]*verification_status = 'pending'/i);
  assert.match(remove, /for delete[\s\S]*verification_status = 'pending'/i);
  assert.doesNotMatch(insert, /is_current_user_dietitian\(\)/);
});

test('admin signed-read policy remains read-only and canonical', () => {
  const source = migration();
  assert.match(source, /policyname = 'Platform admins can view dietitian diplomas'/);
  assert.match(source, /v_admin_policy_expression text := format\(/);
  assert.match(source, /\[0-9a-f\]\{8\}-\[0-9a-f\]\{4\}-\[1-5\]\[0-9a-f\]\{3\}-\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}\/diploma%s\.pdf\$/);
  assert.match(source, /v_policy_expression is distinct from v_admin_policy_expression/);
  assert.match(source, /name~''\^diplomas\//);
  assert.match(source, /is_current_user_platform_admin/);
  assert.match(source, /Product Admin diploma SELECT policy was removed/);
  assert.doesNotMatch(source, /create policy "Platform admins can view dietitian diplomas"[\s\S]*for (?:insert|update|delete)/i);
});

test('local disposable prerequisite bootstraps only the reviewed diploma contract', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'runDisposableSupabaseLocalReplay.mjs'), 'utf8');
  assert.match(source, /'dietitian-diplomas', 'dietitian-diplomas', false, 10485760/);
  assert.match(source, /array\['application\/pdf'\]::text\[\]/);
  assert.match(source, /create policy "Dietitians can upload own diplomas"/);
  assert.match(source, /create policy "Dietitians can update own diplomas"/);
  assert.match(source, /create policy "Dietitians can delete own diplomas"/);
});

test('all disposable replay helpers include the canonical diploma migration', () => {
  const source = fs.readFileSync(path.join(root, 'scripts', 'addCurrentIsolatedMigrations.mjs'), 'utf8');
  assert.match(source, /count !== 57/);
  assert.match(source, /return \{ canonical: 56, localPrerequisite: 1, total: count \}/);
});
