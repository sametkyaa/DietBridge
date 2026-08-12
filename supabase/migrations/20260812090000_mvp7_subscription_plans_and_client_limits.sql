-- DietBridge MVP-7 forward-only migration:
-- Canonical, provider-neutral subscription/plan state plus server-side
-- dietitian client-limit enforcement.
--
-- Scope (additive only):
--   * public.subscription_plans   canonical plan catalog (authoritative limits)
--   * public.dietitian_subscriptions  one row per dietitian (plan + status)
--   * effective-entitlement + usage helpers (SECURITY DEFINER, internal)
--   * a fail-closed, race-safe capacity trigger on dietitian_clients
--   * a friendly capacity signal from request_client_connection_by_email
--   * public.get_dietitian_subscription_overview() read RPC for the UI
--
-- This migration creates no Auth user, subscription row, relationship or
-- historical-record backfill. A missing subscription row is intentionally
-- not an entitlement: the effective limit is zero until a controlled
-- server-side workflow creates an explicit subscription row.
-- Every change is inside one transaction; any postcondition failure rolls back.

begin;

do $$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null
     or to_regprocedure('public.request_client_connection_by_email(text)') is null then
    raise exception 'MVP-7 abonelik sozlesmesi icin beklenen sema nesneleri bulunamadi; migration durduruldu.';
  end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 1. Canonical plan catalog. Plan limits are authoritative and deterministic;
--    UI and enforcement both read from here rather than hardcoding numbers.
-- ---------------------------------------------------------------------------
create table if not exists public.subscription_plans (
  id text primary key,
  name text not null,
  client_limit integer not null,
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint subscription_plans_client_limit_nonneg check (client_limit >= 0),
  constraint subscription_plans_name_nonempty check (btrim(name) <> '')
);

alter table public.subscription_plans owner to postgres;

-- Canonical MVP plan definitions. Re-asserted on every replay so the catalog
-- stays the single source of truth. Scale is a bounded 50-client base tier;
-- per-account overrides below support future limits above 50 without an
-- unlimited sentinel.
insert into public.subscription_plans (id, name, client_limit, is_active, sort_order)
values
  ('core',  'Core',  10, true, 10),
  ('plus',  'Plus',  30, true, 20),
  ('scale', 'Scale', 50, true, 30)
on conflict (id) do update
  set name = excluded.name,
      client_limit = excluded.client_limit,
      is_active = excluded.is_active,
      sort_order = excluded.sort_order,
      updated_at = now();

-- ---------------------------------------------------------------------------
-- 2. Per-dietitian subscription state. Provider-neutral: no payment provider
--    is assumed. The browser has no write path; only service-role / server
--    workflows (a future checkout/webhook) mutate this table.
-- ---------------------------------------------------------------------------
create table if not exists public.dietitian_subscriptions (
  dietitian_id uuid primary key references public.profiles(id) on delete cascade,
  plan_id text not null references public.subscription_plans(id),
  status text not null default 'active',
  -- NULL means the plan's catalog limit. Only Scale may carry a non-NULL
  -- account-specific limit, and it must be an explicit finite value above 50.
  client_limit_override integer,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dietitian_subscriptions_status_check
    check (status = any (array['active', 'trialing', 'past_due', 'canceled', 'inactive'])),
  constraint dietitian_subscriptions_client_limit_override_scale_check
    check (
      client_limit_override is null
      or (plan_id = 'scale' and client_limit_override > 50)
    )
);

alter table public.dietitian_subscriptions owner to postgres;

-- Keep replay behavior safe if a disposable database already contains the
-- first local draft of this table. The production migration is unshipped, so
-- no historical production row is rewritten here.
alter table public.dietitian_subscriptions
  add column if not exists client_limit_override integer;

do $$
begin
  -- Replace the first local draft's broader non-negative check if a
  -- disposable replay already created that draft table. This migration is
  -- unshipped, so the compatibility path remains local-only.
  if exists (
    select 1
    from pg_constraint
    where conrelid = 'public.dietitian_subscriptions'::regclass
      and conname = 'dietitian_subscriptions_client_limit_override_nonneg'
  ) then
    alter table public.dietitian_subscriptions
      drop constraint dietitian_subscriptions_client_limit_override_nonneg;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.dietitian_subscriptions'::regclass
      and conname = 'dietitian_subscriptions_client_limit_override_scale_check'
  ) then
    alter table public.dietitian_subscriptions
      add constraint dietitian_subscriptions_client_limit_override_scale_check
      check (
        client_limit_override is null
        or (plan_id = 'scale' and client_limit_override > 50)
      );
  end if;
end
$$;

create index if not exists idx_dietitian_subscriptions_plan
  on public.dietitian_subscriptions (plan_id);

-- ---------------------------------------------------------------------------
-- 3. RLS. Catalog is read-only reference data for authenticated users.
--    Subscription rows are readable only by their owning dietitian; there is
--    no authenticated write policy (fail closed; server-side only).
-- ---------------------------------------------------------------------------
alter table public.subscription_plans enable row level security;
alter table public.dietitian_subscriptions enable row level security;

drop policy if exists "subscription_plans_read_active" on public.subscription_plans;
create policy "subscription_plans_read_active"
  on public.subscription_plans
  for select
  to authenticated
  using (is_active = true);

drop policy if exists "dietitian_subscriptions_select_own" on public.dietitian_subscriptions;
create policy "dietitian_subscriptions_select_own"
  on public.dietitian_subscriptions
  for select
  to authenticated
  using (dietitian_id = (select auth.uid()));

revoke all on table public.subscription_plans from public, anon, authenticated;
grant select on table public.subscription_plans to authenticated;

revoke all on table public.dietitian_subscriptions from public, anon, authenticated;
grant select on table public.dietitian_subscriptions to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Internal entitlement helpers. SECURITY DEFINER so the enforcement path
--    is deterministic regardless of caller RLS; not executable by clients.
-- ---------------------------------------------------------------------------
create or replace function public.dietitian_effective_client_limit(p_dietitian uuid)
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_status text;
  v_plan_id text;
  v_override integer;
  v_limit integer;
  v_plan_active boolean;
begin
  if p_dietitian is null then
    return 0;
  end if;

  select ds.status, ds.plan_id, ds.client_limit_override
    into v_status, v_plan_id, v_override
  from public.dietitian_subscriptions as ds
  where ds.dietitian_id = p_dietitian;

  if not found then
    -- There is no Free plan and no implicit commercial entitlement. A
    -- missing row remains fail-closed at zero until a controlled server-side
    -- workflow creates an explicit subscription row.
    return 0;
  end if;

  -- An existing subscription that is not currently entitled fails closed.
  if v_status is null or v_status not in ('active', 'trialing') then
    return 0;
  end if;

  select sp.client_limit, sp.is_active
    into v_limit, v_plan_active
  from public.subscription_plans as sp
  where sp.id = v_plan_id;

  if not found or v_plan_active is distinct from true or v_limit is null then
    return 0;
  end if;

  return coalesce(v_override, v_limit);
end;
$function$;

alter function public.dietitian_effective_client_limit(uuid) owner to postgres;
revoke all on function public.dietitian_effective_client_limit(uuid) from public, anon, authenticated;

create or replace function public.dietitian_active_client_usage(p_dietitian uuid)
returns integer
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select count(*)::integer
  from public.dietitian_clients as dc
  where dc.dietitian_id = p_dietitian
    and dc.status in ('active'::public.client_status, 'pending'::public.client_status);
$function$;

alter function public.dietitian_active_client_usage(uuid) owner to postgres;
revoke all on function public.dietitian_active_client_usage(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Fail-closed, race-safe capacity trigger. Fires for every path that
--    consumes a new capacity slot: pending/active inserts and rejected/removed
--    -> pending reactivation. Client accept (pending -> active) does not
--    increase active+pending usage and is not blocked.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_dietitian_client_capacity()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_limit integer;
  v_usage integer;
begin
  if tg_op = 'INSERT' then
    if new.status is distinct from 'pending'::public.client_status
       and new.status is distinct from 'active'::public.client_status then
      return new;
    end if;
  elsif tg_op = 'UPDATE' then
    if not (
      old.status in ('rejected'::public.client_status, 'removed'::public.client_status)
      and new.status = 'pending'::public.client_status
    ) then
      return new;
    end if;
  else
    return new;
  end if;

  -- Serialize concurrent capacity-consuming writes for this dietitian so a
  -- pair of simultaneous requests cannot both slip past the limit.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('dietitian_client_capacity:' || new.dietitian_id::text)
  );

  v_limit := public.dietitian_effective_client_limit(new.dietitian_id);
  v_usage := public.dietitian_active_client_usage(new.dietitian_id);

  if v_usage >= v_limit then
    raise exception 'Danisan limitine ulasildi (% / %).', v_usage, v_limit
      using errcode = '23514', hint = 'client_limit_reached';
  end if;

  return new;
end;
$function$;

alter function public.enforce_dietitian_client_capacity() owner to postgres;
revoke all on function public.enforce_dietitian_client_capacity() from public, anon, authenticated;

drop trigger if exists trg_enforce_dietitian_client_capacity on public.dietitian_clients;
create trigger trg_enforce_dietitian_client_capacity
before insert or update on public.dietitian_clients
for each row execute function public.enforce_dietitian_client_capacity();

-- ---------------------------------------------------------------------------
-- 6. Friendly capacity signal from the canonical relationship-creation RPC.
--    The RPC returns 'limit_reached' before attempting the insert; the trigger
--    remains the fail-closed backstop for any other path.
-- ---------------------------------------------------------------------------
create or replace function public.request_client_connection_by_email(p_email text)
returns text
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_dietitian_id uuid := auth.uid();
  v_client_id uuid;
  v_existing_status public.client_status;
  v_normalized_email text := lower(btrim(coalesce(p_email, '')));
  v_limit integer;
  v_usage integer;
begin
  if v_dietitian_id is null or not public.is_current_user_dietitian() then
    raise exception 'Diyetisyen yetkisi gerekli.' using errcode = '42501';
  end if;

  if v_normalized_email = '' then
    return 'unavailable';
  end if;

  select p.id
    into v_client_id
  from public.profiles as p
  where p.role = 'client'::public.user_role
    and lower(btrim(p.email)) = v_normalized_email
  order by p.id
  limit 1;

  if v_client_id is null then
    return 'unavailable';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_client_id::text));
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext('dietitian_client_capacity:' || v_dietitian_id::text)
  );

  select dc.status
    into v_existing_status
  from public.dietitian_clients as dc
  where dc.dietitian_id = v_dietitian_id
    and dc.client_id = v_client_id
  for update;

  if found then
    if v_existing_status = 'active'::public.client_status then
      return 'already_active';
    end if;

    if v_existing_status = 'pending'::public.client_status then
      return 'already_pending';
    end if;

    -- Reactivating a rejected/removed relationship consumes a capacity slot.
    v_limit := public.dietitian_effective_client_limit(v_dietitian_id);
    v_usage := public.dietitian_active_client_usage(v_dietitian_id);
    if v_usage >= v_limit then
      return 'limit_reached';
    end if;

    update public.dietitian_clients
       set status = 'pending'::public.client_status
     where dietitian_id = v_dietitian_id
       and client_id = v_client_id;

    return 'requested';
  end if;

  if exists (
    select 1
    from public.dietitian_clients as dc
    where dc.client_id = v_client_id
      and dc.status in ('pending'::public.client_status, 'active'::public.client_status)
  ) then
    return 'unavailable';
  end if;

  v_limit := public.dietitian_effective_client_limit(v_dietitian_id);
  v_usage := public.dietitian_active_client_usage(v_dietitian_id);
  if v_usage >= v_limit then
    return 'limit_reached';
  end if;

  begin
    insert into public.dietitian_clients (dietitian_id, client_id, status)
    values (v_dietitian_id, v_client_id, 'pending'::public.client_status);
  exception
    when unique_violation then
      return 'unavailable';
  end;

  return 'requested';
end;
$function$;

alter function public.request_client_connection_by_email(text) owner to postgres;
revoke all on function public.request_client_connection_by_email(text) from public, anon;
grant execute on function public.request_client_connection_by_email(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Authoritative subscription overview for the dietitian UI. Returns the
--    current plan, status, catalog base limit, override-aware effective limit,
--    usage and remaining capacity so the front end never has to guess
--    ("8 / 10 danisan").
-- ---------------------------------------------------------------------------
create or replace function public.get_dietitian_subscription_overview()
returns table (
  plan_id text,
  plan_name text,
  subscription_status text,
  plan_limit integer,
  effective_limit integer,
  active_count integer,
  pending_count integer,
  used integer,
  remaining integer,
  limit_reached boolean
)
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_dietitian_id uuid := auth.uid();
  v_status text;
  v_plan_id text;
  v_plan_name text;
  v_plan_limit integer;
  v_override integer;
  v_effective integer;
  v_active integer;
  v_pending integer;
  v_used integer;
begin
  if v_dietitian_id is null or not public.is_current_user_dietitian() then
    raise exception 'Diyetisyen yetkisi gerekli.' using errcode = '42501';
  end if;

  select ds.status, ds.plan_id, ds.client_limit_override
    into v_status, v_plan_id, v_override
  from public.dietitian_subscriptions as ds
  where ds.dietitian_id = v_dietitian_id;

  if not found then
    -- No subscription row is a real, non-entitled state. Do not present it as
    -- Core or another commercial package in the read model.
    v_status := null;
    v_plan_id := null;
    v_override := null;
  end if;

  select sp.name, sp.client_limit
    into v_plan_name, v_plan_limit
  from public.subscription_plans as sp
  where sp.id = v_plan_id;

  v_effective := public.dietitian_effective_client_limit(v_dietitian_id);

  select
    count(*) filter (where dc.status = 'active'::public.client_status),
    count(*) filter (where dc.status = 'pending'::public.client_status)
    into v_active, v_pending
  from public.dietitian_clients as dc
  where dc.dietitian_id = v_dietitian_id;

  v_active := coalesce(v_active, 0);
  v_pending := coalesce(v_pending, 0);
  v_used := v_active + v_pending;

  return query
  select
    v_plan_id,
    coalesce(v_plan_name, v_plan_id),
    v_status,
    v_plan_limit,
    v_effective,
    v_active,
    v_pending,
    v_used,
    greatest(v_effective - v_used, 0),
    (v_used >= v_effective);
end;
$function$;

alter function public.get_dietitian_subscription_overview() owner to postgres;
revoke all on function public.get_dietitian_subscription_overview() from public, anon;
grant execute on function public.get_dietitian_subscription_overview() to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Postconditions. Any failure rolls the whole migration back.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.subscription_plans') is null
     or to_regclass('public.dietitian_subscriptions') is null then
    raise exception 'Abonelik tablolari postcondition dogrulamasi basarisiz.';
  end if;

  if (select count(*) from public.subscription_plans) <> 3
     or not exists (
       select 1
       from public.subscription_plans
       where id = 'core' and name = 'Core' and client_limit = 10
         and is_active = true and sort_order = 10
     )
     or not exists (
       select 1
       from public.subscription_plans
       where id = 'plus' and name = 'Plus' and client_limit = 30
         and is_active = true and sort_order = 20
     )
     or not exists (
       select 1
       from public.subscription_plans
       where id = 'scale' and name = 'Scale' and client_limit = 50
         and is_active = true and sort_order = 30
     ) then
    raise exception 'Kanonik plan katalogu postcondition dogrulamasi basarisiz.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dietitian_subscriptions'
      and column_name = 'client_limit_override'
  ) then
    raise exception 'Hesap bazli limit override kolonu postcondition dogrulamasi basarisiz.';
  end if;

  if not exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.dietitian_clients'::regclass
      and tgname = 'trg_enforce_dietitian_client_capacity'
      and not tgisinternal
  ) then
    raise exception 'Kapasite trigger postcondition dogrulamasi basarisiz.';
  end if;

  if to_regprocedure('public.get_dietitian_subscription_overview()') is null
     or to_regprocedure('public.dietitian_effective_client_limit(uuid)') is null
     or to_regprocedure('public.dietitian_active_client_usage(uuid)') is null then
    raise exception 'Abonelik fonksiyon postcondition dogrulamasi basarisiz.';
  end if;

  if has_function_privilege('anon', 'public.get_dietitian_subscription_overview()', 'EXECUTE') then
    raise exception 'anon rolu abonelik overview RPC EXECUTE yetkisine sahip olmamali.';
  end if;

  if not has_function_privilege('authenticated', 'public.get_dietitian_subscription_overview()', 'EXECUTE') then
    raise exception 'authenticated rolu abonelik overview RPC EXECUTE yetkisine sahip degil.';
  end if;

  if has_table_privilege('anon', 'public.dietitian_subscriptions', 'SELECT') then
    raise exception 'anon rolu dietitian_subscriptions okuyamamali.';
  end if;
end
$$;

commit;
