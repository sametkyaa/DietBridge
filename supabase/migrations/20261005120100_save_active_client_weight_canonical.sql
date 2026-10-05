-- Faz 0: canonical save_active_client_weight RPC.
--
-- The Web client (features/clients/services/clientService.ts saveClientWeight)
-- calls public.save_active_client_weight(p_client_id, p_measured_at, p_weight,
-- p_notes) and expects exactly one public.measurements row back. The function
-- previously existed only in the archived staging-only chain
-- (supabase/migration_archive/staging_legacy_not_for_production/
-- 20260718115944_separate_measurement_patch_contract.sql), so a canonical
-- replay had no definition for it.
--
-- Contract kept from the archived definition:
--   * same argument names, types and defaults; returns public.measurements;
--   * patches only weight and an optional note on the (client_id, measured_at)
--     daily row, never touching circumference columns;
--   * the authorization join is copied from the canonical sibling
--     public.save_active_client_body_measurements_v2 (20260801090000).
-- Changes:
--   * "today" and "future" are evaluated on the Europe/Istanbul calendar date,
--     matching the browser-local date the Web form sends;
--   * the function runs with TimeZone = Europe/Istanbul so the existing
--     client_profiles -> measurements weight sync trigger (which uses
--     current_date) writes the same Istanbul day instead of the UTC day;
--   * execute is revoked from public, anon and authenticated and granted only
--     to authenticated.
--
-- create or replace keeps this safe where the function already exists with the
-- same signature. The preflight refuses to run if any other overload exists,
-- or if the existing same-signature function returns a different type, so the
-- migration never creates an ambiguous PostgREST overload.
begin;

do $preflight$
declare
  v_other_signatures text;
  v_existing_return_type regtype;
begin
  if to_regclass('public.measurements') is null
     or to_regclass('public.measurements_client_date_unique') is null
     or to_regclass('public.client_profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.dietitian_clients') is null then
    raise exception 'Expected measurement contract is missing; migration stopped.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n
      on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'measurements'
      and c.relrowsecurity is true
  ) then
    raise exception 'RLS must remain enabled on public.measurements.';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and (
        (table_name = 'measurements' and column_name in ('client_id', 'measured_at', 'weight', 'notes', 'updated_at'))
        or (table_name = 'client_profiles' and column_name in ('user_id', 'current_weight'))
        or (table_name = 'dietitian_profiles' and column_name in ('user_id', 'verification_status', 'is_verified'))
      )
  ) <> 10 then
    raise exception 'Expected measurement, client profile or dietitian verification columns are missing; migration stopped.';
  end if;

  select pg_catalog.string_agg(p.oid::regprocedure::text, ', ')
    into v_other_signatures
  from pg_catalog.pg_proc as p
  join pg_catalog.pg_namespace as n
    on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname = 'save_active_client_weight'
    and pg_catalog.pg_get_function_identity_arguments(p.oid)
      <> 'p_client_id uuid, p_measured_at date, p_weight numeric, p_notes text';

  if v_other_signatures is not null then
    raise exception
      'Unexpected save_active_client_weight overload(s) exist: %; migration stopped to avoid an ambiguous RPC.',
      v_other_signatures;
  end if;

  select p.prorettype::regtype
    into v_existing_return_type
  from pg_catalog.pg_proc as p
  where p.oid = to_regprocedure('public.save_active_client_weight(uuid,date,numeric,text)');

  if v_existing_return_type is not null
     and v_existing_return_type <> 'public.measurements'::regtype then
    raise exception
      'Existing save_active_client_weight returns %, expected public.measurements; migration stopped.',
      v_existing_return_type;
  end if;
end
$preflight$;

create or replace function public.save_active_client_weight(
  p_client_id uuid,
  p_measured_at date,
  p_weight numeric,
  p_notes text default null
)
returns public.measurements
language plpgsql
security definer
set search_path = pg_catalog, public
set "TimeZone" = 'Europe/Istanbul'
as $$
declare
  v_actor_id uuid := auth.uid();
  v_notes text := nullif(pg_catalog.btrim(p_notes), '');
  v_today date := (pg_catalog.now() at time zone 'Europe/Istanbul')::date;
  v_measurement public.measurements%rowtype;
  v_updated_profiles integer;
begin
  if v_actor_id is null then
    raise exception 'Bu işlem için oturum açmalısınız.'
      using errcode = '42501';
  end if;

  perform 1
  from public.profiles as actor_profile
  join public.dietitian_profiles as dp
    on dp.user_id = actor_profile.id
  join public.dietitian_clients as dc
    on dc.dietitian_id = actor_profile.id
  join public.profiles as client_profile
    on client_profile.id = dc.client_id
  where actor_profile.id = v_actor_id
    and actor_profile.role = 'dietitian'::public.user_role
    and dp.verification_status = 'approved'
    and dp.is_verified is true
    and dc.client_id = p_client_id
    and dc.status = 'active'::public.client_status
    and client_profile.role = 'client'::public.user_role
  for share of actor_profile, dp, dc, client_profile;

  if not found then
    raise exception 'Aktif danışan ilişkisi bulunamadı veya bu işlem için yetkiniz yok.'
      using errcode = '42501';
  end if;

  if p_measured_at is null then
    raise exception 'Ölçüm tarihi boş bırakılamaz.'
      using errcode = '22023';
  end if;

  if p_measured_at > v_today then
    raise exception 'Ölçüm tarihi gelecekte olamaz.'
      using errcode = '22023';
  end if;

  if p_weight is null or p_weight < 20 or p_weight > 500 then
    raise exception 'Kilo değeri 20 ile 500 kg arasında olmalıdır.'
      using errcode = '22023';
  end if;

  if v_notes is not null and pg_catalog.char_length(v_notes) > 1000 then
    raise exception 'Ölçüm notu 1000 karakterden uzun olamaz.'
      using errcode = '22023';
  end if;

  if p_measured_at = v_today then
    update public.client_profiles
    set current_weight = p_weight
    where user_id = p_client_id;

    get diagnostics v_updated_profiles = row_count;
    if v_updated_profiles <> 1 then
      raise exception 'Danışan profili bulunamadı.'
        using errcode = 'P0002';
    end if;
  end if;

  insert into public.measurements as existing (
    client_id,
    measured_at,
    weight,
    notes
  )
  values (
    p_client_id,
    p_measured_at,
    p_weight,
    v_notes
  )
  on conflict (client_id, measured_at)
  do update set
    weight = excluded.weight,
    notes = coalesce(excluded.notes, existing.notes),
    updated_at = pg_catalog.now()
  returning * into v_measurement;

  return v_measurement;
end;
$$;

comment on function public.save_active_client_weight(uuid, date, numeric, text)
is 'Allows a verified dietitian with an active relationship to patch only weight and an optional note on one daily measurement row. Today is the Europe/Istanbul calendar date.';

revoke all on function public.save_active_client_weight(uuid, date, numeric, text)
from public, anon, authenticated;
grant execute on function public.save_active_client_weight(uuid, date, numeric, text)
to authenticated;

do $postflight$
declare
  v_function regprocedure := to_regprocedure('public.save_active_client_weight(uuid,date,numeric,text)');
begin
  if v_function is null then
    raise exception 'save_active_client_weight postcondition failed: function is missing.';
  end if;

  if (
    select count(*)
    from pg_catalog.pg_proc as p
    join pg_catalog.pg_namespace as n
      on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'save_active_client_weight'
  ) <> 1 then
    raise exception 'save_active_client_weight postcondition failed: overloads exist.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_proc as p
    where p.oid = v_function
      and p.prosecdef is true
      and p.prorettype = 'public.measurements'::regtype
      and p.proconfig @> array['search_path=pg_catalog, public', 'TimeZone=Europe/Istanbul']::text[]
  ) then
    raise exception 'save_active_client_weight postcondition failed: security definer, return type or configuration drifted.';
  end if;

  if not has_function_privilege('authenticated', v_function, 'EXECUTE')
     or has_function_privilege('anon', v_function, 'EXECUTE')
     or exists (
       select 1
       from pg_catalog.pg_proc as p
       cross join lateral pg_catalog.aclexplode(p.proacl) as acl
       where p.oid = v_function
         and acl.grantee = 0
         and acl.privilege_type = 'EXECUTE'
     ) then
    raise exception 'save_active_client_weight postcondition failed: execute privileges drifted.';
  end if;
end
$postflight$;

notify pgrst, 'reload schema';

commit;
