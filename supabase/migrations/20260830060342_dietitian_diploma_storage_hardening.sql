-- Dietitian diploma Storage hardening.
--
-- This migration intentionally changes only the existing private
-- dietitian-diplomas object policies.  It does not change the bucket
-- contract, Auth configuration, or any other Storage bucket.

begin;

do $preflight$
declare
  v_bucket_name text;
  v_bucket_public boolean;
  v_bucket_size bigint;
  v_bucket_mime_types text[];
  v_sorted_mime_types text[];
  v_own_policy_expression text := '((bucket_id=''dietitian-diplomas''::text)and(owner=auth.uid()))';
  v_legacy_path_expression text := '((bucket_id=''dietitian-diplomas''::text)and(owner=auth.uid())and((storage.foldername(name))[1]=''diplomas''::text)and((storage.foldername(name))[2]=(auth.uid())::text))';
  v_admin_policy_expression text := format(
    '((bucket_id=''dietitian-diplomas''::text)and(name~''^diplomas/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/diploma%s.pdf$''::text)and(selectis_current_user_platform_admin()asis_current_user_platform_admin))',
    chr(92)
  );
  v_policy_expression text;
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('storage.objects') is null
     or to_regclass('storage.buckets') is null
     or to_regprocedure('public.current_user_role()') is null then
    raise exception 'Dietitian diploma Storage prerequisites are missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'role'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dietitian_profiles'
      and column_name in ('verification_status', 'is_verified')
    group by table_schema, table_name
    having count(*) = 2
  ) then
    raise exception 'Dietitian diploma verification columns are missing.';
  end if;

  select b.name, b.public, b.file_size_limit, b.allowed_mime_types
    into v_bucket_name, v_bucket_public, v_bucket_size, v_bucket_mime_types
    from storage.buckets as b
   where b.id = 'dietitian-diplomas';

  if not found then
    raise exception 'Dietitian diploma bucket is missing; inspect schema drift before applying this migration.';
  end if;

  select array_agg(mime_type order by mime_type)
    into v_sorted_mime_types
    from unnest(v_bucket_mime_types) as mime_type;

  if v_bucket_name is distinct from 'dietitian-diplomas'
     or v_bucket_public is distinct from false
     or v_bucket_size is distinct from 10485760
     or v_sorted_mime_types is distinct from array['application/pdf']::text[] then
    raise exception 'Dietitian diploma bucket does not match the private PDF contract.';
  end if;

  -- The following four policies are the reviewed pre-hardening inventory.
  -- Any change in names, roles, commands, or expressions is schema drift;
  -- never silently replace an unknown policy set.
  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Dietitians can view own diplomas'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and cmd = 'SELECT'
      and lower(regexp_replace(replace(replace(coalesce(qual, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g')) = v_own_policy_expression
      and with_check is null
  ) then
    raise exception 'Dietitian diploma SELECT policy drift detected.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Dietitians can upload own diplomas'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and cmd = 'INSERT'
      and qual is null
      and lower(regexp_replace(replace(replace(coalesce(with_check, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g')) = v_legacy_path_expression
  ) then
    raise exception 'Dietitian diploma INSERT policy drift detected.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Dietitians can update own diplomas'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and cmd = 'UPDATE'
      and lower(regexp_replace(replace(replace(coalesce(qual, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g')) = v_own_policy_expression
      and lower(regexp_replace(replace(replace(coalesce(with_check, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g')) = v_legacy_path_expression
  ) then
    raise exception 'Dietitian diploma UPDATE policy drift detected.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Dietitians can delete own diplomas'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and cmd = 'DELETE'
      and lower(regexp_replace(replace(replace(coalesce(qual, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g')) = v_own_policy_expression
      and with_check is null
  ) then
    raise exception 'Dietitian diploma DELETE policy drift detected.';
  end if;

  -- The Product Admin signed-read policy is intentionally preserved.  Its
  -- normalized expression is pinned exactly so a broadened policy cannot
  -- silently survive this migration.
  select lower(regexp_replace(replace(replace(coalesce(qual, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g'))
    into v_policy_expression
    from pg_catalog.pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and policyname = 'Platform admins can view dietitian diplomas'
     and permissive = 'PERMISSIVE'
     and roles = array['authenticated']::name[]
     and cmd = 'SELECT'
     and with_check is null;
  if not found or v_policy_expression is distinct from v_admin_policy_expression then
    raise exception 'Product Admin diploma SELECT policy drift detected.';
  end if;

  -- Fail closed if an unknown policy could apply to this bucket.  Known
  -- unrelated policies must name one explicit, different bucket; generic
  -- object policies are not safe to carry across this boundary.
  if exists (
    select 1
    from pg_catalog.pg_policies as p
    where p.schemaname = 'storage'
      and p.tablename = 'objects'
      and p.policyname not in (
        'Dietitians can view own diplomas',
        'Dietitians can upload own diplomas',
        'Dietitians can update own diplomas',
        'Dietitians can delete own diplomas',
        'Platform admins can view dietitian diplomas'
      )
      and (
        (p.qual is null and p.with_check is null)
        or (
          lower(regexp_replace(replace(replace(coalesce(p.qual, '') || coalesce(p.with_check, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g')) !~ 'bucket_id=''[a-z0-9_-]+''::text'
          or position('dietitian-diplomas' in lower(regexp_replace(replace(replace(coalesce(p.qual, '') || coalesce(p.with_check, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g'))) > 0
        )
      )
  ) then
    raise exception 'Unknown Storage object policy may reach dietitian-diplomas; inspect policy drift before applying this migration.';
  end if;
end
$preflight$;

drop policy "Dietitians can view own diplomas" on storage.objects;
drop policy "Dietitians can upload own diplomas" on storage.objects;
drop policy "Dietitians can update own diplomas" on storage.objects;
drop policy "Dietitians can delete own diplomas" on storage.objects;

create policy dietitian_diploma_select_own_canonical
on storage.objects
for select
to authenticated
using (
  bucket_id = 'dietitian-diplomas'
  and owner = (select auth.uid())
  and name = format('diplomas/%s/diploma.pdf', (select auth.uid()))
  and (select public.current_user_role()) = 'dietitian'::public.user_role
);

create policy dietitian_diploma_insert_own_pending
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'dietitian-diplomas'
  and owner = (select auth.uid())
  and name = format('diplomas/%s/diploma.pdf', (select auth.uid()))
  and (select public.current_user_role()) = 'dietitian'::public.user_role
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.verification_status = 'pending'
      and dp.is_verified is false
  )
);

create policy dietitian_diploma_update_own_pending
on storage.objects
for update
to authenticated
using (
  bucket_id = 'dietitian-diplomas'
  and owner = (select auth.uid())
  and name = format('diplomas/%s/diploma.pdf', (select auth.uid()))
  and (select public.current_user_role()) = 'dietitian'::public.user_role
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.verification_status = 'pending'
      and dp.is_verified is false
  )
)
with check (
  bucket_id = 'dietitian-diplomas'
  and owner = (select auth.uid())
  and name = format('diplomas/%s/diploma.pdf', (select auth.uid()))
  and (select public.current_user_role()) = 'dietitian'::public.user_role
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.verification_status = 'pending'
      and dp.is_verified is false
  )
);

create policy dietitian_diploma_delete_own_pending
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'dietitian-diplomas'
  and owner = (select auth.uid())
  and name = format('diplomas/%s/diploma.pdf', (select auth.uid()))
  and (select public.current_user_role()) = 'dietitian'::public.user_role
  and exists (
    select 1
    from public.dietitian_profiles as dp
    where dp.user_id = (select auth.uid())
      and dp.verification_status = 'pending'
      and dp.is_verified is false
  )
);

do $postflight$
declare
  v_bucket_name text;
  v_bucket_public boolean;
  v_bucket_size bigint;
  v_bucket_mime_types text[];
  v_sorted_mime_types text[];
  v_policy_qual text;
  v_policy_check text;
  v_admin_policy_expression text := format(
    '((bucket_id=''dietitian-diplomas''::text)and(name~''^diplomas/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/diploma%s.pdf$''::text)and(selectis_current_user_platform_admin()asis_current_user_platform_admin))',
    chr(92)
  );
begin
  select b.name, b.public, b.file_size_limit, b.allowed_mime_types
    into v_bucket_name, v_bucket_public, v_bucket_size, v_bucket_mime_types
    from storage.buckets as b
   where b.id = 'dietitian-diplomas';
  select array_agg(mime_type order by mime_type)
    into v_sorted_mime_types
    from unnest(v_bucket_mime_types) as mime_type;
  if not found
     or v_bucket_name is distinct from 'dietitian-diplomas'
     or v_bucket_public is distinct from false
     or v_bucket_size is distinct from 10485760
     or v_sorted_mime_types is distinct from array['application/pdf']::text[] then
    raise exception 'Dietitian diploma bucket postcondition failed.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname in (
        'Dietitians can view own diplomas',
        'Dietitians can upload own diplomas',
        'Dietitians can update own diplomas',
        'Dietitians can delete own diplomas'
      )
  ) then
    raise exception 'Legacy dietitian diploma policies remain after replacement.';
  end if;

  select lower(regexp_replace(replace(replace(coalesce(qual, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g'))
    into v_policy_qual
    from pg_catalog.pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'dietitian_diploma_select_own_canonical'
     and permissive = 'PERMISSIVE'
     and roles = array['authenticated']::name[]
     and cmd = 'SELECT'
     and with_check is null;
  if not found
     or position('bucket_id=''dietitian-diplomas''::text' in v_policy_qual) = 0
     or position('owner=(selectauth.uid()asuid)' in v_policy_qual) = 0
     or position('name=format(''diplomas/%s/diploma.pdf''::text,(selectauth.uid()asuid))' in v_policy_qual) = 0
     or position('current_user_role' in v_policy_qual) = 0
     or position('dietitian' in v_policy_qual) = 0 then
    raise exception 'Canonical dietitian diploma SELECT postcondition failed.';
  end if;

  select lower(regexp_replace(replace(replace(coalesce(with_check, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g'))
    into v_policy_check
    from pg_catalog.pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'dietitian_diploma_insert_own_pending'
     and permissive = 'PERMISSIVE'
     and roles = array['authenticated']::name[]
     and cmd = 'INSERT'
     and qual is null;
  if not found
     or position('bucket_id=''dietitian-diplomas''::text' in v_policy_check) = 0
     or position('owner=(selectauth.uid()asuid)' in v_policy_check) = 0
     or position('name=format(''diplomas/%s/diploma.pdf''::text,(selectauth.uid()asuid))' in v_policy_check) = 0
     or position('current_user_role' in v_policy_check) = 0
     or position('dietitian' in v_policy_check) = 0
     or position('verification_status=''pending''' in v_policy_check) = 0
     or position('is_verifiedisfalse' in v_policy_check) = 0 then
    raise exception 'Canonical dietitian diploma INSERT postcondition failed.';
  end if;

  select
    lower(regexp_replace(replace(replace(coalesce(qual, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g')),
    lower(regexp_replace(replace(replace(coalesce(with_check, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g'))
    into v_policy_qual, v_policy_check
    from pg_catalog.pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'dietitian_diploma_update_own_pending'
     and permissive = 'PERMISSIVE'
     and roles = array['authenticated']::name[]
     and cmd = 'UPDATE';
  if not found
     or position('bucket_id=''dietitian-diplomas''::text' in v_policy_qual) = 0
     or position('owner=(selectauth.uid()asuid)' in v_policy_qual) = 0
     or position('name=format(''diplomas/%s/diploma.pdf''::text,(selectauth.uid()asuid))' in v_policy_qual) = 0
     or position('current_user_role' in v_policy_qual) = 0
     or position('verification_status=''pending''' in v_policy_qual) = 0
     or position('is_verifiedisfalse' in v_policy_qual) = 0
     or position('bucket_id=''dietitian-diplomas''::text' in v_policy_check) = 0
     or position('owner=(selectauth.uid()asuid)' in v_policy_check) = 0
     or position('name=format(''diplomas/%s/diploma.pdf''::text,(selectauth.uid()asuid))' in v_policy_check) = 0
     or position('current_user_role' in v_policy_check) = 0
     or position('verification_status=''pending''' in v_policy_check) = 0
     or position('is_verifiedisfalse' in v_policy_check) = 0 then
    raise exception 'Canonical dietitian diploma UPDATE postcondition failed.';
  end if;

  select lower(regexp_replace(replace(replace(coalesce(qual, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g'))
    into v_policy_qual
    from pg_catalog.pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'dietitian_diploma_delete_own_pending'
     and permissive = 'PERMISSIVE'
     and roles = array['authenticated']::name[]
     and cmd = 'DELETE'
     and with_check is null;
  if not found
     or position('bucket_id=''dietitian-diplomas''::text' in v_policy_qual) = 0
     or position('owner=(selectauth.uid()asuid)' in v_policy_qual) = 0
     or position('name=format(''diplomas/%s/diploma.pdf''::text,(selectauth.uid()asuid))' in v_policy_qual) = 0
     or position('current_user_role' in v_policy_qual) = 0
     or position('verification_status=''pending''' in v_policy_qual) = 0
     or position('is_verifiedisfalse' in v_policy_qual) = 0 then
    raise exception 'Canonical dietitian diploma DELETE postcondition failed.';
  end if;

  select lower(regexp_replace(replace(replace(coalesce(qual, ''), '"', ''), 'public.', ''), '[[:space:]]+', '', 'g'))
    into v_policy_qual
    from pg_catalog.pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and policyname = 'Platform admins can view dietitian diplomas'
     and permissive = 'PERMISSIVE'
     and roles = array['authenticated']::name[]
     and cmd = 'SELECT'
     and with_check is null;
  if not found or v_policy_qual is distinct from v_admin_policy_expression then
    raise exception 'Product Admin diploma SELECT policy was removed.';
  end if;
end
$postflight$;

commit;
