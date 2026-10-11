-- Local-only extension fixture with permissive ownership policies.
create schema storage;
create table public.meal_plans(id uuid primary key default gen_random_uuid(),client_id uuid references public.profiles(id),dietitian_id uuid,notes text);
create table public.meals(id uuid primary key default gen_random_uuid(),plan_id uuid references public.meal_plans(id),is_eaten boolean default false,completion_photo_url text);
create table public.meal_change_requests(id uuid primary key default gen_random_uuid(),client_id uuid references public.profiles(id),notes text);
create table public.client_nutrition_targets(client_id uuid primary key references public.profiles(id),min_kcal integer);
create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text);
grant usage on schema storage to authenticated;
alter table storage.objects enable row level security;
grant select,insert,update,delete on storage.objects to authenticated;
create policy fixture_storage on storage.objects for all to authenticated using (true) with check (true);
do $$
declare t text;
begin
  foreach t in array array['meal_plans','meal_change_requests','client_nutrition_targets'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('create policy fixture_owner on public.%I for all to authenticated using (client_id=auth.uid() or exists(select 1 from public.dietitian_clients d where d.client_id=%I.client_id and d.dietitian_id=auth.uid() and d.status=''active'')) with check (client_id=auth.uid() or exists(select 1 from public.dietitian_clients d where d.client_id=%I.client_id and d.dietitian_id=auth.uid() and d.status=''active''))',t,t,t);
  end loop;
end $$;
alter table public.meals enable row level security;
grant select,insert,update,delete on public.meals to authenticated;
create policy fixture_meal_owner on public.meals for all to authenticated using
 (exists(select 1 from public.meal_plans p where p.id=plan_id)) with check
 (exists(select 1 from public.meal_plans p where p.id=plan_id));
create function public.fixture_definer_meal(p_id uuid) returns void language plpgsql security definer set search_path='' as $$
begin update public.meals set is_eaten=true where id=p_id and exists
 (select 1 from public.meal_plans p where p.id=plan_id and p.client_id=auth.uid()); end $$;
revoke all on function public.fixture_definer_meal(uuid) from public;
grant execute on function public.fixture_definer_meal(uuid) to authenticated;
-- Deliberately overprivileged fixtures prove guards do not trust definer code.
create function public.fixture_reassign_meal(p_id uuid,p_plan uuid) returns void language plpgsql security definer set search_path='' as $$
begin update public.meals set plan_id=p_plan where id=p_id; end $$;
revoke all on function public.fixture_reassign_meal(uuid,uuid) from public;
grant execute on function public.fixture_reassign_meal(uuid,uuid) to authenticated;
