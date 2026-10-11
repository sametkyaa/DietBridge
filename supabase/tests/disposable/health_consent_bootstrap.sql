-- Disposable core-contract fixture only. Never run against a linked/remote DB.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid;
$$;
grant usage on schema auth to authenticated, anon, service_role;
grant execute on function auth.uid() to authenticated, anon, service_role;
create table public.profiles(id uuid primary key,role text not null);
create table public.client_profiles(user_id uuid primary key references public.profiles(id),
  height_cm integer, current_weight numeric, food_intolerances text[],
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.client_medical_conditions(id uuid primary key default gen_random_uuid(), client_id uuid references public.profiles(id), notes text);
create table public.client_medications(id uuid primary key default gen_random_uuid(), client_id uuid references public.profiles(id), notes text);
create table public.measurements(id uuid primary key default gen_random_uuid(), client_id uuid references public.profiles(id), weight numeric);
create table public.body_measurements(id uuid primary key default gen_random_uuid(), client_id uuid references public.profiles(id), waist_cm numeric);
create table public.daily_logs(id uuid primary key default gen_random_uuid(), client_id uuid references public.profiles(id), water_intake numeric);
create type public.client_status as enum ('active','pending','rejected','inactive');
create table public.dietitian_clients(dietitian_id uuid,client_id uuid,status public.client_status);
insert into public.profiles values
 ('11111111-1111-4111-8111-111111111111','client'),
 ('22222222-2222-4222-8222-222222222222','client'),
 ('33333333-3333-4333-8333-333333333333','dietitian'),
 ('44444444-4444-4444-8444-444444444444','dietitian');
insert into public.client_profiles(user_id) select id from public.profiles where role='client';
insert into public.dietitian_clients values
 ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','active');
grant select on public.profiles,public.dietitian_clients to authenticated;
do $$
declare t text; idcol text;
begin
  foreach t in array array['client_profiles','client_medical_conditions','client_medications','measurements','body_measurements','daily_logs'] loop
    idcol:=case when t='client_profiles' then 'user_id' else 'client_id' end;
    execute format('alter table public.%I enable row level security',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('create policy self on public.%I for all to authenticated using (%I=auth.uid()) with check (%I=auth.uid())',t,idcol,idcol);
    execute format('create policy active_dietitian on public.%I for select to authenticated using (exists(select 1 from public.dietitian_clients d where d.client_id=%I and d.dietitian_id=auth.uid() and d.status=''active''))',t,idcol);
  end loop;
end $$;
-- A definer writer deliberately bypasses RLS to prove the table trigger still
-- requires consent for JWT callers. It retains an explicit ownership check.
create function public.fixture_definer_write(p_weight numeric) returns void language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from public.profiles where id=auth.uid() and role='client') then
    raise exception 'Client only' using errcode='42501';
  end if;
  insert into public.measurements(client_id,weight) values(auth.uid(),p_weight);
end $$;
revoke all on function public.fixture_definer_write(numeric) from public;
grant execute on function public.fixture_definer_write(numeric) to authenticated;
