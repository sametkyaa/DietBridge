-- Faz 2 / 2: dietitian-owned daily calorie target per client.
--
-- The target deliberately does NOT live on client_profiles: clients can update
-- their own client_profiles row, so a target stored there could be edited by
-- the client. client_nutrition_targets is owned by the dietitian of an ACTIVE
-- relationship:
--   * dietitian: reads its own rows; writes only through
--     set_client_nutrition_target (upsert / clear);
--   * client: reads the target set by its active dietitian, never writes;
--   * a lower and/or upper kcal bound is stored; missing bounds stay null and
--     are never estimated.
begin;

do $preflight$
begin
  if to_regclass('public.dietitian_clients') is null
     or to_regclass('public.profiles') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null then
    raise exception 'Nutrition target prerequisites are missing.';
  end if;

  if to_regclass('public.client_nutrition_targets') is not null
     or to_regprocedure('public.set_client_nutrition_target(uuid,integer,integer)') is not null then
    raise exception 'Nutrition target objects already exist; inspect schema drift before applying this migration.';
  end if;
end
$preflight$;

create table public.client_nutrition_targets (
  dietitian_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid not null references public.profiles(id) on delete cascade,
  min_kcal integer,
  max_kcal integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint client_nutrition_targets_pkey primary key (dietitian_id, client_id),
  constraint client_nutrition_targets_distinct_parties_check check (dietitian_id <> client_id),
  constraint client_nutrition_targets_min_range_check
    check (min_kcal is null or min_kcal between 500 and 10000),
  constraint client_nutrition_targets_max_range_check
    check (max_kcal is null or max_kcal between 500 and 10000),
  constraint client_nutrition_targets_order_check
    check (min_kcal is null or max_kcal is null or min_kcal <= max_kcal),
  constraint client_nutrition_targets_not_empty_check
    check (min_kcal is not null or max_kcal is not null)
);

comment on table public.client_nutrition_targets is
  'Dietitian-owned daily kcal target band for a client. Written only by set_client_nutrition_target.';

create index client_nutrition_targets_client_idx
  on public.client_nutrition_targets (client_id);

alter table public.client_nutrition_targets enable row level security;

revoke all on table public.client_nutrition_targets from public, anon, authenticated;
grant select on table public.client_nutrition_targets to authenticated;
grant all on table public.client_nutrition_targets to service_role;

create policy "Approved dietitian authorization gate"
  on public.client_nutrition_targets
  as restrictive
  for all
  to authenticated
  using ((select public.current_user_role()) = 'client'::public.user_role or (select public.is_current_user_dietitian()))
  with check ((select public.current_user_role()) = 'client'::public.user_role or (select public.is_current_user_dietitian()));

create policy "Dietitians can view own client nutrition targets"
  on public.client_nutrition_targets
  for select
  to authenticated
  using (
    dietitian_id = (select auth.uid())
    and exists (
      select 1
        from public.dietitian_clients as dc
       where dc.dietitian_id = client_nutrition_targets.dietitian_id
         and dc.client_id = client_nutrition_targets.client_id
         and dc.status = 'active'::public.client_status
    )
  );

create policy "Clients can view target from active dietitian"
  on public.client_nutrition_targets
  for select
  to authenticated
  using (
    client_id = (select auth.uid())
    and exists (
      select 1
        from public.dietitian_clients as dc
       where dc.dietitian_id = client_nutrition_targets.dietitian_id
         and dc.client_id = client_nutrition_targets.client_id
         and dc.status = 'active'::public.client_status
    )
  );

create function public.set_client_nutrition_target(
  p_client_id uuid,
  p_min_kcal integer,
  p_max_kcal integer
)
returns public.client_nutrition_targets
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_result public.client_nutrition_targets%rowtype;
begin
  if v_actor_id is null or p_client_id is null then
    raise exception 'Nutrition target access denied.' using errcode = '42501';
  end if;

  if not (select public.is_current_user_dietitian()) then
    raise exception 'Nutrition target access denied.' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.dietitian_clients as dc
     where dc.dietitian_id = v_actor_id
       and dc.client_id = p_client_id
       and dc.status = 'active'::public.client_status
  ) then
    raise exception 'An active dietitian-client relationship is required.' using errcode = '42501';
  end if;

  if (p_min_kcal is not null and (p_min_kcal < 500 or p_min_kcal > 10000))
     or (p_max_kcal is not null and (p_max_kcal < 500 or p_max_kcal > 10000)) then
    raise exception 'Calorie target must be between 500 and 10000 kcal.' using errcode = '22023';
  end if;

  if p_min_kcal is not null and p_max_kcal is not null and p_min_kcal > p_max_kcal then
    raise exception 'Lower calorie target cannot exceed the upper target.' using errcode = '22023';
  end if;

  if p_min_kcal is null and p_max_kcal is null then
    delete from public.client_nutrition_targets as t
     where t.dietitian_id = v_actor_id
       and t.client_id = p_client_id
    returning t.* into v_result;
    -- Clearing returns the removed row (or null when nothing was stored).
    return v_result;
  end if;

  insert into public.client_nutrition_targets (dietitian_id, client_id, min_kcal, max_kcal)
  values (v_actor_id, p_client_id, p_min_kcal, p_max_kcal)
  on conflict (dietitian_id, client_id) do update
    set min_kcal = excluded.min_kcal,
        max_kcal = excluded.max_kcal,
        updated_at = now()
  returning * into v_result;

  return v_result;
end
$function$;

alter function public.set_client_nutrition_target(uuid, integer, integer) owner to postgres;
revoke all on function public.set_client_nutrition_target(uuid, integer, integer) from public, anon, service_role;
grant execute on function public.set_client_nutrition_target(uuid, integer, integer) to authenticated;

do $postflight$
begin
  if has_table_privilege('authenticated', 'public.client_nutrition_targets', 'INSERT')
     or has_table_privilege('authenticated', 'public.client_nutrition_targets', 'UPDATE')
     or has_table_privilege('authenticated', 'public.client_nutrition_targets', 'DELETE')
     or has_table_privilege('anon', 'public.client_nutrition_targets', 'SELECT') then
    raise exception 'client_nutrition_targets privileges are too broad.';
  end if;

  if not (select relrowsecurity from pg_class where oid = 'public.client_nutrition_targets'::regclass) then
    raise exception 'client_nutrition_targets must have RLS enabled.';
  end if;

  if has_function_privilege('anon', 'public.set_client_nutrition_target(uuid,integer,integer)', 'EXECUTE') then
    raise exception 'set_client_nutrition_target ACL is too broad.';
  end if;
end
$postflight$;

commit;
