-- Additive feature preparation. Never apply to Production without approval.
-- Repeat application is supported; no legacy RPC/privilege or pending row is removed.
begin;

do $$ begin
  if to_regprocedure('public.dietitian_effective_client_limit(uuid)') is null
     or to_regprocedure('public.dietitian_active_client_usage(uuid)') is null
     or to_regprocedure('private.notify_dietitian_client_change()') is null
     or to_regclass('public.one_pending_or_active_dietitian_per_client') is null
     or to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'Invite prerequisites missing';
  end if;
end $$;

create table if not exists public.dietitian_invite_codes (
  dietitian_id uuid primary key references public.profiles(id) on delete cascade,
  code text not null unique,
  normalized_code text generated always as (replace(code, '-', '')) stored unique,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  rotated_at timestamptz,
  constraint invite_code_format check (code ~ '^DB(-[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{4}){4}$')
);
alter table public.dietitian_invite_codes enable row level security;
revoke all on public.dietitian_invite_codes from public, anon, authenticated;
grant select on public.dietitian_invite_codes to authenticated;
drop policy if exists invite_codes_select_own on public.dietitian_invite_codes;
create policy invite_codes_select_own on public.dietitian_invite_codes for select to authenticated
using (dietitian_id = (select auth.uid()) and (select public.is_current_user_dietitian()));

-- No submitted code or profile data is retained. Both preview and redeem record
-- unsuccessful code lookups here; preview never writes a relationship.
create table if not exists private.invite_code_attempts (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.profiles(id) on delete cascade,
  attempted_at timestamptz not null default clock_timestamp(),
  success boolean not null
);
create index if not exists invite_code_attempts_client_time on private.invite_code_attempts(client_id, attempted_at desc) where not success;
alter table private.invite_code_attempts enable row level security;
revoke all on private.invite_code_attempts from public, anon, authenticated;
revoke all on sequence private.invite_code_attempts_id_seq from public, anon, authenticated;

create or replace function private.normalize_invite_code(p_code text) returns text
language sql immutable set search_path = pg_catalog as $$
  select case when length(p_code) between 1 and 64 and p_code ~ '^[[:alnum:][:space:]-]+$'
    then regexp_replace(upper(p_code), '[[:space:]-]', '', 'g') else null end;
$$;

create or replace function private.generate_invite_code() returns text
language plpgsql volatile set search_path = pg_catalog, extensions as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea; v_result text := 'DB'; v_random integer; v_count integer := 0;
begin
  -- Rejection sampling removes modulo bias; 16 symbols provide >77 bits.
  while v_count < 16 loop
    v_bytes := extensions.gen_random_bytes(1);
    v_random := get_byte(v_bytes, 0);
    if v_random >= (256 / length(v_alphabet)) * length(v_alphabet) then continue; end if;
    if v_count % 4 = 0 then v_result := v_result || '-'; end if;
    v_result := v_result || substr(v_alphabet, v_random % length(v_alphabet) + 1, 1);
    v_count := v_count + 1;
  end loop;
  return v_result;
end $$;

create or replace function private.require_invite_actor(p_role text) returns uuid
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or not exists(select 1 from public.profiles where id=v_actor and role::text=p_role)
    or (p_role='dietitian' and not public.is_current_user_dietitian()) then
    raise exception 'Invite access denied' using errcode='42501';
  end if;
  return v_actor;
end $$;

create or replace function public.get_my_invite_code() returns public.dietitian_invite_codes
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('dietitian'); v_row public.dietitian_invite_codes;
begin
  perform pg_advisory_xact_lock(hashtext('invite_owner:' || v_actor::text));
  select * into v_row from public.dietitian_invite_codes where dietitian_id=v_actor;
  if found then return v_row; end if;
  loop
    begin
      insert into public.dietitian_invite_codes(dietitian_id,code) values(v_actor,private.generate_invite_code()) returning * into v_row;
      return v_row;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

create or replace function public.rotate_my_invite_code() returns public.dietitian_invite_codes
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('dietitian'); v_row public.dietitian_invite_codes;
begin
  v_row := public.get_my_invite_code();
  loop
    begin
      update public.dietitian_invite_codes set code=private.generate_invite_code(),updated_at=now(),rotated_at=now()
        where dietitian_id=v_actor returning * into v_row;
      return v_row;
    exception when unique_violation then null;
    end;
  end loop;
end $$;

create or replace function public.set_my_invite_code_open(p_is_open boolean) returns public.dietitian_invite_codes
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('dietitian'); v_row public.dietitian_invite_codes;
begin
  if p_is_open is null then raise exception 'Invalid invite state' using errcode='22023'; end if;
  v_row := public.get_my_invite_code();
  update public.dietitian_invite_codes set is_open=p_is_open,updated_at=now() where dietitian_id=v_actor returning * into v_row;
  return v_row;
end $$;

create or replace function private.invite_rate_limited(p_client uuid) returns boolean
language sql volatile security definer set search_path = pg_catalog, private as $$
  select count(*) >= 5 from private.invite_code_attempts
   where client_id=p_client and not success and attempted_at > clock_timestamp()-interval '1 hour';
$$;

create or replace function public.preview_dietitian_invite_code(p_code text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('client'); v_code public.dietitian_invite_codes; v_profile record;
begin
  perform pg_advisory_xact_lock(hashtext(v_actor::text));
  if private.invite_rate_limited(v_actor) then return jsonb_build_object('result','rate_limited'); end if;
  select * into v_code from public.dietitian_invite_codes where normalized_code=private.normalize_invite_code(p_code) for share;
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
  select * into v_code from public.dietitian_invite_codes where normalized_code=private.normalize_invite_code(p_code) for share;
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

create or replace function public.leave_my_dietitian() returns text
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('client'); v_row public.dietitian_clients;
begin
  perform pg_advisory_xact_lock(hashtext(v_actor::text));
  select * into v_row from public.dietitian_clients where client_id=v_actor and status='active' for update;
  if not found then return 'not_connected'; end if;
  perform pg_advisory_xact_lock(hashtext('dietitian_client_capacity:' || v_row.dietitian_id::text));
  update public.dietitian_clients set status='removed' where id=v_row.id;
  return 'left';
end $$;

create or replace function private.notify_dietitian_client_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
begin
  if tg_op = 'INSERT' then
    if new.status = 'pending'::public.client_status and auth.uid() is distinct from new.client_id then
      perform private.upsert_notification_aggregate(
        p_recipient_id => new.client_id,
        p_category => 'relationship',
        p_event_type => 'request_pending',
        p_aggregation_key => format('relationship:%s', new.id),
        p_summary_key => 'relationship_request_pending',
        p_actor_id => new.dietitian_id,
        p_dietitian_client_id => new.id,
        p_relationship_to_status => new.status,
        p_occurred_at => now()
      );
    end if;
    return new;
  end if;

  if old.status is not distinct from new.status then
    return new;
  end if;

  if old.status = 'pending'::public.client_status
     and new.status = 'active'::public.client_status then
    perform private.upsert_notification_aggregate(
      p_recipient_id => old.dietitian_id,
      p_category => 'relationship',
      p_event_type => 'accepted',
      p_aggregation_key => format('relationship:%s', new.id),
      p_summary_key => 'relationship_accepted',
      p_actor_id => old.client_id,
      p_dietitian_client_id => new.id,
      p_relationship_from_status => old.status,
      p_relationship_to_status => new.status,
      p_occurred_at => now()
    );
  elsif old.status = 'pending'::public.client_status
        and new.status = 'rejected'::public.client_status then
    perform private.upsert_notification_aggregate(
      p_recipient_id => old.dietitian_id,
      p_category => 'relationship',
      p_event_type => 'rejected',
      p_aggregation_key => format('relationship:%s', new.id),
      p_summary_key => 'relationship_rejected',
      p_actor_id => old.client_id,
      p_dietitian_client_id => new.id,
      p_relationship_from_status => old.status,
      p_relationship_to_status => new.status,
      p_occurred_at => now()
    );
  elsif old.status = 'active'::public.client_status
        and new.status = 'removed'::public.client_status then
    perform private.upsert_notification_aggregate(
      p_recipient_id => case when auth.uid() = old.client_id then old.dietitian_id else old.client_id end,
      p_category => 'relationship',
      p_event_type => 'removed',
      p_aggregation_key => format('relationship:%s', new.id),
      p_summary_key => 'relationship_removed',
      p_actor_id => case when auth.uid() = old.client_id then old.client_id else old.dietitian_id end,
      p_dietitian_client_id => new.id,
      p_relationship_from_status => old.status,
      p_relationship_to_status => new.status,
      p_occurred_at => now()
    );
  elsif old.status in ('rejected'::public.client_status, 'removed'::public.client_status)
        and new.status = 'pending'::public.client_status and auth.uid() is distinct from new.client_id then
    perform private.upsert_notification_aggregate(
      p_recipient_id => new.client_id,
      p_category => 'relationship',
      p_event_type => 'request_pending',
      p_aggregation_key => format('relationship:%s', new.id),
      p_summary_key => 'relationship_request_pending',
      p_actor_id => new.dietitian_id,
      p_dietitian_client_id => new.id,
      p_relationship_from_status => old.status,
      p_relationship_to_status => new.status,
      p_occurred_at => now()
    );
  end if;

  return new;
end
$function$;

-- RLS continues to allow legacy approval; it never allows tenant reassignment.
create or replace function private.guard_relationship_identity() returns trigger
language plpgsql set search_path = pg_catalog as $$
begin
  if new.id is distinct from old.id or new.dietitian_id is distinct from old.dietitian_id
    or new.client_id is distinct from old.client_id or new.created_at is distinct from old.created_at then
    raise exception 'Relationship identity is immutable' using errcode='42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_guard_relationship_identity on public.dietitian_clients;
create trigger trg_guard_relationship_identity before update on public.dietitian_clients for each row execute function private.guard_relationship_identity();

create or replace function private.cleanup_invite_code_attempts() returns bigint
language plpgsql security definer set search_path = pg_catalog, private as $$
declare v_count bigint;
begin
  delete from private.invite_code_attempts where attempted_at < clock_timestamp()-interval '24 hours';
  get diagnostics v_count = row_count; return v_count;
end $$;
-- Existing pg_cron infrastructure; rescheduling this named job is repeat-safe.
do $$ begin
  if exists(select 1 from pg_namespace where nspname='cron') then
    perform cron.schedule('cleanup-invite-code-attempts','17 * * * *','select private.cleanup_invite_code_attempts()');
  else raise exception 'Invite attempts cleanup requires pg_cron';
  end if;
end $$;

revoke all on function private.normalize_invite_code(text), private.generate_invite_code(),private.require_invite_actor(text),
  private.invite_rate_limited(uuid), private.guard_relationship_identity(),private.cleanup_invite_code_attempts() from public, anon, authenticated;
revoke all on function public.get_my_invite_code(), public.rotate_my_invite_code(),public.set_my_invite_code_open(boolean),
  public.preview_dietitian_invite_code(text),public.redeem_dietitian_invite_code(text),public.leave_my_dietitian() from public, anon;
grant execute on function public.get_my_invite_code(), public.rotate_my_invite_code(),public.set_my_invite_code_open(boolean),
  public.preview_dietitian_invite_code(text),public.redeem_dietitian_invite_code(text),public.leave_my_dietitian() to authenticated;

commit;
