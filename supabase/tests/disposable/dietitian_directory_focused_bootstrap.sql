-- Minimal local fixtures for runDietitianDirectoryPostgresVerification.mjs.
-- Not the full schema: just the tables, enums and helpers the directory migration
-- touches. Real relationship trigger functions are extracted from the migrations.
do $r$ begin if not exists(select 1 from pg_roles where rolname=$q$anon$q$) then create role anon nologin; create role authenticated nologin; create role service_role nologin; end if; end $r$;
create schema auth; create schema private; create schema extensions;
grant usage on schema public, auth to anon, authenticated;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub','')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create publication supabase_realtime;
create type public.user_role as enum ('dietitian','client');
create type public.client_status as enum ('active','inactive','pending','rejected','removed');
create table auth.users(id uuid primary key, instance_id uuid, aud text, role text, email text, encrypted_password text,
  email_confirmed_at timestamptz, raw_app_meta_data jsonb, raw_user_meta_data jsonb, created_at timestamptz, updated_at timestamptz);
create table public.profiles(id uuid primary key references auth.users(id) on delete cascade, email text, full_name text, avatar_url text,
  role public.user_role default 'client', created_at timestamptz default now());
create table public.dietitian_profiles(user_id uuid primary key references public.profiles(id), phone text, university text, graduation_year int,
  experience_years int, specialization text, bio text, diploma_url text, is_verified boolean default false, created_at timestamptz default now(),
  verification_status text not null default 'pending', verified_at timestamptz, rejection_reason text);
create table public.dietitian_subscriptions(dietitian_id uuid primary key, plan_id text, status text, client_limit_override int);
create table public.dietitian_clients(id uuid primary key default gen_random_uuid(), dietitian_id uuid references public.profiles(id),
  client_id uuid references public.profiles(id), status public.client_status not null default 'pending', created_at timestamptz default now(),
  requested_at timestamptz, accepted_at timestamptz, rejected_at timestamptz, removed_at timestamptz, updated_at timestamptz);
create unique index one_pending_or_active_dietitian_per_client on public.dietitian_clients(client_id) where status in ('pending','active');
create table public.notifications(id uuid primary key default gen_random_uuid(), recipient_id uuid, category text, event_type text,
  aggregation_key text, summary_key text, actor_id uuid, dietitian_client_id uuid, relationship_from_status public.client_status,
  relationship_to_status public.client_status, occurred_at timestamptz);
-- onboarding trigger stub mirroring handle_new_user's role/profile creation
create function public.handle_new_user() returns trigger language plpgsql security definer as $$
declare v_type text := new.raw_user_meta_data->>'account_type';
begin
  insert into public.profiles(id,email,full_name,role) values(new.id,new.email,new.raw_user_meta_data->>'full_name',v_type::public.user_role);
  if v_type='dietitian' then insert into public.dietitian_profiles(user_id) values(new.id); end if;
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();
create function public.is_current_user_dietitian() returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.profiles p join public.dietitian_profiles dp on dp.user_id=p.id where p.id=auth.uid() and p.role='dietitian'
    and dp.verification_status='approved' and dp.is_verified) $$;
grant execute on function public.is_current_user_dietitian() to authenticated;
create function public.dietitian_effective_client_limit(p_dietitian uuid) returns integer language sql stable security definer set search_path=pg_catalog,public as $$
  select coalesce((select coalesce(client_limit_override, 10) from public.dietitian_subscriptions where dietitian_id=p_dietitian and status='active'),0) $$;
create function private.upsert_notification_aggregate(p_recipient_id uuid, p_category text, p_event_type text, p_aggregation_key text, p_summary_key text,
  p_actor_id uuid default null, p_conversation_id uuid default null, p_appointment_id uuid default null, p_dietitian_client_id uuid default null,
  p_appointment_title_snapshot text default null, p_appointment_date date default null, p_appointment_time time without time zone default null,
  p_appointment_status text default null, p_relationship_from_status public.client_status default null, p_relationship_to_status public.client_status default null,
  p_occurred_at timestamptz default now()) returns public.notifications language plpgsql security definer as $$
declare r public.notifications;
begin
  insert into public.notifications(recipient_id,category,event_type,aggregation_key,summary_key,actor_id,dietitian_client_id,relationship_from_status,relationship_to_status,occurred_at)
  values(p_recipient_id,p_category,p_event_type,p_aggregation_key,p_summary_key,p_actor_id,p_dietitian_client_id,p_relationship_from_status,p_relationship_to_status,p_occurred_at) returning * into r;
  return r;
end $$;
grant select on public.profiles, public.dietitian_profiles, public.dietitian_clients to authenticated;
grant update on public.dietitian_profiles to authenticated;
alter table public.dietitian_profiles enable row level security;
create policy own_update on public.dietitian_profiles for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());
create policy own_select on public.dietitian_profiles for select to authenticated using (user_id=auth.uid());
alter table public.dietitian_clients enable row level security;
create policy own_select on public.dietitian_clients for select to authenticated using (client_id=auth.uid() or dietitian_id=auth.uid());
