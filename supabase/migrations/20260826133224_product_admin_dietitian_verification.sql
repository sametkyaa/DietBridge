-- MVP-13 Product Admin / dietitian verification console.
-- Additive and independent of all deferred delivery work.

begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('auth.users') is null
     or to_regclass('storage.objects') is null
     or to_regclass('storage.buckets') is null then
    raise exception 'Product Admin prerequisites are missing.';
  end if;

  if to_regclass('public.platform_admins') is not null
     or to_regclass('public.dietitian_verification_audit') is not null
     or to_regprocedure('public.is_current_user_platform_admin()') is not null then
    raise exception 'Product Admin objects already exist; inspect schema drift before applying this migration.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dietitian_profiles'
      and column_name = 'verification_status'
      and data_type = 'text'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dietitian_profiles'
      and column_name = 'is_verified'
      and data_type = 'boolean'
  ) then
    raise exception 'Canonical dietitian verification columns are missing.';
  end if;

  -- Local disposable replays may create the bucket after schema replay. If a
  -- bucket already exists, never silently accept Production contract drift.
  if exists (
    select 1
    from storage.buckets
    where id = 'dietitian-diplomas'
  )
  and not exists (
    select 1
    from storage.buckets
    where id = 'dietitian-diplomas'
      and name = 'dietitian-diplomas'
      and public is false
      and file_size_limit = 10485760
      and allowed_mime_types = array['application/pdf']::text[]
  ) then
    raise exception 'Dietitian diploma bucket does not match the private PDF contract.';
  end if;
end
$preflight$;

create table public.platform_admins (
  user_id uuid primary key
    references auth.users(id)
    on delete cascade,
  granted_at timestamptz not null default now(),
  granted_by uuid null
    references auth.users(id)
    on delete set null,
  revoked_at timestamptz null,
  revoked_by uuid null
    references auth.users(id)
    on delete set null,
  constraint platform_admins_revoked_by_check
    check (revoked_at is null or revoked_at >= granted_at)
);

comment on table public.platform_admins is
  'Controlled Product Admin entitlement. No browser self-grant or direct client table access.';

comment on column public.platform_admins.revoked_at is
  'A non-null value makes the entitlement inactive without deleting its grant history.';

alter table public.platform_admins enable row level security;
revoke all privileges on table public.platform_admins from public, anon, authenticated;

create table public.dietitian_verification_audit (
  id uuid primary key default gen_random_uuid(),
  subject_user_id uuid null
    references auth.users(id)
    on delete set null,
  subject_user_id_snapshot uuid not null,
  previous_status text not null,
  new_status text not null,
  rejection_reason text null,
  decided_by uuid null
    references auth.users(id)
    on delete set null,
  decided_by_snapshot uuid not null,
  decided_at timestamptz not null default now(),
  constraint dietitian_verification_audit_previous_status_check
    check (previous_status = 'pending'),
  constraint dietitian_verification_audit_new_status_check
    check (new_status in ('approved', 'rejected')),
  constraint dietitian_verification_audit_reason_check
    check (
      (new_status = 'approved' and rejection_reason is null)
      or (
        new_status = 'rejected'
        and rejection_reason is not null
        and char_length(btrim(rejection_reason)) between 1 and 1000
      )
    )
);

comment on table public.dietitian_verification_audit is
  'Append-only Product Admin decision history. Live Auth references may be nulled on account deletion; immutable UUID snapshots retain accountability.';

comment on column public.dietitian_verification_audit.subject_user_id_snapshot is
  'Immutable opaque subject identity captured at decision time; intentionally has no Auth FK.';

comment on column public.dietitian_verification_audit.decided_by_snapshot is
  'Immutable opaque actor identity captured at decision time; intentionally has no Auth FK.';

alter table public.dietitian_verification_audit enable row level security;
revoke all privileges on table public.dietitian_verification_audit from public, anon, authenticated;

create unique index dietitian_verification_audit_subject_new_status_unique
  on public.dietitian_verification_audit (subject_user_id_snapshot, new_status);

create index dietitian_verification_audit_subject_decided_at_idx
  on public.dietitian_verification_audit (subject_user_id_snapshot, decided_at, id);

create or replace function public.prevent_dietitian_verification_audit_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  if tg_op = 'UPDATE'
     and new.id is not distinct from old.id
     and new.subject_user_id_snapshot is not distinct from old.subject_user_id_snapshot
     and new.previous_status is not distinct from old.previous_status
     and new.new_status is not distinct from old.new_status
     and new.rejection_reason is not distinct from old.rejection_reason
     and new.decided_by_snapshot is not distinct from old.decided_by_snapshot
     and new.decided_at is not distinct from old.decided_at
     and (old.subject_user_id is not null and new.subject_user_id is null
       or new.subject_user_id is not distinct from old.subject_user_id)
     and (old.decided_by is not null and new.decided_by is null
       or new.decided_by is not distinct from old.decided_by)
     and (
       old.subject_user_id is not null and new.subject_user_id is null
       or old.decided_by is not null and new.decided_by is null
     ) then
    -- The live Auth references use ON DELETE SET NULL. These two nullable
    -- columns may be cleared by referential actions; every decision field
    -- remains immutable and all other updates are rejected below.
    return new;
  end if;

  raise exception 'Diyetisyen doğrulama geçmişi değiştirilemez.' using errcode = '42501';
end;
$function$;

alter function public.prevent_dietitian_verification_audit_mutation() owner to postgres;
revoke all on function public.prevent_dietitian_verification_audit_mutation() from public, anon, authenticated, service_role;

create trigger trg_prevent_dietitian_verification_audit_mutation
before update or delete on public.dietitian_verification_audit
for each row execute function public.prevent_dietitian_verification_audit_mutation();

create schema if not exists private authorization postgres;

create or replace function private.calculate_dietitian_application_completeness(p_user_id uuid)
returns table (
  is_complete boolean,
  missing_fields text[],
  diploma_object_path text
)
language sql
stable
set search_path = pg_catalog, public, storage
as $function$
with application as (
  select
    p.id,
    p.email,
    p.full_name,
    dp.phone,
    dp.university,
    dp.graduation_year,
    dp.experience_years,
    dp.specialization,
    dp.bio,
    dp.diploma_url,
    coalesce(
      dp.diploma_url = format('diplomas/%s/diploma.pdf', p_user_id)
      and exists (
        select 1
        from storage.objects as object_row
        where object_row.bucket_id = 'dietitian-diplomas'
          and object_row.name = format('diplomas/%s/diploma.pdf', p_user_id)
          and object_row.name ~ '^diplomas/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/diploma\.pdf$'
      ),
      false
    ) as has_diploma
  from public.profiles as p
  join public.dietitian_profiles as dp on dp.user_id = p.id
  where p.id = p_user_id
    and p.role = 'dietitian'::public.user_role
),
missing as (
  select
    array_remove(
      array[
        case when nullif(btrim(full_name), '') is null then 'full_name'::text end,
        case when nullif(btrim(email), '') is null then 'email'::text end,
        case when nullif(btrim(phone), '') is null then 'phone'::text end,
        case when nullif(btrim(university), '') is null then 'university'::text end,
        case
          when graduation_year is null
            or graduation_year < 1950
            or graduation_year > extract(year from current_date)::integer
          then 'graduation_year'::text
        end,
        case when experience_years is null or experience_years < 0 then 'experience_years'::text end,
        case when nullif(btrim(specialization), '') is null then 'specialization'::text end,
        case when nullif(btrim(bio), '') is null then 'bio'::text end,
        case when has_diploma is not true then 'diploma'::text end
      ],
      null::text
    ) as missing_fields,
    diploma_url,
    has_diploma
  from application
)
select
  cardinality(missing_fields) = 0,
  missing_fields,
  case when has_diploma is true then diploma_url else null end
from missing
$function$;

alter function private.calculate_dietitian_application_completeness(uuid) owner to postgres;
revoke all on function private.calculate_dietitian_application_completeness(uuid) from public, anon, authenticated, service_role;

create or replace function public.is_current_user_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.platform_admins as entitlement
    join public.profiles as profile on profile.id = entitlement.user_id
    join public.dietitian_profiles as dietitian on dietitian.user_id = entitlement.user_id
    where entitlement.user_id = (select auth.uid())
      and entitlement.revoked_at is null
      and profile.role = 'dietitian'::public.user_role
      and dietitian.verification_status = 'approved'
      and dietitian.is_verified is true
  );
$function$;

alter function public.is_current_user_platform_admin() owner to postgres;
revoke all on function public.is_current_user_platform_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_current_user_platform_admin() to authenticated;

create or replace function public.admin_get_verification_summary()
returns table (
  pending bigint,
  approved bigint,
  rejected bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not (select public.is_current_user_platform_admin()) then
    raise exception 'Yönetim erişimi gerekli.' using errcode = '42501';
  end if;

  return query
  select
    count(*) filter (where dp.verification_status = 'pending')::bigint,
    count(*) filter (where dp.verification_status = 'approved')::bigint,
    count(*) filter (where dp.verification_status = 'rejected')::bigint
  from public.dietitian_profiles as dp
  join public.profiles as p on p.id = dp.user_id
  where p.role = 'dietitian'::public.user_role;
end;
$function$;

create or replace function public.admin_list_dietitian_applications(
  p_status text default null,
  p_search text default null,
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  user_id uuid,
  full_name text,
  email text,
  created_at timestamptz,
  university text,
  specialization text,
  experience_years integer,
  verification_status text,
  completeness_state text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text := lower(nullif(btrim(p_status), ''));
  v_search text := nullif(btrim(p_search), '');
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset integer := least(greatest(coalesce(p_offset, 0), 0), 100000);
begin
  if not (select public.is_current_user_platform_admin()) then
    raise exception 'Yönetim erişimi gerekli.' using errcode = '42501';
  end if;

  if v_status is not null and v_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Geçersiz doğrulama filtresi.' using errcode = '22023';
  end if;

  if v_search is not null and char_length(v_search) > 120 then
    raise exception 'Arama metni çok uzun.' using errcode = '22023';
  end if;

  -- This is a value-bound expression; no dynamic SQL or identifier interpolation is used.
  return query
  select
    dp.user_id,
    p.full_name,
    p.email,
    dp.created_at,
    dp.university,
    dp.specialization,
    dp.experience_years,
    dp.verification_status,
    case when completeness.is_complete then 'complete' else 'incomplete' end
  from public.dietitian_profiles as dp
  join public.profiles as p on p.id = dp.user_id
  cross join lateral private.calculate_dietitian_application_completeness(dp.user_id) as completeness
  where p.role = 'dietitian'::public.user_role
    and (v_status is null or dp.verification_status = v_status)
    and (
      v_search is null
      or p.full_name ilike '%' || v_search || '%'
      or p.email ilike '%' || v_search || '%'
      or dp.university ilike '%' || v_search || '%'
      or dp.specialization ilike '%' || v_search || '%'
    )
  order by dp.created_at desc nulls last, dp.user_id
  limit v_limit
  offset v_offset;
end;
$function$;

create or replace function public.admin_get_dietitian_application(p_user_id uuid)
returns table (
  user_id uuid,
  full_name text,
  email text,
  phone text,
  university text,
  graduation_year integer,
  experience_years integer,
  specialization text,
  bio text,
  verification_status text,
  is_verified boolean,
  verified_at timestamptz,
  rejection_reason text,
  created_at timestamptz,
  completeness_state text,
  missing_fields text[],
  diploma_object_path text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not (select public.is_current_user_platform_admin()) then
    raise exception 'Yönetim erişimi gerekli.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Diyetisyen kimliği gerekli.' using errcode = '22023';
  end if;

  return query
  select
    dp.user_id,
    p.full_name,
    p.email,
    dp.phone,
    dp.university,
    dp.graduation_year,
    dp.experience_years,
    dp.specialization,
    dp.bio,
    dp.verification_status,
    dp.is_verified,
    dp.verified_at,
    dp.rejection_reason,
    dp.created_at,
    case when completeness.is_complete then 'complete' else 'incomplete' end,
    completeness.missing_fields,
    completeness.diploma_object_path
  from public.dietitian_profiles as dp
  join public.profiles as p on p.id = dp.user_id
  cross join lateral private.calculate_dietitian_application_completeness(dp.user_id) as completeness
  where dp.user_id = p_user_id
    and p.role = 'dietitian'::public.user_role;
end;
$function$;

create or replace function public.admin_get_dietitian_verification_history(p_user_id uuid)
returns table (
  id uuid,
  previous_status text,
  new_status text,
  rejection_reason text,
  decided_by_snapshot uuid,
  decided_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if not (select public.is_current_user_platform_admin()) then
    raise exception 'Yönetim erişimi gerekli.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Diyetisyen kimliği gerekli.' using errcode = '22023';
  end if;

  return query
  select
    audit.id,
    audit.previous_status,
    audit.new_status,
    audit.rejection_reason,
    audit.decided_by_snapshot,
    audit.decided_at
  from public.dietitian_verification_audit as audit
  where audit.subject_user_id_snapshot = p_user_id
  order by audit.decided_at, audit.id;
end;
$function$;

create or replace function public.admin_approve_dietitian(p_user_id uuid)
returns table (
  user_id uuid,
  verification_status text,
  is_verified boolean,
  verified_at timestamptz,
  rejection_reason text,
  audit_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_now timestamptz := now();
  v_target public.dietitian_profiles%rowtype;
  v_updated public.dietitian_profiles%rowtype;
  v_completeness record;
  v_existing_audit uuid;
begin
  if not (select public.is_current_user_platform_admin()) or v_actor_id is null then
    raise exception 'Yönetim erişimi gerekli.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Diyetisyen kimliği gerekli.' using errcode = '22023';
  end if;

  select dp.*
    into v_target
    from public.dietitian_profiles as dp
    join public.profiles as p on p.id = dp.user_id
   where dp.user_id = p_user_id
     and p.role = 'dietitian'::public.user_role
   for update;

  if not found then
    raise exception 'Diyetisyen başvurusu bulunamadı.' using errcode = 'P0002';
  end if;

  if v_target.verification_status = 'approved'
     and v_target.is_verified is true then
    select audit.id
      into v_existing_audit
      from public.dietitian_verification_audit as audit
     where audit.subject_user_id_snapshot = p_user_id
       and audit.new_status = 'approved'
     order by audit.decided_at desc, audit.id desc
     limit 1;

    return query
    select
      v_target.user_id,
      v_target.verification_status,
      v_target.is_verified,
      v_target.verified_at,
      v_target.rejection_reason,
      v_existing_audit;
    return;
  end if;

  if v_target.verification_status = 'rejected' then
    raise exception 'Reddedilmiş başvuru MVP kapsamında yeniden onaylanamaz.' using errcode = 'P0001';
  end if;

  if v_target.verification_status is distinct from 'pending'
     or v_target.is_verified is distinct from false then
    raise exception 'Başvurunun doğrulama durumu geçersiz veya değişti.' using errcode = 'P0001';
  end if;

  select *
    into v_completeness
    from private.calculate_dietitian_application_completeness(p_user_id);

  if not found or v_completeness.is_complete is not true then
    raise exception 'Başvuru bilgileri veya diploma tamamlanmamış.' using errcode = '23514';
  end if;

  if not (select public.is_current_user_platform_admin()) then
    raise exception 'Yönetim erişimi gerekli.' using errcode = '42501';
  end if;

  update public.dietitian_profiles as dp
     set verification_status = 'approved',
         verified_at = v_now,
         rejection_reason = null
   where dp.user_id = p_user_id
     and dp.verification_status = 'pending'
     and dp.is_verified is false
  returning dp.* into v_updated;

  if not found then
    raise exception 'Başvuru kararı uygulanamadı; durum değişti.' using errcode = 'P0001';
  end if;

  if v_updated.is_verified is not true then
    raise exception 'Doğrulama alanları tutarlı güncellenemedi.' using errcode = '23514';
  end if;

  insert into public.dietitian_verification_audit (
    subject_user_id,
    subject_user_id_snapshot,
    previous_status,
    new_status,
    rejection_reason,
    decided_by,
    decided_by_snapshot,
    decided_at
  )
  values (
    p_user_id,
    p_user_id,
    'pending',
    'approved',
    null,
    v_actor_id,
    v_actor_id,
    v_now
  )
  returning id into v_existing_audit;

  return query
  select
    v_updated.user_id,
    v_updated.verification_status,
    v_updated.is_verified,
    v_updated.verified_at,
    v_updated.rejection_reason,
    v_existing_audit;
end;
$function$;

create or replace function public.admin_reject_dietitian(
  p_user_id uuid,
  p_reason text
)
returns table (
  user_id uuid,
  verification_status text,
  is_verified boolean,
  verified_at timestamptz,
  rejection_reason text,
  audit_id uuid
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_now timestamptz := now();
  v_target public.dietitian_profiles%rowtype;
  v_updated public.dietitian_profiles%rowtype;
  v_existing_audit uuid;
begin
  if not (select public.is_current_user_platform_admin()) or v_actor_id is null then
    raise exception 'Yönetim erişimi gerekli.' using errcode = '42501';
  end if;

  if p_user_id is null then
    raise exception 'Diyetisyen kimliği gerekli.' using errcode = '22023';
  end if;

  if v_reason is null then
    raise exception 'Ret nedeni zorunludur.' using errcode = '22023';
  end if;

  if char_length(v_reason) > 1000 then
    raise exception 'Ret nedeni 1000 karakteri aşamaz.' using errcode = '22023';
  end if;

  select dp.*
    into v_target
    from public.dietitian_profiles as dp
    join public.profiles as p on p.id = dp.user_id
   where dp.user_id = p_user_id
     and p.role = 'dietitian'::public.user_role
   for update;

  if not found then
    raise exception 'Diyetisyen başvurusu bulunamadı.' using errcode = 'P0002';
  end if;

  if v_target.verification_status = 'rejected'
     and v_target.is_verified is false then
    select audit.id
      into v_existing_audit
      from public.dietitian_verification_audit as audit
     where audit.subject_user_id_snapshot = p_user_id
       and audit.new_status = 'rejected'
     order by audit.decided_at desc, audit.id desc
     limit 1;

    return query
    select
      v_target.user_id,
      v_target.verification_status,
      v_target.is_verified,
      v_target.verified_at,
      v_target.rejection_reason,
      v_existing_audit;
    return;
  end if;

  if v_target.verification_status = 'approved' then
    raise exception 'Onaylanmış başvuru MVP kapsamında reddedilemez.' using errcode = 'P0001';
  end if;

  if v_target.verification_status is distinct from 'pending'
     or v_target.is_verified is distinct from false then
    raise exception 'Başvurunun doğrulama durumu geçersiz veya değişti.' using errcode = 'P0001';
  end if;

  if not (select public.is_current_user_platform_admin()) then
    raise exception 'Yönetim erişimi gerekli.' using errcode = '42501';
  end if;

  -- A pending -> rejected decision has never granted access; verified_at stays NULL.
  update public.dietitian_profiles as dp
     set verification_status = 'rejected',
         verified_at = null,
         rejection_reason = v_reason
   where dp.user_id = p_user_id
     and dp.verification_status = 'pending'
     and dp.is_verified is false
  returning dp.* into v_updated;

  if not found then
    raise exception 'Başvuru kararı uygulanamadı; durum değişti.' using errcode = 'P0001';
  end if;

  if v_updated.is_verified is not false then
    raise exception 'Doğrulama alanları tutarlı güncellenemedi.' using errcode = '23514';
  end if;

  insert into public.dietitian_verification_audit (
    subject_user_id,
    subject_user_id_snapshot,
    previous_status,
    new_status,
    rejection_reason,
    decided_by,
    decided_by_snapshot,
    decided_at
  )
  values (
    p_user_id,
    p_user_id,
    'pending',
    'rejected',
    v_reason,
    v_actor_id,
    v_actor_id,
    v_now
  )
  returning id into v_existing_audit;

  return query
  select
    v_updated.user_id,
    v_updated.verification_status,
    v_updated.is_verified,
    v_updated.verified_at,
    v_updated.rejection_reason,
    v_existing_audit;
end;
$function$;

alter function public.admin_get_verification_summary() owner to postgres;
alter function public.admin_list_dietitian_applications(text, text, integer, integer) owner to postgres;
alter function public.admin_get_dietitian_application(uuid) owner to postgres;
alter function public.admin_get_dietitian_verification_history(uuid) owner to postgres;
alter function public.admin_approve_dietitian(uuid) owner to postgres;
alter function public.admin_reject_dietitian(uuid, text) owner to postgres;

revoke all on function public.admin_get_verification_summary() from public, anon, authenticated, service_role;
revoke all on function public.admin_list_dietitian_applications(text, text, integer, integer) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_dietitian_application(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_get_dietitian_verification_history(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_approve_dietitian(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_reject_dietitian(uuid, text) from public, anon, authenticated, service_role;

grant execute on function public.admin_get_verification_summary() to authenticated;
grant execute on function public.admin_list_dietitian_applications(text, text, integer, integer) to authenticated;
grant execute on function public.admin_get_dietitian_application(uuid) to authenticated;
grant execute on function public.admin_get_dietitian_verification_history(uuid) to authenticated;
grant execute on function public.admin_approve_dietitian(uuid) to authenticated;
grant execute on function public.admin_reject_dietitian(uuid, text) to authenticated;

do $storage_policy_preflight$
begin
  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Platform admins can view dietitian diplomas'
  ) then
    raise exception 'Product Admin diploma Storage policy already exists; inspect schema drift.';
  end if;
end
$storage_policy_preflight$;

create policy "Platform admins can view dietitian diplomas"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'dietitian-diplomas'
  and name ~ '^diplomas/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/diploma\.pdf$'
  and (select public.is_current_user_platform_admin())
);

do $postflight$
begin
  if not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.platform_admins'::regclass
      and relrowsecurity
  )
  or not exists (
    select 1
    from pg_catalog.pg_class
    where oid = 'public.dietitian_verification_audit'::regclass
      and relrowsecurity
  ) then
    raise exception 'Product Admin RLS postcondition failed.';
  end if;

  if has_table_privilege('anon', 'public.platform_admins', 'SELECT')
     or has_table_privilege('authenticated', 'public.platform_admins', 'SELECT')
     or has_table_privilege('anon', 'public.platform_admins', 'INSERT')
     or has_table_privilege('authenticated', 'public.platform_admins', 'INSERT')
     or has_table_privilege('anon', 'public.platform_admins', 'UPDATE')
     or has_table_privilege('authenticated', 'public.platform_admins', 'UPDATE')
     or has_table_privilege('anon', 'public.platform_admins', 'DELETE')
     or has_table_privilege('authenticated', 'public.platform_admins', 'DELETE')
     or has_table_privilege('anon', 'public.dietitian_verification_audit', 'SELECT')
     or has_table_privilege('authenticated', 'public.dietitian_verification_audit', 'SELECT')
     or has_table_privilege('anon', 'public.dietitian_verification_audit', 'INSERT')
     or has_table_privilege('authenticated', 'public.dietitian_verification_audit', 'INSERT')
     or has_table_privilege('anon', 'public.dietitian_verification_audit', 'UPDATE')
     or has_table_privilege('authenticated', 'public.dietitian_verification_audit', 'UPDATE')
     or has_table_privilege('anon', 'public.dietitian_verification_audit', 'DELETE')
     or has_table_privilege('authenticated', 'public.dietitian_verification_audit', 'DELETE') then
    raise exception 'Product Admin private tables are directly readable.';
  end if;

  if has_function_privilege('anon', 'public.is_current_user_platform_admin()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_current_user_platform_admin()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_get_verification_summary()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.admin_get_verification_summary()', 'EXECUTE')
     or has_function_privilege('anon', 'public.admin_approve_dietitian(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.admin_approve_dietitian(uuid)', 'EXECUTE') then
    raise exception 'Product Admin function grants are not fail-closed.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Platform admins can view dietitian diplomas'
      and cmd = 'SELECT'
  ) then
    raise exception 'Product Admin diploma Storage policy is missing.';
  end if;
end
$postflight$;

commit;
