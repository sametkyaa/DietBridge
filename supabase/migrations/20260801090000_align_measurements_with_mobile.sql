-- Align the Web measurements contract with the mobile side-specific fields.
-- Legacy arm/calf columns and any legacy measurement RPCs remain untouched.
-- The legacy RPC is optional because Production history variants may not have
-- applied the older Web-only body-measurement migration.

do $$
begin
  if to_regclass('public.measurements') is null
     or to_regclass('public.measurements_client_date_unique') is null then
    raise exception 'Expected measurements table contract is missing; migration stopped.';
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
end
$$;

alter table public.measurements
  add column if not exists right_arm numeric(5,2),
  add column if not exists left_arm numeric(5,2),
  add column if not exists right_calf numeric(5,2),
  add column if not exists left_calf numeric(5,2);

comment on column public.measurements.right_arm is 'Right arm circumference in centimeters; canonical mobile measurement field.';
comment on column public.measurements.left_arm is 'Left arm circumference in centimeters; canonical mobile measurement field.';
comment on column public.measurements.right_calf is 'Right calf circumference in centimeters; canonical mobile measurement field.';
comment on column public.measurements.left_calf is 'Left calf circumference in centimeters; canonical mobile measurement field.';

-- Existing unlimited numeric columns are normalized to numeric(5,2).
-- The guard rejects values that would require rounding or violate the
-- canonical range; Production preflight must report the same zero counts.
do $$
begin
  if exists (
    select 1
    from public.measurements
    where (right_arm is not null and (
      right_arm <> pg_catalog.round(right_arm, 2)
      or right_arm <= 0
      or right_arm > 500
    ))
    or (left_arm is not null and (
      left_arm <> pg_catalog.round(left_arm, 2)
      or left_arm <= 0
      or left_arm > 500
    ))
    or (right_calf is not null and (
      right_calf <> pg_catalog.round(right_calf, 2)
      or right_calf <= 0
      or right_calf > 500
    ))
    or (left_calf is not null and (
      left_calf <> pg_catalog.round(left_calf, 2)
      or left_calf <= 0
      or left_calf > 500
    ))
  ) then
    raise exception 'Existing side-specific measurement data requires rounding or violates the canonical range; migration stopped.'
      using errcode = '22003';
  end if;
end
$$;

do $$
begin
  alter table public.measurements
    alter column right_arm type numeric(5,2)
      using right_arm::numeric(5,2),
    alter column left_arm type numeric(5,2)
      using left_arm::numeric(5,2),
    alter column right_calf type numeric(5,2)
      using right_calf::numeric(5,2),
    alter column left_calf type numeric(5,2)
      using left_calf::numeric(5,2);
end
$$;

alter table public.measurements
  drop constraint if exists measurements_side_circumference_range_check;

alter table public.measurements
  add constraint measurements_side_circumference_range_check
  check (
    (right_arm is null or (right_arm > 0 and right_arm <= 500))
    and (left_arm is null or (left_arm > 0 and left_arm <= 500))
    and (right_calf is null or (right_calf > 0 and right_calf <= 500))
    and (left_calf is null or (left_calf > 0 and left_calf <= 500))
  );

alter table public.measurements
  validate constraint measurements_side_circumference_range_check;

-- A new function avoids changing the deployed legacy signature and never
-- fabricates a left/right value from legacy arm/calf data.
create or replace function public.save_active_client_body_measurements_v2(
  p_client_id uuid,
  p_measured_at date,
  p_waist numeric default null,
  p_hip numeric default null,
  p_right_arm numeric default null,
  p_left_arm numeric default null,
  p_chest numeric default null,
  p_right_calf numeric default null,
  p_left_calf numeric default null,
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

  if pg_catalog.num_nonnulls(
    p_waist,
    p_hip,
    p_right_arm,
    p_left_arm,
    p_chest,
    p_right_calf,
    p_left_calf,
    p_neck
  ) = 0 then
    raise exception 'En az bir vücut ölçüsü girilmelidir.'
      using errcode = '22023';
  end if;

  if (p_waist is not null and (p_waist <= 0 or p_waist > 500))
     or (p_hip is not null and (p_hip <= 0 or p_hip > 500))
     or (p_right_arm is not null and (p_right_arm <= 0 or p_right_arm > 500))
     or (p_left_arm is not null and (p_left_arm <= 0 or p_left_arm > 500))
     or (p_chest is not null and (p_chest <= 0 or p_chest > 500))
     or (p_right_calf is not null and (p_right_calf <= 0 or p_right_calf > 500))
     or (p_left_calf is not null and (p_left_calf <= 0 or p_left_calf > 500))
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
    right_arm,
    left_arm,
    chest,
    right_calf,
    left_calf,
    neck,
    notes
  )
  values (
    p_client_id,
    p_measured_at,
    p_waist,
    p_hip,
    p_right_arm,
    p_left_arm,
    p_chest,
    p_right_calf,
    p_left_calf,
    p_neck,
    v_notes
  )
  on conflict (client_id, measured_at)
  do update set
    waist = coalesce(excluded.waist, existing.waist),
    hip = coalesce(excluded.hip, existing.hip),
    right_arm = coalesce(excluded.right_arm, existing.right_arm),
    left_arm = coalesce(excluded.left_arm, existing.left_arm),
    chest = coalesce(excluded.chest, existing.chest),
    right_calf = coalesce(excluded.right_calf, existing.right_calf),
    left_calf = coalesce(excluded.left_calf, existing.left_calf),
    neck = coalesce(excluded.neck, existing.neck),
    notes = coalesce(excluded.notes, existing.notes),
    updated_at = pg_catalog.now()
  returning * into v_measurement;

  return v_measurement;
end;
$$;

comment on function public.save_active_client_body_measurements_v2(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) is 'Allows a verified dietitian with an active relationship to patch canonical side-specific body circumferences without fabricating legacy arm/calf sides.';

revoke all on function public.save_active_client_body_measurements_v2(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) from public, anon;
grant execute on function public.save_active_client_body_measurements_v2(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) to authenticated;

notify pgrst, 'reload schema';
