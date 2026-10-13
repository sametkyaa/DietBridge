-- Add a short alias without invalidating existing codes or changing relationships.
-- Production application requires explicit approval. Repeat application preserves aliases.
begin;

do $$ begin
  if to_regclass('public.dietitian_invite_codes') is null
    or to_regprocedure('extensions.gen_random_bytes(integer)') is null
    or to_regprocedure('private.require_invite_actor(text)') is null then
    raise exception 'Short invite prerequisites missing';
  end if;
end $$;

create or replace function private.generate_short_invite_code() returns text
language plpgsql volatile set search_path = pg_catalog, extensions as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_result text := ''; v_random integer; v_count integer := 0;
begin
  -- Eight symbols provide >39 bits. Only authenticated clients can resolve them,
  -- with the existing shared limit of five failed preview/redeem attempts/hour.
  while v_count < 8 loop
    v_random := get_byte(extensions.gen_random_bytes(1), 0);
    if v_random >= (256 / length(v_alphabet)) * length(v_alphabet) then continue; end if;
    if v_count = 4 then v_result := v_result || '-'; end if;
    v_result := v_result || substr(v_alphabet, v_random % length(v_alphabet) + 1, 1);
    v_count := v_count + 1;
  end loop;
  return v_result;
end $$;
revoke all on function private.generate_short_invite_code() from public, anon, authenticated;

alter table public.dietitian_invite_codes add column if not exists short_code text;
alter table public.dietitian_invite_codes add column if not exists normalized_short_code text
  generated always as (replace(short_code, '-', '')) stored;
create unique index if not exists dietitian_invite_codes_normalized_short_code_key
  on public.dietitian_invite_codes(normalized_short_code);
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.dietitian_invite_codes'::regclass and conname='invite_short_code_format') then
    alter table public.dietitian_invite_codes add constraint invite_short_code_format
      check (short_code ~ '^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}$');
  end if;
end $$;

-- Assign aliases to existing rows. The original code, timestamps, open/closed
-- state and relationships are preserved. Unique collisions are retried.
do $$
declare v_owner uuid; v_constraint text; v_attempt integer; v_assigned boolean;
begin
  for v_owner in select dietitian_id from public.dietitian_invite_codes where short_code is null loop
    v_assigned := false;
    for v_attempt in 1..32 loop
      begin
        update public.dietitian_invite_codes set short_code=private.generate_short_invite_code()
          where dietitian_id=v_owner and short_code is null;
        v_assigned := true; exit;
      exception when unique_violation then
        get stacked diagnostics v_constraint = constraint_name;
        if v_constraint <> 'dietitian_invite_codes_normalized_short_code_key' then raise; end if;
      end;
    end loop;
    if not v_assigned then raise exception 'Short invite allocation failed'; end if;
  end loop;
end $$;
alter table public.dietitian_invite_codes alter column short_code set default private.generate_short_invite_code();
alter table public.dietitian_invite_codes alter column short_code set not null;

create or replace function public.rotate_my_invite_code() returns public.dietitian_invite_codes
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('dietitian'); v_row public.dietitian_invite_codes;
begin
  v_row := public.get_my_invite_code();
  loop
    begin
      update public.dietitian_invite_codes set code=private.generate_invite_code(),short_code=private.generate_short_invite_code(),updated_at=now(),rotated_at=now()
        where dietitian_id=v_actor returning * into v_row;
      return v_row;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

create or replace function public.preview_dietitian_invite_code(p_code text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('client'); v_code public.dietitian_invite_codes; v_profile record;
begin
  perform pg_advisory_xact_lock(hashtext(v_actor::text));
  if private.invite_rate_limited(v_actor) then return jsonb_build_object('result','rate_limited'); end if;
  select * into v_code from public.dietitian_invite_codes where normalized_code=private.normalize_invite_code(p_code)
    or normalized_short_code=private.normalize_invite_code(p_code) for share;
  if v_code.dietitian_id is null or not exists(select 1 from public.dietitian_profiles dp join public.profiles p on p.id=dp.user_id
     where dp.user_id=v_code.dietitian_id and dp.verification_status='approved' and dp.is_verified is true and p.role::text='dietitian') then
    insert into private.invite_code_attempts(client_id,success) values(v_actor,false);
    return jsonb_build_object('result','not_found');
  end if;
  if not v_code.is_open then
    insert into private.invite_code_attempts(client_id,success) values(v_actor,false);
    return jsonb_build_object('result','closed');
  end if;
  select p.full_name into v_profile from public.profiles p where p.id=v_code.dietitian_id;
  -- A private avatar requires a separate authorized signed URL endpoint; no
  -- broad avatar Storage access is granted to unconnected clients here.
  return jsonb_build_object('result','ready','dietitian',jsonb_build_object(
    'id',v_code.dietitian_id,'display_name',v_profile.full_name,'professional_title','Diyetisyen','avatar_url',null));
end $$;

create or replace function public.redeem_dietitian_invite_code(p_code text) returns text
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('client'); v_code public.dietitian_invite_codes; v_existing public.dietitian_clients;
begin
  perform pg_advisory_xact_lock(hashtext(v_actor::text));
  if private.invite_rate_limited(v_actor) then return 'rate_limited'; end if;
  select * into v_code from public.dietitian_invite_codes where normalized_code=private.normalize_invite_code(p_code)
    or normalized_short_code=private.normalize_invite_code(p_code) for share;
  if v_code.dietitian_id is null or not exists(select 1 from public.dietitian_profiles dp join public.profiles p on p.id=dp.user_id
    where dp.user_id=v_code.dietitian_id and dp.verification_status='approved' and dp.is_verified is true and p.role::text='dietitian') then
    insert into private.invite_code_attempts(client_id,success) values(v_actor,false); return 'not_found';
  end if;
  if not v_code.is_open then
    insert into private.invite_code_attempts(client_id,success) values(v_actor,false); return 'closed';
  end if;
  perform pg_advisory_xact_lock(hashtext('dietitian_client_capacity:' || v_code.dietitian_id::text));
  select * into v_existing from public.dietitian_clients where client_id=v_actor and status='active' for update;
  if found then
    if v_existing.dietitian_id=v_code.dietitian_id then return 'already_connected'; end if;
    return 'has_other_dietitian';
  end if;
  select * into v_existing from public.dietitian_clients where client_id=v_actor and dietitian_id=v_code.dietitian_id for update;
  if (v_existing.id is null or v_existing.status <> 'pending')
    and public.dietitian_active_client_usage(v_code.dietitian_id) >= public.dietitian_effective_client_limit(v_code.dietitian_id) then
    return 'limit_reached';
  end if;
  -- Only this caller's old pending requests close, only after successful
  -- checks. A failed check leaves legacy pending relationships untouched.
  update public.dietitian_clients set status='removed' where client_id=v_actor and dietitian_id<>v_code.dietitian_id and status='pending';
  if v_existing.id is null then
    insert into public.dietitian_clients(dietitian_id,client_id,status) values(v_code.dietitian_id,v_actor,'pending') returning * into v_existing;
  elsif v_existing.status in ('removed','rejected') then
    update public.dietitian_clients set status='pending' where id=v_existing.id;
  end if;
  update public.dietitian_clients set status='active' where id=v_existing.id;
  insert into private.invite_code_attempts(client_id,success) values(v_actor,true);
  return 'connected';
end $$;

-- Keep the existing authenticated-only RPC grants explicit. No RLS changes.
revoke all on function public.rotate_my_invite_code(), public.preview_dietitian_invite_code(text),
  public.redeem_dietitian_invite_code(text) from public, anon;
grant execute on function public.rotate_my_invite_code(), public.preview_dietitian_invite_code(text),
  public.redeem_dietitian_invite_code(text) to authenticated;
notify pgrst, 'reload schema';
commit;
