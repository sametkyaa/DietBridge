'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const migration = () => read('supabase/migrations/20260826133224_product_admin_dietitian_verification.sql');
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

test('Admin predicate and RPC surface fail closed with bounded reads and controlled writes', () => {
  const source = migration();
  assert.match(source, /create or replace function public\.is_current_user_platform_admin\(\)[\s\S]*security definer[\s\S]*set search_path = pg_catalog, public/);
  assert.match(source, /join public\.profiles as profile on profile\.id = entitlement\.user_id/);
  assert.match(source, /join public\.dietitian_profiles as dietitian on dietitian\.user_id = entitlement\.user_id/);
  assert.match(source, /profile\.role = 'dietitian'::public\.user_role/);
  assert.match(source, /dietitian\.verification_status = 'approved'/);
  assert.match(source, /dietitian\.is_verified is true/);
  assert.match(source, /grant execute on function public\.is_current_user_platform_admin\(\) to authenticated/);
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
  const service = adminService();
  assert.match(app, /path="\/admin"/);
  assert.match(app, /path="\/admin\/dietitians"/);
  assert.match(app, /path="\/admin\/dietitians\/:id"/);
  assert.match(route, /usePlatformAdminAccess/);
  assert.match(route, /<Outlet \/>/);
  assert.match(route, /<Navigate to="\/login" replace state=\{\{ from \}\} \/>/);
  assert.match(route, /adminAccess\.status === 'disabled' \|\| adminAccess\.status === 'loading'/);
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
