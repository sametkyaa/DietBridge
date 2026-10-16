-- Dietitian directory, pre-connection inquiries and client-initiated
-- connection requests. Clients without an active dietitian can browse listed,
-- approved dietitians, message up to three of them and send one connection
-- request at a time. Existing chat, invite code and relationship contracts are
-- untouched: inquiries live in their own tables and an accepted request goes
-- through the same pending -> active dietitian_clients transition as redeem.
-- Production application requires explicit approval. Repeat application is safe.
begin;

do $$ begin
  if to_regclass('public.dietitian_profiles') is null
    or to_regclass('public.dietitian_clients') is null
    or to_regclass('public.notifications') is null
    or to_regprocedure('private.require_invite_actor(text)') is null
    or to_regprocedure('public.dietitian_active_client_usage(uuid)') is null
    or to_regprocedure('public.dietitian_effective_client_limit(uuid)') is null
    or to_regprocedure('private.upsert_notification_aggregate(uuid,text,text,text,text,uuid,uuid,uuid,uuid,text,date,time without time zone,text,public.client_status,public.client_status,timestamptz)') is null then
    raise exception 'Dietitian directory prerequisites missing';
  end if;
end $$;

-- Profile fields. Dietitians already update their own non-system fields
-- through the existing RLS policy; listing is opt-in and defaults to hidden.
create or replace function public.dietitian_social_links_valid(p_links jsonb) returns boolean
language sql immutable set search_path = pg_catalog as $$
  select jsonb_typeof(p_links) = 'object'
    and (select count(*) from jsonb_object_keys(p_links)) <= 6
    and not exists (
      select 1 from jsonb_each(p_links) as e(key, value)
      where e.key not in ('instagram','tiktok','youtube','linkedin','x','website')
        or jsonb_typeof(e.value) <> 'string'
        or char_length(e.value #>> '{}') > 200
        or (e.value #>> '{}') !~ '^https://[^\s/?#@]+(/[^\s]*)?$'
        or (e.key = 'instagram' and (e.value #>> '{}') !~* '^https://(www\.)?instagram\.com/')
        or (e.key = 'tiktok' and (e.value #>> '{}') !~* '^https://(www\.)?tiktok\.com/')
        or (e.key = 'youtube' and (e.value #>> '{}') !~* '^https://((www|m)\.)?(youtube\.com|youtu\.be)/')
        or (e.key = 'linkedin' and (e.value #>> '{}') !~* '^https://([a-z]{2,3}\.)?linkedin\.com/')
        or (e.key = 'x' and (e.value #>> '{}') !~* '^https://(www\.)?(x\.com|twitter\.com)/')
    );
$$;
-- Public because the CHECK constraint runs as the updating dietitian, who has
-- no access to the private schema. It is a pure validator with no data access.
revoke all on function public.dietitian_social_links_valid(jsonb) from public, anon;
grant execute on function public.dietitian_social_links_valid(jsonb) to authenticated;

alter table public.dietitian_profiles add column if not exists is_publicly_listed boolean not null default false;
alter table public.dietitian_profiles add column if not exists social_links jsonb not null default '{}'::jsonb;
do $$ begin
  if not exists(select 1 from pg_constraint where conrelid='public.dietitian_profiles'::regclass and conname='dietitian_profiles_social_links_check') then
    alter table public.dietitian_profiles add constraint dietitian_profiles_social_links_check
      check (public.dietitian_social_links_valid(social_links));
  end if;
end $$;

create or replace function private.is_approved_dietitian(p_dietitian_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.dietitian_profiles dp join public.profiles p on p.id=dp.user_id
    where dp.user_id=p_dietitian_id and dp.verification_status='approved' and dp.is_verified is true and p.role::text='dietitian');
$$;
create or replace function private.is_public_dietitian(p_dietitian_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, private as $$
  select private.is_approved_dietitian(p_dietitian_id)
    and exists(select 1 from public.dietitian_profiles where user_id=p_dietitian_id and is_publicly_listed);
$$;
revoke all on function private.is_approved_dietitian(uuid), private.is_public_dietitian(uuid) from public, anon, authenticated;

-- Inquiries: one row per client/dietitian pair. Only participants can read;
-- every write goes through the RPCs below.
create table if not exists public.dietitian_inquiries (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  dietitian_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'open',
  closed_by uuid references public.profiles(id) on delete set null,
  closed_reason text,
  last_message_at timestamptz,
  last_message_sender_id uuid references public.profiles(id) on delete set null,
  client_last_read_at timestamptz,
  dietitian_last_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dietitian_inquiries_pair_key unique (client_id, dietitian_id),
  constraint dietitian_inquiries_distinct_check check (client_id <> dietitian_id),
  constraint dietitian_inquiries_status_check check (status in ('open','closed','connected')),
  constraint dietitian_inquiries_closed_reason_check check (closed_reason is null or closed_reason in ('client','dietitian','connected_elsewhere'))
);
create index if not exists dietitian_inquiries_dietitian_idx on public.dietitian_inquiries(dietitian_id, last_message_at desc);
create index if not exists dietitian_inquiries_client_open_idx on public.dietitian_inquiries(client_id) where status='open';

create table if not exists public.dietitian_inquiry_messages (
  id uuid primary key default gen_random_uuid(),
  inquiry_id uuid not null references public.dietitian_inquiries(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  client_message_id uuid not null,
  body text not null,
  created_at timestamptz not null default now(),
  constraint dietitian_inquiry_messages_body_check check (char_length(btrim(body)) between 1 and 1000),
  constraint dietitian_inquiry_messages_idempotency_key unique (sender_id, client_message_id)
);
create index if not exists dietitian_inquiry_messages_inquiry_idx on public.dietitian_inquiry_messages(inquiry_id, created_at);
create index if not exists dietitian_inquiry_messages_sender_recent_idx on public.dietitian_inquiry_messages(sender_id, created_at);

-- Client-initiated connection requests. dietitian_clients.pending keeps its
-- current meaning (a dietitian asked the client), so this is a separate table.
create table if not exists public.dietitian_connection_requests (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.profiles(id) on delete cascade,
  dietitian_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending',
  note text,
  dietitian_client_id uuid references public.dietitian_clients(id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  constraint dietitian_connection_requests_distinct_check check (client_id <> dietitian_id),
  constraint dietitian_connection_requests_status_check check (status in ('pending','accepted','declined','cancelled')),
  constraint dietitian_connection_requests_note_check check (note is null or char_length(note) <= 500)
);
create unique index if not exists dietitian_connection_requests_one_pending_per_client
  on public.dietitian_connection_requests(client_id) where status='pending';
create index if not exists dietitian_connection_requests_dietitian_idx
  on public.dietitian_connection_requests(dietitian_id, created_at desc) where status='pending';

alter table public.dietitian_inquiries enable row level security;
alter table public.dietitian_inquiry_messages enable row level security;
alter table public.dietitian_connection_requests enable row level security;

drop policy if exists "Participants can select inquiries" on public.dietitian_inquiries;
create policy "Participants can select inquiries" on public.dietitian_inquiries for select to authenticated
  using (client_id = auth.uid() or (dietitian_id = auth.uid() and public.is_current_user_dietitian()));
drop policy if exists "Participants can select inquiry messages" on public.dietitian_inquiry_messages;
create policy "Participants can select inquiry messages" on public.dietitian_inquiry_messages for select to authenticated
  using (exists(select 1 from public.dietitian_inquiries i where i.id = inquiry_id
    and (i.client_id = auth.uid() or (i.dietitian_id = auth.uid() and public.is_current_user_dietitian()))));
drop policy if exists "Participants can select connection requests" on public.dietitian_connection_requests;
create policy "Participants can select connection requests" on public.dietitian_connection_requests for select to authenticated
  using (client_id = auth.uid() or (dietitian_id = auth.uid() and public.is_current_user_dietitian()));

revoke all on table public.dietitian_inquiries, public.dietitian_inquiry_messages, public.dietitian_connection_requests from public, anon, authenticated;
grant select on table public.dietitian_inquiries, public.dietitian_inquiry_messages, public.dietitian_connection_requests to authenticated;

-- Directory reads. Only public profile fields are returned: no e-mail, phone,
-- diploma, verification details or storage paths.
create or replace function public.list_public_dietitians(p_search text default null, p_limit integer default 20, p_offset integer default 0)
returns table(id uuid, display_name text, specialization text, experience_years integer, university text, bio text, social_links jsonb)
language plpgsql stable security definer set search_path = pg_catalog, public, private as $$
declare
  v_actor uuid := private.require_invite_actor('client');
  v_search text := nullif(btrim(left(coalesce(p_search, ''), 80)), '');
  v_pattern text;
begin
  if v_search is not null then
    v_pattern := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  return query
    select p.id, nullif(btrim(p.full_name), ''), dp.specialization, dp.experience_years, dp.university, dp.bio, dp.social_links
      from public.dietitian_profiles dp
      join public.profiles p on p.id = dp.user_id
     where dp.is_publicly_listed and dp.verification_status = 'approved' and dp.is_verified is true and p.role::text = 'dietitian'
       and (v_pattern is null or p.full_name ilike v_pattern or dp.specialization ilike v_pattern)
     order by dp.verified_at desc nulls last, p.id
     limit least(greatest(coalesce(p_limit, 20), 1), 50)
     offset least(greatest(coalesce(p_offset, 0), 0), 1000);
end $$;

create or replace function public.get_public_dietitian(p_dietitian_id uuid) returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('client'); v_row record;
begin
  -- An unlisted dietitian stays visible only to clients who already have an
  -- inquiry or request with them, so existing conversations keep a header.
  if not (private.is_public_dietitian(p_dietitian_id)
    or (private.is_approved_dietitian(p_dietitian_id) and (
      exists(select 1 from public.dietitian_inquiries where client_id=v_actor and dietitian_id=p_dietitian_id)
      or exists(select 1 from public.dietitian_connection_requests where client_id=v_actor and dietitian_id=p_dietitian_id)))) then
    return null;
  end if;
  select p.id, nullif(btrim(p.full_name), '') as display_name, dp.specialization, dp.experience_years, dp.university,
         dp.graduation_year, dp.bio, dp.social_links, dp.is_publicly_listed
    into v_row
    from public.dietitian_profiles dp join public.profiles p on p.id = dp.user_id
   where dp.user_id = p_dietitian_id;
  return jsonb_build_object('id', v_row.id, 'display_name', v_row.display_name, 'specialization', v_row.specialization,
    'experience_years', v_row.experience_years, 'university', v_row.university, 'graduation_year', v_row.graduation_year,
    'bio', v_row.bio, 'social_links', v_row.social_links, 'is_listed', v_row.is_publicly_listed);
end $$;

-- Avatar paths for the signing edge function. Same visibility as above.
create or replace function public.get_public_dietitian_avatar_paths(p_dietitian_ids uuid[])
returns table(id uuid, avatar_path text)
language plpgsql stable security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('client');
begin
  if coalesce(cardinality(p_dietitian_ids), 0) > 50 then
    raise exception 'Too many dietitians requested' using errcode = '22023';
  end if;
  return query
    select p.id, p.avatar_url
      from public.profiles p
     where p.id = any(coalesce(p_dietitian_ids, '{}'::uuid[]))
       and p.avatar_url is not null
       and (private.is_public_dietitian(p.id)
         or (private.is_approved_dietitian(p.id) and (
           exists(select 1 from public.dietitian_inquiries i where i.client_id=v_actor and i.dietitian_id=p.id)
           or exists(select 1 from public.dietitian_connection_requests r where r.client_id=v_actor and r.dietitian_id=p.id))));
end $$;

-- Shared guards.
create or replace function private.inquiry_actor() returns uuid
language plpgsql stable security definer set search_path = pg_catalog, public as $$
declare v_actor uuid := auth.uid(); v_role text;
begin
  select role::text into v_role from public.profiles where id = v_actor;
  if v_actor is null or v_role is null or v_role not in ('client','dietitian')
    or (v_role = 'dietitian' and not private.is_approved_dietitian(v_actor)) then
    raise exception 'Inquiry access denied' using errcode = '42501';
  end if;
  return v_actor;
end $$;
create or replace function private.inquiry_sender_rate_limited(p_sender uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select count(*) >= 30 from public.dietitian_inquiry_messages
   where sender_id = p_sender and created_at > now() - interval '1 hour';
$$;
create or replace function private.client_has_active_dietitian(p_client uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public as $$
  select exists(select 1 from public.dietitian_clients where client_id = p_client and status = 'active');
$$;
revoke all on function private.inquiry_actor(), private.inquiry_sender_rate_limited(uuid), private.client_has_active_dietitian(uuid)
  from public, anon, authenticated;

create or replace function private.insert_inquiry_message(p_inquiry public.dietitian_inquiries, p_sender uuid, p_body text, p_client_message_id uuid)
returns uuid language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_id uuid; v_at timestamptz := clock_timestamp();
begin
  -- clock_timestamp keeps message order and read marks strictly increasing
  -- even when several messages are written in one transaction.
  insert into public.dietitian_inquiry_messages(inquiry_id, sender_id, client_message_id, body, created_at)
    values (p_inquiry.id, p_sender, p_client_message_id, btrim(p_body), v_at)
    returning id into v_id;
  update public.dietitian_inquiries
     set last_message_at = v_at, last_message_sender_id = p_sender, updated_at = v_at,
         client_last_read_at = case when p_sender = client_id then v_at else client_last_read_at end,
         dietitian_last_read_at = case when p_sender = dietitian_id then v_at else dietitian_last_read_at end
   where id = p_inquiry.id;
  return v_id;
end $$;
revoke all on function private.insert_inquiry_message(public.dietitian_inquiries, uuid, text, uuid) from public, anon, authenticated;

-- Client starts (or continues) an inquiry with its first message.
-- Results: started | sent | duplicate | not_found | closed | limit_reached |
-- has_dietitian | rate_limited | invalid
create or replace function public.start_dietitian_inquiry(p_dietitian_id uuid, p_body text, p_client_message_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_actor uuid := private.require_invite_actor('client');
  v_inquiry public.dietitian_inquiries;
  v_existing_message uuid;
  v_existing_inquiry uuid;
  v_message uuid;
  v_result text := 'sent';
begin
  if p_client_message_id is null or char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    return jsonb_build_object('result', 'invalid');
  end if;
  perform pg_advisory_xact_lock(hashtext('dietitian_inquiry_client:' || v_actor::text));
  select m.id, m.inquiry_id into v_existing_message, v_existing_inquiry
    from public.dietitian_inquiry_messages m where m.sender_id = v_actor and m.client_message_id = p_client_message_id;
  if v_existing_message is not null then
    return jsonb_build_object('result', 'duplicate', 'inquiry_id', v_existing_inquiry, 'message_id', v_existing_message);
  end if;
  if private.client_has_active_dietitian(v_actor) then return jsonb_build_object('result', 'has_dietitian'); end if;
  if private.inquiry_sender_rate_limited(v_actor) then return jsonb_build_object('result', 'rate_limited'); end if;

  select * into v_inquiry from public.dietitian_inquiries where client_id = v_actor and dietitian_id = p_dietitian_id for update;
  if v_inquiry.id is not null and v_inquiry.status = 'open' then
    if not private.is_approved_dietitian(p_dietitian_id) then return jsonb_build_object('result', 'not_found'); end if;
  else
    if not private.is_public_dietitian(p_dietitian_id) then return jsonb_build_object('result', 'not_found'); end if;
    if v_inquiry.id is not null and (v_inquiry.status = 'connected' or v_inquiry.closed_reason = 'dietitian') then
      return jsonb_build_object('result', 'closed', 'inquiry_id', v_inquiry.id);
    end if;
    if (select count(*) from public.dietitian_inquiries where client_id = v_actor and status = 'open') >= 3 then
      return jsonb_build_object('result', 'limit_reached');
    end if;
    if v_inquiry.id is null then
      insert into public.dietitian_inquiries(client_id, dietitian_id) values (v_actor, p_dietitian_id) returning * into v_inquiry;
    else
      update public.dietitian_inquiries set status = 'open', closed_by = null, closed_reason = null, updated_at = now()
       where id = v_inquiry.id returning * into v_inquiry;
    end if;
    v_result := 'started';
  end if;

  v_message := private.insert_inquiry_message(v_inquiry, v_actor, p_body, p_client_message_id);
  return jsonb_build_object('result', v_result, 'inquiry_id', v_inquiry.id, 'message_id', v_message);
end $$;

-- Either participant sends a message on an open inquiry.
-- Results: sent | duplicate | not_found | closed | rate_limited | invalid
create or replace function public.send_dietitian_inquiry_message(p_inquiry_id uuid, p_body text, p_client_message_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_actor uuid := private.inquiry_actor();
  v_inquiry public.dietitian_inquiries;
  v_existing_message uuid;
  v_message uuid;
begin
  if p_client_message_id is null or char_length(btrim(coalesce(p_body, ''))) not between 1 and 1000 then
    return jsonb_build_object('result', 'invalid');
  end if;
  select * into v_inquiry from public.dietitian_inquiries where id = p_inquiry_id for update;
  if v_inquiry.id is null or v_actor not in (v_inquiry.client_id, v_inquiry.dietitian_id) then
    return jsonb_build_object('result', 'not_found');
  end if;
  select id into v_existing_message from public.dietitian_inquiry_messages where sender_id = v_actor and client_message_id = p_client_message_id;
  if v_existing_message is not null then
    return jsonb_build_object('result', 'duplicate', 'inquiry_id', v_inquiry.id, 'message_id', v_existing_message);
  end if;
  if v_inquiry.status <> 'open' then return jsonb_build_object('result', 'closed', 'inquiry_id', v_inquiry.id); end if;
  if v_actor = v_inquiry.client_id and private.client_has_active_dietitian(v_actor) then
    return jsonb_build_object('result', 'closed', 'inquiry_id', v_inquiry.id);
  end if;
  if private.inquiry_sender_rate_limited(v_actor) then return jsonb_build_object('result', 'rate_limited'); end if;
  v_message := private.insert_inquiry_message(v_inquiry, v_actor, p_body, p_client_message_id);
  return jsonb_build_object('result', 'sent', 'inquiry_id', v_inquiry.id, 'message_id', v_message);
end $$;

-- Results: closed | not_found
create or replace function public.close_dietitian_inquiry(p_inquiry_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.inquiry_actor(); v_inquiry public.dietitian_inquiries;
begin
  select * into v_inquiry from public.dietitian_inquiries where id = p_inquiry_id for update;
  if v_inquiry.id is null or v_actor not in (v_inquiry.client_id, v_inquiry.dietitian_id) then return 'not_found'; end if;
  if v_inquiry.status = 'open' then
    update public.dietitian_inquiries
       set status = 'closed', closed_by = v_actor, updated_at = now(),
           closed_reason = case when v_actor = v_inquiry.client_id then 'client' else 'dietitian' end
     where id = v_inquiry.id;
  end if;
  return 'closed';
end $$;

create or replace function public.mark_dietitian_inquiry_read(p_inquiry_id uuid) returns void
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.inquiry_actor();
begin
  update public.dietitian_inquiries
     set client_last_read_at = case when v_actor = client_id then clock_timestamp() else client_last_read_at end,
         dietitian_last_read_at = case when v_actor = dietitian_id then clock_timestamp() else dietitian_last_read_at end
   where id = p_inquiry_id and v_actor in (client_id, dietitian_id);
end $$;

-- Inquiry list with the counterpart's display name. Clients and dietitians
-- cannot read each other's profiles before connecting, so names come from here.
create or replace function public.list_my_dietitian_inquiries()
returns table(id uuid, client_id uuid, dietitian_id uuid, counterpart_name text, status text, closed_reason text,
  last_message_at timestamptz, last_message_sender_id uuid, last_message_body text, unread_count integer, created_at timestamptz)
language plpgsql stable security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.inquiry_actor();
begin
  return query
    select i.id, i.client_id, i.dietitian_id,
           nullif(btrim(p.full_name), ''),
           i.status, i.closed_reason, i.last_message_at, i.last_message_sender_id,
           (select left(m.body, 160) from public.dietitian_inquiry_messages m where m.inquiry_id = i.id order by m.created_at desc, m.id desc limit 1),
           (select count(*)::integer from public.dietitian_inquiry_messages m
             where m.inquiry_id = i.id and m.sender_id <> v_actor
               and m.created_at > coalesce(case when v_actor = i.client_id then i.client_last_read_at else i.dietitian_last_read_at end, '-infinity'::timestamptz)),
           i.created_at
      from public.dietitian_inquiries i
      join public.profiles p on p.id = case when v_actor = i.client_id then i.dietitian_id else i.client_id end
     where v_actor in (i.client_id, i.dietitian_id)
     order by coalesce(i.last_message_at, i.created_at) desc
     limit 200;
end $$;

-- Client sends one connection request at a time.
-- Results: sent | already_pending | has_pending | has_dietitian | dietitian_invited | not_found | invalid
create or replace function public.send_dietitian_connection_request(p_dietitian_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_actor uuid := private.require_invite_actor('client');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_pending public.dietitian_connection_requests;
  v_request public.dietitian_connection_requests;
begin
  if v_note is not null and char_length(v_note) > 500 then return jsonb_build_object('result', 'invalid'); end if;
  perform pg_advisory_xact_lock(hashtext(v_actor::text));
  if private.client_has_active_dietitian(v_actor) then return jsonb_build_object('result', 'has_dietitian'); end if;
  select * into v_pending from public.dietitian_connection_requests where client_id = v_actor and status = 'pending' for update;
  if v_pending.id is not null then
    return jsonb_build_object('result', case when v_pending.dietitian_id = p_dietitian_id then 'already_pending' else 'has_pending' end,
      'request_id', v_pending.id);
  end if;
  if not (private.is_public_dietitian(p_dietitian_id)
    or (private.is_approved_dietitian(p_dietitian_id)
      and exists(select 1 from public.dietitian_inquiries where client_id = v_actor and dietitian_id = p_dietitian_id and status = 'open'))) then
    return jsonb_build_object('result', 'not_found');
  end if;
  if exists(select 1 from public.dietitian_clients where client_id = v_actor and dietitian_id = p_dietitian_id and status = 'pending') then
    return jsonb_build_object('result', 'dietitian_invited');
  end if;
  insert into public.dietitian_connection_requests(client_id, dietitian_id, note)
    values (v_actor, p_dietitian_id, v_note) returning * into v_request;
  return jsonb_build_object('result', 'sent', 'request_id', v_request.id);
end $$;

-- Results: cancelled | not_found
create or replace function public.cancel_dietitian_connection_request(p_request_id uuid) returns text
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('client');
begin
  update public.dietitian_connection_requests set status = 'cancelled', responded_at = now()
   where id = p_request_id and client_id = v_actor and status = 'pending';
  if not found then return 'not_found'; end if;
  return 'cancelled';
end $$;

-- Pending requests for the dietitian panel, with the client's display name.
create or replace function public.list_my_dietitian_connection_requests()
returns table(id uuid, client_id uuid, client_name text, note text, created_at timestamptz, inquiry_id uuid)
language plpgsql stable security definer set search_path = pg_catalog, public, private as $$
declare v_actor uuid := private.require_invite_actor('dietitian');
begin
  return query
    select r.id, r.client_id, nullif(btrim(p.full_name), ''), r.note, r.created_at,
           (select i.id from public.dietitian_inquiries i where i.client_id = r.client_id and i.dietitian_id = v_actor)
      from public.dietitian_connection_requests r
      join public.profiles p on p.id = r.client_id
     where r.dietitian_id = v_actor and r.status = 'pending'
     order by r.created_at
     limit 200;
end $$;

-- Dietitian accepts or declines. Accept uses the same checks and the same
-- pending -> active transition as redeem_dietitian_invite_code.
-- Results: accepted | declined | not_found | client_has_dietitian | limit_reached
create or replace function public.respond_dietitian_connection_request(p_request_id uuid, p_accept boolean) returns text
language plpgsql security definer set search_path = pg_catalog, public, private as $$
declare
  v_actor uuid := private.require_invite_actor('dietitian');
  v_request public.dietitian_connection_requests;
  v_existing public.dietitian_clients;
begin
  select * into v_request from public.dietitian_connection_requests where id = p_request_id and dietitian_id = v_actor;
  if v_request.id is null then return 'not_found'; end if;
  perform pg_advisory_xact_lock(hashtext(v_request.client_id::text));
  select * into v_request from public.dietitian_connection_requests where id = p_request_id for update;
  if v_request.status <> 'pending' then return 'not_found'; end if;

  if not coalesce(p_accept, false) then
    update public.dietitian_connection_requests set status = 'declined', responded_at = now() where id = v_request.id;
    return 'declined';
  end if;

  perform pg_advisory_xact_lock(hashtext('dietitian_client_capacity:' || v_actor::text));
  if private.client_has_active_dietitian(v_request.client_id) then return 'client_has_dietitian'; end if;
  select * into v_existing from public.dietitian_clients where client_id = v_request.client_id and dietitian_id = v_actor for update;
  if (v_existing.id is null or v_existing.status <> 'pending')
    and public.dietitian_active_client_usage(v_actor) >= public.dietitian_effective_client_limit(v_actor) then
    return 'limit_reached';
  end if;
  update public.dietitian_clients set status = 'removed'
   where client_id = v_request.client_id and dietitian_id <> v_actor and status = 'pending';
  if v_existing.id is null then
    insert into public.dietitian_clients(dietitian_id, client_id, status) values (v_actor, v_request.client_id, 'pending') returning * into v_existing;
  elsif v_existing.status in ('removed', 'rejected') then
    update public.dietitian_clients set status = 'pending' where id = v_existing.id;
  end if;
  update public.dietitian_clients set status = 'active' where id = v_existing.id;

  -- The relationship trigger writes notifications from the actor's point of
  -- view (a pending invite to the client, an "accepted" to the dietitian).
  -- Here the dietitian accepted, so only the client gets "accepted".
  delete from public.notifications where aggregation_key = format('relationship:%s', v_existing.id)
    and summary_key in ('relationship_request_pending', 'relationship_accepted');
  perform private.upsert_notification_aggregate(
    p_recipient_id => v_request.client_id,
    p_category => 'relationship',
    p_event_type => 'accepted',
    p_aggregation_key => format('relationship:%s', v_existing.id),
    p_summary_key => 'relationship_accepted',
    p_actor_id => v_actor,
    p_dietitian_client_id => v_existing.id,
    p_relationship_from_status => 'pending'::public.client_status,
    p_relationship_to_status => 'active'::public.client_status,
    p_occurred_at => now()
  );

  update public.dietitian_connection_requests set status = 'accepted', responded_at = now(), dietitian_client_id = v_existing.id
   where id = v_request.id;
  return 'accepted';
end $$;

-- Whatever path activates a relationship (invite code, dietitian request or a
-- connection request), the client's open inquiries and pending requests close.
create or replace function private.close_directory_state_on_activation() returns trigger
language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status = 'active'::public.client_status and old.status is distinct from new.status then
    update public.dietitian_inquiries
       set status = case when dietitian_id = new.dietitian_id then 'connected' else 'closed' end,
           closed_reason = case when dietitian_id = new.dietitian_id then null else 'connected_elsewhere' end,
           closed_by = null, updated_at = now()
     where client_id = new.client_id and status = 'open';
    update public.dietitian_inquiries set status = 'connected', closed_reason = null, closed_by = null, updated_at = now()
     where client_id = new.client_id and dietitian_id = new.dietitian_id and status = 'closed';
    update public.dietitian_connection_requests set status = 'cancelled', responded_at = now()
     where client_id = new.client_id and status = 'pending' and dietitian_id <> new.dietitian_id;
    update public.dietitian_connection_requests set status = 'accepted', responded_at = now(), dietitian_client_id = new.id
     where client_id = new.client_id and status = 'pending' and dietitian_id = new.dietitian_id;
  end if;
  return new;
end $$;
revoke all on function private.close_directory_state_on_activation() from public, anon, authenticated;
drop trigger if exists trg_close_directory_state_on_activation on public.dietitian_clients;
create trigger trg_close_directory_state_on_activation
  after update on public.dietitian_clients
  for each row execute function private.close_directory_state_on_activation();

alter function public.dietitian_social_links_valid(jsonb) owner to postgres;
alter function private.is_approved_dietitian(uuid) owner to postgres;
alter function private.is_public_dietitian(uuid) owner to postgres;
alter function private.inquiry_actor() owner to postgres;
alter function private.inquiry_sender_rate_limited(uuid) owner to postgres;
alter function private.client_has_active_dietitian(uuid) owner to postgres;
alter function private.insert_inquiry_message(public.dietitian_inquiries, uuid, text, uuid) owner to postgres;
alter function private.close_directory_state_on_activation() owner to postgres;

revoke all on function
  public.list_public_dietitians(text, integer, integer),
  public.get_public_dietitian(uuid),
  public.get_public_dietitian_avatar_paths(uuid[]),
  public.start_dietitian_inquiry(uuid, text, uuid),
  public.send_dietitian_inquiry_message(uuid, text, uuid),
  public.close_dietitian_inquiry(uuid),
  public.mark_dietitian_inquiry_read(uuid),
  public.list_my_dietitian_inquiries(),
  public.send_dietitian_connection_request(uuid, text),
  public.cancel_dietitian_connection_request(uuid),
  public.list_my_dietitian_connection_requests(),
  public.respond_dietitian_connection_request(uuid, boolean)
  from public, anon;
grant execute on function
  public.list_public_dietitians(text, integer, integer),
  public.get_public_dietitian(uuid),
  public.get_public_dietitian_avatar_paths(uuid[]),
  public.start_dietitian_inquiry(uuid, text, uuid),
  public.send_dietitian_inquiry_message(uuid, text, uuid),
  public.close_dietitian_inquiry(uuid),
  public.mark_dietitian_inquiry_read(uuid),
  public.list_my_dietitian_inquiries(),
  public.send_dietitian_connection_request(uuid, text),
  public.cancel_dietitian_connection_request(uuid),
  public.list_my_dietitian_connection_requests(),
  public.respond_dietitian_connection_request(uuid, boolean)
  to authenticated;

-- Realtime: participants receive inserts/updates through the select policies.
do $publication$
declare v_table_name text;
begin
  if exists(select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    foreach v_table_name in array array['dietitian_inquiries','dietitian_inquiry_messages','dietitian_connection_requests'] loop
      if not exists(select 1 from pg_catalog.pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=v_table_name) then
        execute format('alter publication supabase_realtime add table public.%I', v_table_name);
      end if;
    end loop;
  end if;
end
$publication$;

notify pgrst, 'reload schema';
commit;
