-- WP4: split active-dietitian measurement writes into narrow patch contracts.
-- The legacy full-payload RPC remains present for migration history compatibility,
-- but authenticated callers can no longer execute it because explicit nulls in
-- that contract could erase another form's values on the same daily row.

do $$
begin
  if to_regclass('public.measurements') is null
     or to_regclass('public.measurements_client_date_unique') is null
     or to_regprocedure(
       'public.save_active_client_measurement(uuid,date,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text)'
     ) is null then
    raise exception 'Expected measurement contract is missing; migration stopped.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_class as c
    join pg_catalog.pg_namespace as n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'measurements'
      and c.relrowsecurity is true
  ) then
    raise exception 'RLS must remain enabled on public.measurements.';
  end if;
end
$$;

revoke all on function public.save_active_client_measurement(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) from public, anon, authenticated;

comment on function public.save_active_client_measurement(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) is 'Deprecated full-payload measurement RPC. Execution is revoked because narrow patch RPCs preserve same-day values safely.';

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
as $$
declare
  v_actor_id uuid := auth.uid();
  v_notes text := nullif(pg_catalog.btrim(p_notes), '');
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

  if p_measured_at > current_date then
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

  if p_measured_at = current_date then
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
is 'Allows a verified dietitian with an active relationship to patch only weight and an optional note on one daily measurement row.';

revoke all on function public.save_active_client_weight(uuid, date, numeric, text)
from public, anon;
grant execute on function public.save_active_client_weight(uuid, date, numeric, text)
to authenticated;

create or replace function public.save_active_client_body_measurements(
  p_client_id uuid,
  p_measured_at date,
  p_waist numeric default null,
  p_hip numeric default null,
  p_arm numeric default null,
  p_chest numeric default null,
  p_calf numeric default null,
  p_neck numeric default null,
  p_notes text default null
)
returns public.measurements
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_actor_id uuid := auth.uid();
  v_notes text := nullif(pg_catalog.btrim(p_notes), '');
  v_measurement public.measurements%rowtype;
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

  if p_measured_at > current_date then
    raise exception 'Ölçüm tarihi gelecekte olamaz.'
      using errcode = '22023';
  end if;

  if pg_catalog.num_nonnulls(p_waist, p_hip, p_arm, p_chest, p_calf, p_neck) = 0 then
    raise exception 'En az bir vücut ölçüsü girilmelidir.'
      using errcode = '22023';
  end if;

  if (p_waist is not null and (p_waist <= 0 or p_waist > 500))
     or (p_hip is not null and (p_hip <= 0 or p_hip > 500))
     or (p_arm is not null and (p_arm <= 0 or p_arm > 500))
     or (p_chest is not null and (p_chest <= 0 or p_chest > 500))
     or (p_calf is not null and (p_calf <= 0 or p_calf > 500))
     or (p_neck is not null and (p_neck <= 0 or p_neck > 500)) then
    raise exception 'Çevre ölçümleri 0 ile 500 cm arasında olmalıdır.'
      using errcode = '22023';
  end if;

  if v_notes is not null and pg_catalog.char_length(v_notes) > 1000 then
    raise exception 'Ölçüm notu 1000 karakterden uzun olamaz.'
      using errcode = '22023';
  end if;

  insert into public.measurements as existing (
    client_id,
    measured_at,
    waist,
    hip,
    arm,
    chest,
    calf,
    neck,
    notes
  )
  values (
    p_client_id,
    p_measured_at,
    p_waist,
    p_hip,
    p_arm,
    p_chest,
    p_calf,
    p_neck,
    v_notes
  )
  on conflict (client_id, measured_at)
  do update set
    waist = coalesce(excluded.waist, existing.waist),
    hip = coalesce(excluded.hip, existing.hip),
    arm = coalesce(excluded.arm, existing.arm),
    chest = coalesce(excluded.chest, existing.chest),
    calf = coalesce(excluded.calf, existing.calf),
    neck = coalesce(excluded.neck, existing.neck),
    notes = coalesce(excluded.notes, existing.notes),
    updated_at = pg_catalog.now()
  returning * into v_measurement;

  return v_measurement;
end;
$$;

comment on function public.save_active_client_body_measurements(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text
) is 'Allows a verified dietitian with an active relationship to patch body circumferences without changing weight or other existing measurement values.';

revoke all on function public.save_active_client_body_measurements(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text
) from public, anon;
grant execute on function public.save_active_client_body_measurements(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, text
) to authenticated;
