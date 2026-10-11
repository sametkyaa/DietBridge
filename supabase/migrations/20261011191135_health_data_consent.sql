-- Dormant core-health consent foundation. Enable only after legal text, m.9,
-- remaining data paths and a compatible mobile release have been approved.
begin;

do $preflight$
declare t text;
begin
  if to_regprocedure('auth.uid()') is null or to_regclass('public.profiles') is null then
    raise exception 'Auth/profile prerequisites missing';
  end if;
  foreach t in array array['client_profiles','client_medical_conditions','client_medications',
                          'measurements','body_measurements','daily_logs'] loop
    if not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
                   where n.nspname='public' and c.relname=t and c.relrowsecurity) then
      raise exception 'Expected RLS table missing: %', t;
    end if;
  end loop;
  if to_regclass('private.health_consent_settings') is not null then
    raise exception 'Consent objects already exist; inspect drift';
  end if;
end
$preflight$;

create schema if not exists private;
create table private.health_consent_settings (
  singleton boolean primary key default true check (singleton),
  enabled boolean not null default false,
  document_version text not null,
  notice_version text not null,
  processing_text text not null,
  sharing_text text not null
);
insert into private.health_consent_settings
  (document_version, notice_version, processing_text, sharing_text)
values (
  'health-core-2026-10-11-v1-draft', 'health-core-notice-2026-10-11-v1-draft',
  'Sağlık, ölçüm, beslenme ve yaşam tarzı bilgilerimin kişisel takip kayıtlarımın oluşturulması ve hesabımda saklanması amacıyla DietBridge tarafından işlenmesine açık rıza veriyorum.',
  'Bu bilgilerimin yalnız aktif bağlantı kurduğum yetkili diyetisyene beslenme planı ve takip hizmeti amacıyla sunulmasına açık rıza veriyorum.'
);

create table private.health_consent_state (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  document_version text not null,
  storage_granted boolean not null,
  sharing_granted boolean not null check (not sharing_granted or storage_granted),
  updated_at timestamptz not null default clock_timestamp()
);
create table private.health_consent_events (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  document_version text not null,
  notice_version text not null,
  processing_text text not null,
  sharing_text text not null,
  storage_granted boolean not null,
  sharing_granted boolean not null,
  recorded_at timestamptz not null default clock_timestamp(),
  check (not sharing_granted or storage_granted)
);
create index health_consent_events_user_time on private.health_consent_events(user_id, recorded_at);
alter table private.health_consent_settings enable row level security;
alter table private.health_consent_state enable row level security;
alter table private.health_consent_events enable row level security;
revoke all on private.health_consent_settings, private.health_consent_state, private.health_consent_events
  from public, anon, authenticated, service_role;
revoke all on sequence private.health_consent_events_id_seq from public, anon, authenticated, service_role;

-- Authorization stays in existing ownership/approved-role/active-relation policies.
-- This helper only adds consent, and does not grant access by itself.
create function private.health_consent_allows(p_client_id uuid, p_sharing boolean default false)
returns boolean language sql security definer set search_path = ''
as $fn$
  select exists (
    select 1 from private.health_consent_settings cfg
    where cfg.singleton and (
      not cfg.enabled or exists (
        select 1 from private.health_consent_state s
        where s.user_id=p_client_id and s.document_version=cfg.document_version
          and s.storage_granted and (not p_sharing or s.sharing_granted)
      )
    )
  ) and auth.uid() is not null;
$fn$;
revoke all on function private.health_consent_allows(uuid,boolean) from public, anon, service_role;
grant usage on schema private to authenticated;
grant execute on function private.health_consent_allows(uuid,boolean) to authenticated;

create function private.read_my_health_consent()
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare cfg private.health_consent_settings%rowtype; s private.health_consent_state%rowtype;
begin
  if auth.uid() is null or not exists (select 1 from public.profiles where id=auth.uid() and role='client') then
    raise exception 'Client session required' using errcode='42501';
  end if;
  select * into strict cfg from private.health_consent_settings where singleton;
  select * into s from private.health_consent_state where user_id=auth.uid();
  return jsonb_build_object('enabled',cfg.enabled,'document_version',cfg.document_version,
    'notice_version',cfg.notice_version,'processing_text',cfg.processing_text,'sharing_text',cfg.sharing_text,
    'storage_granted',coalesce(s.storage_granted and s.document_version=cfg.document_version,false),
    'sharing_granted',coalesce(s.sharing_granted and s.storage_granted and s.document_version=cfg.document_version,false),
    'updated_at',s.updated_at);
end;
$fn$;

create function private.write_my_health_consent(p_document_version text, p_storage boolean, p_sharing boolean)
returns jsonb language plpgsql security definer set search_path = ''
as $fn$
declare cfg private.health_consent_settings%rowtype; v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists (select 1 from public.profiles where id=v_actor and role='client') then
    raise exception 'Client session required' using errcode='42501';
  end if;
  if p_storage is null or p_sharing is null or (p_sharing and not p_storage) then
    raise exception 'Invalid consent choice' using errcode='22023';
  end if;
  -- Same transaction lock as protected writes: withdrawals cannot race past a write.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_actor::text,8311));
  select * into strict cfg from private.health_consent_settings where singleton for share;
  if not cfg.enabled then
    raise exception 'Consent rollout is not active' using errcode='55000';
  end if;
  -- Withdrawal always remains possible, including after a document update.
  if p_storage and p_document_version is distinct from cfg.document_version then
    raise exception 'Consent document changed; reload before granting' using errcode='22023';
  end if;
  insert into private.health_consent_state(user_id,document_version,storage_granted,sharing_granted)
  values(v_actor,cfg.document_version,p_storage,p_sharing)
  on conflict(user_id) do update set document_version=excluded.document_version,
    storage_granted=excluded.storage_granted, sharing_granted=excluded.sharing_granted, updated_at=clock_timestamp();
  insert into private.health_consent_events(user_id,document_version,notice_version,processing_text,sharing_text,storage_granted,sharing_granted)
  values(v_actor,cfg.document_version,cfg.notice_version,cfg.processing_text,cfg.sharing_text,p_storage,p_sharing);
  return private.read_my_health_consent();
end;
$fn$;
revoke all on function private.read_my_health_consent(), private.write_my_health_consent(text,boolean,boolean)
  from public, anon, service_role;
grant execute on function private.read_my_health_consent(), private.write_my_health_consent(text,boolean,boolean) to authenticated;

-- Public entrypoints are invokers; privileged code stays in the unexposed schema.
create function public.get_my_health_consent() returns jsonb language sql security invoker set search_path = ''
as $fn$ select private.read_my_health_consent(); $fn$;
create function public.set_my_health_consent(p_document_version text, p_storage boolean, p_sharing boolean)
returns jsonb language sql security invoker set search_path = ''
as $fn$ select private.write_my_health_consent(p_document_version,p_storage,p_sharing); $fn$;
revoke all on function public.get_my_health_consent(), public.set_my_health_consent(text,boolean,boolean)
  from public, anon, service_role;
grant execute on function public.get_my_health_consent(), public.set_my_health_consent(text,boolean,boolean) to authenticated;

-- Expose only the rollout flag to the invoker guard.
create function private.health_consent_enabled() returns boolean language sql security definer set search_path = ''
as $fn$ select coalesce((select enabled from private.health_consent_settings where singleton),true); $fn$;
revoke all on function private.health_consent_enabled() from public, anon;
grant execute on function private.health_consent_enabled() to authenticated, service_role;

create function private.guard_core_health_write()
returns trigger language plpgsql security invoker set search_path = ''
as $fn$
declare v_client uuid; v_actor uuid := auth.uid(); v_json jsonb := to_jsonb(new);
begin
  if not private.health_consent_enabled() then return new; end if;
  if tg_table_name='client_profiles' then
    -- Empty auth bootstrap and timestamp-only updates still work without consent.
    v_json := v_json - array['user_id','created_at','updated_at'];
    if tg_op='INSERT' and not exists (select 1 from jsonb_each(v_json) where value <> 'null'::jsonb) then return new; end if;
    if tg_op='UPDATE' and v_json = (to_jsonb(old) - array['user_id','created_at','updated_at']) then return new; end if;
    v_client := new.user_id;
  else v_client := new.client_id;
  end if;
  -- Internal admin cleanup/replay is separate; authenticated RPCs keep auth.uid()
  -- even inside SECURITY DEFINER writers and must not bypass this guard.
  if v_actor is null then
    if current_user in ('postgres','service_role','supabase_admin') then return new; end if;
    raise exception 'Client session required' using errcode='42501';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client::text,8311));
  if not private.health_consent_allows(v_client,v_actor<>v_client) then
    raise exception 'Health data consent required' using errcode='42501';
  end if;
  return new;
end;
$fn$;
revoke all on function private.guard_core_health_write() from public, anon, authenticated, service_role;

do $guards$
declare t text; idcol text;
begin
  foreach t in array array['client_profiles','client_medical_conditions','client_medications','measurements','body_measurements','daily_logs'] loop
    idcol := case when t='client_profiles' then 'user_id' else 'client_id' end;
    execute format('create trigger trg_guard_core_health_write before insert or update on public.%I for each row execute function private.guard_core_health_write()',t);
    execute format('create policy "Core health consent sharing gate" on public.%I as restrictive for select to authenticated using (%I = (select auth.uid()) or private.health_consent_allows(%I,true))',t,idcol,idcol);
  end loop;
end
$guards$;

-- DELETE stays governed by existing RLS so withdrawal never blocks data removal.
notify pgrst, 'reload schema';
commit;
