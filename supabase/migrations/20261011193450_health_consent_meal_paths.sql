-- Dormant addition to the core consent gate; never enables the rollout.
begin;
do $$
declare t text;
begin
  if to_regprocedure('private.health_consent_allows(uuid,boolean)') is null then
    raise exception 'Core health consent prerequisite missing';
  end if;
  foreach t in array array['meal_plans','meals','meal_change_requests','client_nutrition_targets'] loop
    if not exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='public' and c.relname=t and c.relrowsecurity) then
      raise exception 'Expected RLS table missing: %',t;
    end if;
  end loop;
  if not exists(select 1 from pg_class where oid='storage.objects'::regclass and relrowsecurity) then
    raise exception 'Expected Storage RLS missing';
  end if;
end $$;

-- A boolean-only lookup avoids recursive RLS evaluation through meal_plans.
-- It adds consent only: existing ownership/role/relationship policies still apply.
create function private.meal_plan_consent_allows(p_plan_id uuid, p_read boolean)
returns boolean language sql security definer set search_path=''
as $$
  select exists(select 1 from public.meal_plans p where p.id=p_plan_id and
    ((p_read and p.client_id=auth.uid()) or
      private.health_consent_allows(p.client_id,p.client_id<>auth.uid())));
$$;
revoke all on function private.meal_plan_consent_allows(uuid,boolean) from public,anon,service_role;
grant execute on function private.meal_plan_consent_allows(uuid,boolean) to authenticated;

create function private.guard_meal_health_write()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_client uuid; v_old_client uuid; v_actor uuid:=auth.uid();
begin
  if not private.health_consent_enabled() then return new; end if;
  -- Internal service work is not certified by this authenticated-path increment.
  -- Cleanup DELETE is deliberately unaffected.
  if v_actor is null then
    if current_setting('role',true) in ('postgres','supabase_admin','service_role')
       or (current_setting('role',true)='none' and session_user in ('postgres','supabase_admin')) then return new; end if;
    raise exception 'Client session required' using errcode='42501';
  end if;
  if tg_table_name='meals' then
    select p.client_id into v_client from public.meal_plans p where p.id=new.plan_id;
    if tg_op='UPDATE' then
      select p.client_id into v_old_client from public.meal_plans p where p.id=old.plan_id;
    end if;
  else
    v_client:=new.client_id;
    if tg_op='UPDATE' then v_old_client:=old.client_id; end if;
  end if;
  if v_client is null or (tg_op='UPDATE' and v_old_client is distinct from v_client) then
    raise exception 'Health record owner cannot change' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client::text,8311));
  if not private.health_consent_allows(v_client,v_actor<>v_client) then
    raise exception 'Health data consent required' using errcode='42501';
  end if;
  return new;
end $$;
revoke all on function private.guard_meal_health_write() from public,anon,authenticated,service_role;

do $$
declare t text;
begin
  foreach t in array array['meal_plans','meals','meal_change_requests','client_nutrition_targets'] loop
    execute format('create trigger trg_guard_meal_health_write before insert or update on public.%I for each row execute function private.guard_meal_health_write()',t);
    if t='meals' then
      execute 'create policy "Meal health consent sharing gate" on public.meals as restrictive for select to authenticated using (private.meal_plan_consent_allows(plan_id,true))';
    else
      execute format('create policy "Meal health consent sharing gate" on public.%I as restrictive for select to authenticated using (client_id=(select auth.uid()) or private.health_consent_allows(client_id,true))',t);
    end if;
  end loop;
end $$;

-- Only personal completion photos are gated here. Shared recipe/plan media,
-- avatars and chat images are separate paths, not silently reclassified.
create function private.completion_photo_consent_allows(p_name text,p_read boolean)
returns boolean language plpgsql security definer set search_path=''
as $$
declare v_client uuid;
begin
  if not private.health_consent_enabled() then return true; end if;
  if auth.uid() is null then return false; end if;
  -- Never cast untrusted object names; malformed names simply fail closed.
  select p.client_id into v_client from public.meal_plans p
    join public.meals m on m.plan_id=p.id
    where p.client_id::text=split_part(p_name,'/',1) and m.id::text=split_part(p_name,'/',2)
      and (not p_read or m.completion_photo_url=p_name);
  if v_client is null then return false; end if;
  if not p_read then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client::text,8311));
  end if;
  return (p_read and v_client=auth.uid()) or
    private.health_consent_allows(v_client,v_client<>auth.uid());
end $$;
revoke all on function private.completion_photo_consent_allows(text,boolean) from public,anon,service_role;
grant execute on function private.completion_photo_consent_allows(text,boolean) to authenticated;
create policy "Completion photo consent read gate" on storage.objects as restrictive
  for select to authenticated using (bucket_id<>'meal-completion-photos' or private.completion_photo_consent_allows(name,true));
create policy "Completion photo consent insert gate" on storage.objects as restrictive
  for insert to authenticated with check (bucket_id<>'meal-completion-photos' or private.completion_photo_consent_allows(name,false));
create policy "Completion photo consent update gate" on storage.objects as restrictive
  for update to authenticated using (bucket_id<>'meal-completion-photos' or private.completion_photo_consent_allows(name,false))
  with check (bucket_id<>'meal-completion-photos' or private.completion_photo_consent_allows(name,false));
notify pgrst,'reload schema';
commit;
