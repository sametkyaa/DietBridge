'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = () => read('supabase/migrations/20260826133224_product_admin_dietitian_verification.sql');
const standaloneMigration = () => read('supabase/migrations/20260827084741_standalone_platform_admin_access.sql');
const adminService = () => read('features/admin/services/adminService.ts');
const authService = () => read('features/auth/services/authService.ts');

test('Product Admin migration is additive, isolated from deferred Push work, and production-shaped', () => {
  const source = migration();
  assert.doesNotMatch(source, /push/i);
  assert.match(source, /create table public\.platform_admins/);
  assert.match(source, /user_id uuid primary key[\s\S]*references auth\.users\(id\)[\s\S]*on delete cascade/);
  assert.match(source, /granted_at timestamptz not null default now\(\)/);
  assert.match(source, /granted_by uuid null[\s\S]*on delete set null/);
  assert.match(source, /revoked_at timestamptz null/);
  assert.match(source, /revoked_by uuid null[\s\S]*on delete set null/);
  assert.match(source, /alter table public\.platform_admins enable row level security/);
  assert.match(source, /revoke all privileges on table public\.platform_admins from public, anon, authenticated/);
  assert.match(source, /create table public\.dietitian_verification_audit/);
  assert.match(source, /subject_user_id uuid null[\s\S]*on delete set null/);
  assert.match(source, /subject_user_id_snapshot uuid not null/);
  assert.match(source, /decided_by uuid null[\s\S]*on delete set null/);
  assert.match(source, /decided_by_snapshot uuid not null/);
  assert.match(source, /before update or delete on public\.dietitian_verification_audit/);
  assert.match(source, /create unique index dietitian_verification_audit_subject_new_status_unique/);
  assert.doesNotMatch(source, /create type[^;]+admin/i);
});

test('Standalone Admin migration is additive and makes authorization entitlement-only', () => {
  const source = standaloneMigration();
  const helperStart = source.indexOf('create or replace function public.is_current_user_platform_admin()');
  const helperEnd = source.indexOf('$function$;', helperStart);
  const helper = helperStart >= 0 && helperEnd >= 0 ? source.slice(helperStart, helperEnd) : '';
  assert.match(source, /to_regclass\('public\.platform_admins'\)/);
  assert.match(source, /to_regprocedure\('public\.admin_get_verification_summary\(\)'\)/);
  assert.match(source, /to_regprocedure\('public\.admin_list_dietitian_applications\(text,text,integer,integer\)'\)/);
  assert.match(source, /to_regprocedure\('public\.admin_get_dietitian_application\(uuid\)'\)/);
  assert.match(source, /to_regprocedure\('public\.admin_get_dietitian_verification_history\(uuid\)'\)/);
  assert.match(source, /to_regprocedure\('public\.admin_approve_dietitian\(uuid\)'\)/);
  assert.match(source, /to_regprocedure\('public\.admin_reject_dietitian\(uuid,text\)'\)/);
  assert.match(helper, /stable[\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/);
  assert.match(helper, /from public\.platform_admins as entitlement/);
  assert.match(helper, /\(select auth\.uid\(\)\) is not null/);
  assert.match(helper, /entitlement\.user_id = \(select auth\.uid\(\)\)/);
  assert.match(helper, /entitlement\.revoked_at is null/);
  assert.doesNotMatch(helper, /join public\.profiles|join public\.dietitian_profiles|verification_status|is_verified/i);
  assert.match(source, /alter function public\.is_current_user_platform_admin\(\) owner to postgres/);
  assert.match(source, /revoke all on function public\.is_current_user_platform_admin\(\) from public, anon, authenticated, service_role/);
  assert.match(source, /grant execute on function public\.is_current_user_platform_admin\(\) to authenticated/);
  assert.doesNotMatch(source, /create table|alter table|create (?:unique )?index|create trigger|create policy|insert into|update .* set|delete from/i);
  assert.doesNotMatch(source, /20260817120000|push/i);
});

test('Historical Product Admin RPC surface remains bounded and controlled', () => {
  const source = migration();
  assert.match(source, /create or replace function public\.admin_list_dietitian_applications\([\s\S]*p_limit integer default 25/);
  assert.match(source, /v_limit integer := least\(greatest\(coalesce\(p_limit, 25\), 1\), 100\)/);
  assert.match(source, /v_offset integer := least\(greatest\(coalesce\(p_offset, 0\), 0\), 100000\)/);
  assert.match(source, /create or replace function public\.admin_get_dietitian_application\(p_user_id uuid\)/);
  assert.match(source, /create or replace function public\.admin_get_dietitian_verification_history\(p_user_id uuid\)/);
  assert.match(source, /create or replace function public\.admin_approve_dietitian\(p_user_id uuid\)/);
  assert.match(source, /create or replace function public\.admin_reject_dietitian\([\s\S]*p_reason text/);
  assert.match(source, /for update/);
  assert.match(source, /verification_status = 'pending'[\s\S]*is_verified is false/);
  assert.match(source, /insert into public\.dietitian_verification_audit/);
  assert.match(source, /char_length\(v_reason\) > 1000/);
  assert.match(source, /Reddedilmiş başvuru MVP kapsamında yeniden onaylanamaz/);
  assert.match(source, /Onaylanmış başvuru MVP kapsamında reddedilemez/);
  assert.match(source, /grant execute on function public\.admin_get_verification_summary\(\) to authenticated/);
  assert.match(source, /revoke all on function public\.admin_approve_dietitian\(uuid\) from public, anon, authenticated, service_role/);
});

test('Completeness and Storage contract only expose canonical diploma access to Admin reads', () => {
  const source = migration();
  assert.match(source, /private\.calculate_dietitian_application_completeness\(p_user_id uuid\)/);
  assert.match(source, /graduation_year < 1950/);
  assert.match(source, /experience_years is null or experience_years < 0/);
  assert.match(source, /diplomas\/%s\/diploma\.pdf/);
  assert.match(source, /storage\.objects as object_row/);
  assert.match(source, /diploma_object_path text/);
  assert.match(source, /create policy "Platform admins can view dietitian diplomas"/);
  assert.match(source, /for select[\s\S]*to authenticated/);
  assert.match(source, /bucket_id = 'dietitian-diplomas'/);
  assert.match(source, /public\.is_current_user_platform_admin\(\)/);
  assert.doesNotMatch(source, /create policy "Platform admins[^\n]+"[\s\S]*for (?:insert|update|delete)/i);
});

test('Web Admin route and service preserve entitlement isolation and signed-url safety', () => {
  const app = read('App.tsx');
  const sidebar = read('shared/components/Sidebar.tsx');
  const route = read('features/admin/components/AdminRoute.tsx');
  const protectedRoute = read('shared/components/ProtectedRoute.tsx');
  const login = read('features/auth/pages/LoginPage.tsx');
  const service = adminService();
  assert.match(app, /path="\/admin"/);
  assert.match(app, /path="\/admin\/dietitians"/);
  assert.match(app, /path="\/admin\/dietitians\/:id"/);
  assert.match(route, /usePlatformAdminAccess/);
  assert.match(route, /const \{ accessState, session, signOut \} = useAuth\(\)/);
  assert.match(route, /enabled: Boolean\(session\?\.user\) && accessState\.status !== 'password_recovery'/);
  assert.match(route, /userId: session\?\.user\.id \?\? null/);
  assert.match(route, /accessState\.status === 'unauthenticated' \|\| !session\?\.user/);
  assert.doesNotMatch(route, /accessState\.status === 'allowed'/);
  assert.doesNotMatch(route, /accessState\.status !== 'allowed'/);
  assert.match(route, /<Outlet \/>/);
  assert.match(route, /<Navigate to="\/login" replace state=\{\{ from \}\} \/>/);
  assert.match(route, /<Navigate to="\/reset-password" replace \/>/);
  assert.match(route, /adminAccess\.status === 'disabled' \|\| adminAccess\.status === 'loading'/);
  assert.match(protectedRoute, /case 'allowed'/);
  assert.match(protectedRoute, /case 'blocked_missing_role'/);
  assert.match(login, /blocked_missing_role/);
  assert.match(login, /returnPath/);
  assert.match(sidebar, /label: 'Yönetim'/);
  assert.match(sidebar, /adminAccess\.status === 'authorized'/);
  assert.match(service, /ADMIN_DIPLOMA_SIGNED_URL_SECONDS = 120/);
  assert.match(service, /createSignedUrl\(objectPath, ADMIN_DIPLOMA_SIGNED_URL_SECONDS\)/);
  assert.match(service, /!isDiplomaPathForUser\(application\.userId, row\.diploma_object_path\)/);
  assert.match(service, /diplomas\\\/\[0-9a-f\]\{8\}/);
  assert.doesNotMatch(service, /SERVICE_ROLE|service_role|VITE_SUPABASE_SERVICE/);
  assert.match(read('features/admin/pages/DietitianApplicationDetailPage.tsx'), /Diplomayı Görüntüle/);
  assert.match(read('features/admin/pages/DietitianApplicationDetailPage.tsx'), /Promise\.all/);
});

test('Platform Admin entitlement state is scoped to the Auth identity and stale lookups cannot win', () => {
  const hook = read('features/admin/hooks/usePlatformAdminAccess.ts');
  const sidebar = read('shared/components/Sidebar.tsx');
  assert.match(hook, /userId: string \| null/);
  assert.match(hook, /if \(!enabled \|\| !userId\)/);
  assert.match(hook, /const \[resolvedUserId, setResolvedUserId\] = useState<string \| null>\(null\)/);
  assert.match(hook, /setResolvedUserId\(null\);[\s\S]*void checkCurrentPlatformAdmin\(\)/);
  assert.match(hook, /if \(active\) \{[\s\S]*setResolvedUserId\(userId\);[\s\S]*setState\(\{ status: isAdmin \? 'authorized' : 'denied' \}\)/);
  assert.match(hook, /\}, \[attempt, enabled, userId\]\);/);
  assert.match(hook, /return \(\) => \{\s*active = false;\s*\};/);
  assert.match(hook, /resolvedUserId === userId[\s\S]*\{ status: 'loading' \}/);
  assert.match(sidebar, /const \{ accessState, session \} = useAuth\(\)/);
  assert.match(sidebar, /userId: session\?\.user\.id \?\? null/);
});

test('Auth verification resolver accepts only the three consistent source states', () => {
  const source = authService();
  assert.match(source, /status === 'rejected'[\s\S]*isVerified === false \? 'rejected' : 'error'/);
  assert.match(source, /status === 'pending'[\s\S]*isVerified === false \? 'pending' : 'error'/);
  assert.match(source, /status === 'approved'[\s\S]*isVerified === true \? 'approved' : 'error'/);
  assert.match(source, /return 'error';/);
  assert.doesNotMatch(source, /if \(!status && isVerified === true\)/);
});

test('Admin rollout note keeps deferred Push out of the remote release artifact', () => {
  const note = read('docs/MVP13_ADMIN_MIGRATION_ROLLOUT.md');
  assert.match(note, /exact remote Production migration hashes/);
  assert.match(note, /deferred Push migration is absent/);
  assert.match(note, /one pending Product Admin migration/);
  assert.match(note, /does not run that command/);
});
