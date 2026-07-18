-- WP4.5A: active dietitian measurement writes through one narrow RPC surface.
-- Existing rows are never rewritten or deleted. New constraints are installed
-- NOT VALID first (which still protects new writes) and then validated so any
-- incompatible historical row stops the migration fail-closed.

do $$
begin
  if to_regclass('public.measurements') is null
     or to_regclass('public.measurements_client_date_unique') is null
     or to_regprocedure('public.sync_client_weight_to_measurements()') is null
     or to_regprocedure('public.save_my_current_weight(numeric)') is null then
    raise exception 'Expected measurement schema contract is missing; migration stopped.';
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

do $$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.measurements'::regclass
      and conname = 'measurements_has_numeric_value_check'
  ) then
    alter table public.measurements
      add constraint measurements_has_numeric_value_check
      check (pg_catalog.num_nonnulls(weight, waist, hip, arm, chest, thigh, calf, neck) > 0)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.measurements'::regclass
      and conname = 'measurements_weight_range_strict_check'
  ) then
    alter table public.measurements
      add constraint measurements_weight_range_strict_check
      check (weight is null or weight between 20 and 500)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.measurements'::regclass
      and conname = 'measurements_circumference_range_check'
  ) then
    alter table public.measurements
      add constraint measurements_circumference_range_check
      check (
        (waist is null or waist > 0 and waist <= 500)
        and (hip is null or hip > 0 and hip <= 500)
        and (arm is null or arm > 0 and arm <= 500)
        and (chest is null or chest > 0 and chest <= 500)
        and (thigh is null or thigh > 0 and thigh <= 500)
        and (calf is null or calf > 0 and calf <= 500)
        and (neck is null or neck > 0 and neck <= 500)
      )
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.measurements'::regclass
      and conname = 'measurements_measured_at_not_future_check'
  ) then
    alter table public.measurements
      add constraint measurements_measured_at_not_future_check
      check (measured_at <= current_date)
      not valid;
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.measurements'::regclass
      and conname = 'measurements_notes_length_check'
  ) then
    alter table public.measurements
      add constraint measurements_notes_length_check
      check (notes is null or pg_catalog.char_length(notes) <= 1000)
      not valid;
  end if;
end
$$;

alter table public.measurements validate constraint measurements_has_numeric_value_check;
alter table public.measurements validate constraint measurements_weight_range_strict_check;
alter table public.measurements validate constraint measurements_circumference_range_check;
alter table public.measurements validate constraint measurements_measured_at_not_future_check;
alter table public.measurements validate constraint measurements_notes_length_check;

create or replace function public.normalize_measurement_notes()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.notes := nullif(pg_catalog.btrim(new.notes), '');
  return new;
end;
$$;

revoke all on function public.normalize_measurement_notes() from public;
revoke all on function public.normalize_measurement_notes() from anon;
revoke all on function public.normalize_measurement_notes() from authenticated;

drop trigger if exists trg_normalize_measurement_notes on public.measurements;
create trigger trg_normalize_measurement_notes
before insert or update of notes on public.measurements
for each row execute function public.normalize_measurement_notes();

create or replace function public.save_active_client_measurement(
  p_client_id uuid,
  p_measured_at date default current_date,
  p_weight numeric default null,
  p_waist numeric default null,
  p_hip numeric default null,
  p_arm numeric default null,
  p_chest numeric default null,
  p_thigh numeric default null,
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
  v_updated_profiles integer;
begin
  if v_actor_id is null then
    raise exception 'Bu işlem için oturum açmalısınız.'
      using errcode = '42501';
  end if;

  -- Lock every authorization row used by this write. The relationship cannot
  -- transition away from active until this short transaction completes.
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
    p_weight, p_waist, p_hip, p_arm, p_chest, p_thigh, p_calf, p_neck
  ) = 0 then
    raise exception 'En az bir ölçüm değeri girilmelidir.'
      using errcode = '22023';
  end if;

  if p_weight is not null and (p_weight < 20 or p_weight > 500) then
    raise exception 'Kilo değeri 20 ile 500 kg arasında olmalıdır.'
      using errcode = '22023';
  end if;

  if (p_waist is not null and (p_waist <= 0 or p_waist > 500))
     or (p_hip is not null and (p_hip <= 0 or p_hip > 500))
     or (p_arm is not null and (p_arm <= 0 or p_arm > 500))
     or (p_chest is not null and (p_chest <= 0 or p_chest > 500))
     or (p_thigh is not null and (p_thigh <= 0 or p_thigh > 500))
     or (p_calf is not null and (p_calf <= 0 or p_calf > 500))
     or (p_neck is not null and (p_neck <= 0 or p_neck > 500)) then
    raise exception 'Çevre ölçümleri 0 ile 500 cm arasında olmalıdır.'
      using errcode = '22023';
  end if;

  if v_notes is not null and pg_catalog.char_length(v_notes) > 1000 then
    raise exception 'Ölçüm notu 1000 karakterden uzun olamaz.'
      using errcode = '22023';
  end if;

  -- For today's weight, update the profile first. The existing sync trigger may
  -- upsert the daily weight row while preserving all other columns. The full
  -- payload upsert below then becomes the canonical final state, so there is no
  -- recursion and explicit nulls intentionally clear that day's optional fields.
  if p_weight is not null and p_measured_at = current_date then
    update public.client_profiles
    set current_weight = p_weight
    where user_id = p_client_id;

    get diagnostics v_updated_profiles = row_count;
    if v_updated_profiles <> 1 then
      raise exception 'Danışan profili bulunamadı.'
        using errcode = 'P0002';
    end if;
  end if;

  insert into public.measurements (
    client_id,
    measured_at,
    weight,
    waist,
    hip,
    arm,
    chest,
    thigh,
    calf,
    neck,
    notes
  )
  values (
    p_client_id,
    p_measured_at,
    p_weight,
    p_waist,
    p_hip,
    p_arm,
    p_chest,
    p_thigh,
    p_calf,
    p_neck,
    v_notes
  )
  on conflict (client_id, measured_at)
  do update set
    weight = excluded.weight,
    waist = excluded.waist,
    hip = excluded.hip,
    arm = excluded.arm,
    chest = excluded.chest,
    thigh = excluded.thigh,
    calf = excluded.calf,
    neck = excluded.neck,
    notes = excluded.notes,
    updated_at = pg_catalog.now()
  returning * into v_measurement;

  return v_measurement;
end;
$$;

comment on function public.save_active_client_measurement(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) is 'Allows a verified dietitian to upsert one full daily measurement payload for an active client relationship.';

revoke all on function public.save_active_client_measurement(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) from public;
revoke all on function public.save_active_client_measurement(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) from anon;
grant execute on function public.save_active_client_measurement(
  uuid, date, numeric, numeric, numeric, numeric, numeric, numeric, numeric, numeric, text
) to authenticated;
