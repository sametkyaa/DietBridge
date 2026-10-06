-- Faz 2 / 6: server-written Terms of Use and KVKK acceptance timestamps.
--
--   * profiles.terms_accepted_at / profiles.kvkk_accepted_at are written only
--     by the server (handle_new_user at sign-up, accept_legal_terms later);
--   * an authenticated client cannot insert or change them directly, so a
--     backdated or fake timestamp cannot be written;
--   * BACKWARD COMPATIBILITY: sign-up metadata without the acceptance flags
--     (the current store mobile build) still creates the account exactly as
--     before; the timestamps simply stay null and can be recorded later via
--     accept_legal_terms(). Nothing here rejects an existing client.
begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regprocedure('public.handle_new_user()') is null
     or to_regprocedure('public.protect_profile_system_fields()') is null then
    raise exception 'Legal acceptance prerequisites are missing.';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'profiles'
       and column_name in ('terms_accepted_at', 'kvkk_accepted_at')
  ) or to_regprocedure('public.accept_legal_terms()') is not null then
    raise exception 'Legal acceptance objects already exist; inspect schema drift before applying this migration.';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'auth.users'::regclass
       and tgname = 'on_auth_user_created'
       and not tgisinternal
  ) then
    raise exception 'Expected auth.users on_auth_user_created trigger is missing.';
  end if;
end
$preflight$;

alter table public.profiles
  add column terms_accepted_at timestamptz,
  add column kvkk_accepted_at timestamptz;

comment on column public.profiles.terms_accepted_at is
  'Server time of Terms of Use acceptance. Written only by handle_new_user or accept_legal_terms.';
comment on column public.profiles.kvkk_accepted_at is
  'Server time of KVKK notice acceptance. Written only by handle_new_user or accept_legal_terms.';

-- Same body as the canonical handle_new_user, plus the two acceptance
-- timestamps. The flags are read from sign-up metadata and only ever produce
-- the server clock; metadata cannot carry a timestamp value.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_account_type text;
  v_role public.user_role;
  v_full_name text;
  v_phone text;
  v_terms_accepted_at timestamptz;
  v_kvkk_accepted_at timestamptz;
begin
  v_account_type := lower(coalesce(nullif(new.raw_user_meta_data ->> 'account_type', ''), nullif(new.raw_user_meta_data ->> 'role', ''), ''));
  if v_account_type = 'client' then
    v_role := 'client'::public.user_role;
  elsif v_account_type = 'dietitian' then
    v_role := 'dietitian'::public.user_role;
  else
    raise exception 'Geçersiz hesap türü; yalnız client veya dietitian kabul edilir.' using errcode = '22023';
  end if;
  v_full_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '');
  v_phone := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');

  if lower(coalesce(new.raw_user_meta_data ->> 'terms_accepted', '')) = 'true' then
    v_terms_accepted_at := now();
  end if;
  if lower(coalesce(new.raw_user_meta_data ->> 'kvkk_accepted', '')) = 'true' then
    v_kvkk_accepted_at := now();
  end if;

  insert into public.profiles (id, email, full_name, phone, role, terms_accepted_at, kvkk_accepted_at)
  values (new.id, new.email, v_full_name, v_phone, v_role, v_terms_accepted_at, v_kvkk_accepted_at)
  on conflict (id) do nothing;

  if v_role = 'client'::public.user_role then
    insert into public.client_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  else
    insert into public.dietitian_profiles (user_id, is_verified, verification_status, verified_at, rejection_reason)
    values (new.id, false, 'pending', null, null)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$function$;

alter function public.handle_new_user() owner to postgres;
revoke all on function public.handle_new_user() from public, anon, authenticated;

create function private.guard_profile_legal_acceptance()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $function$
begin
  -- API roles reach this trigger only through direct table writes; the
  -- server-side writers run as the function owner and are not restricted.
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      if new.terms_accepted_at is not null or new.kvkk_accepted_at is not null then
        raise exception 'Onay zaman damgaları yalnızca sunucu tarafından yazılır.' using errcode = '42501';
      end if;
    elsif new.terms_accepted_at is distinct from old.terms_accepted_at
       or new.kvkk_accepted_at is distinct from old.kvkk_accepted_at then
      raise exception 'Onay zaman damgaları yalnızca sunucu tarafından yazılır.' using errcode = '42501';
    end if;
  end if;
  return new;
end
$function$;

alter function private.guard_profile_legal_acceptance() owner to postgres;
revoke all on function private.guard_profile_legal_acceptance() from public, anon, authenticated, service_role;

create trigger trg_guard_profile_legal_acceptance
before insert or update on public.profiles
for each row execute function private.guard_profile_legal_acceptance();

-- Records acceptance for an already-registered user (for example a client who
-- signed up with an older mobile build). Existing timestamps are never moved.
create function public.accept_legal_terms()
returns table (
  terms_accepted_at timestamptz,
  kvkk_accepted_at timestamptz
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'Authentication required.' using errcode = '42501';
  end if;

  return query
  update public.profiles as p
     set terms_accepted_at = coalesce(p.terms_accepted_at, now()),
         kvkk_accepted_at = coalesce(p.kvkk_accepted_at, now())
   where p.id = v_actor_id
  returning p.terms_accepted_at, p.kvkk_accepted_at;

  if not found then
    raise exception 'Profile not found.' using errcode = 'P0002';
  end if;
end
$function$;

alter function public.accept_legal_terms() owner to postgres;
revoke all on function public.accept_legal_terms() from public, anon, service_role;
grant execute on function public.accept_legal_terms() to authenticated;

do $postflight$
begin
  if has_function_privilege('anon', 'public.accept_legal_terms()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.accept_legal_terms()', 'EXECUTE') then
    raise exception 'accept_legal_terms ACL is incorrect.';
  end if;

  if not exists (
    select 1 from pg_trigger
     where tgrelid = 'public.profiles'::regclass
       and tgname = 'trg_guard_profile_legal_acceptance'
       and not tgisinternal
  ) then
    raise exception 'Legal acceptance guard trigger is missing.';
  end if;
end
$postflight$;

commit;
