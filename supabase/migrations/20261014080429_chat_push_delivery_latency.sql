-- Keep source eligibility, health, ownership, unread and supersession guards unchanged.
-- Restored historical worker migrations are already applied in production; do not replay them.
begin;
CREATE OR REPLACE FUNCTION private.capture_push_occurrence()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public', 'private'
AS $function$
declare
  v_occurrence_id uuid;
  v_available_at timestamptz := now();
begin
  if not private.is_push_eligible_notification(
    new.category,
    new.event_type,
    new.summary_key
  ) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and not (
       new.event_count > old.event_count
       or (
         old.read_at is not null
         and new.read_at is null
         and new.occurred_at is distinct from old.occurred_at
         and new.event_count = 1
       )
     ) then
    return new;
  end if;

  if new.category = 'chat_message' then
    v_available_at := now() + interval '3 seconds';
  end if;

  insert into private.push_occurrences (
    notification_id,
    recipient_id,
    category,
    event_type,
    aggregation_key,
    summary_key,
    occurred_at,
    event_count
  ) values (
    new.id,
    new.recipient_id,
    new.category,
    new.event_type,
    new.aggregation_key,
    new.summary_key,
    new.occurred_at,
    new.event_count
  )
  on conflict (notification_id, occurred_at, event_count, event_type) do nothing
  returning id into v_occurrence_id;

  if v_occurrence_id is null then
    return new;
  end if;

  insert into private.push_deliveries (
    occurrence_id,
    notification_id,
    recipient_id,
    installation_id,
    status,
    available_at,
    next_attempt_at
  )
  select
    v_occurrence_id,
    new.id,
    new.recipient_id,
    installation.id,
    'pending',
    v_available_at,
    v_available_at
  from private.push_installations as installation
  where installation.enabled
    and installation.user_id = new.recipient_id
  on conflict (occurrence_id, installation_id) do nothing;

  return new;
end
$function$;

create or replace function public.claim_push_dispatch(p_kind text, p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_claim uuid:=gen_random_uuid(); v_result jsonb; v_next timestamptz;
begin
 if p_kind is null or p_kind not in ('send','receipt') then raise exception 'Invalid dispatch kind'; end if;
 if not exists(select 1 from private.push_dispatch_settings where singleton and enabled) then
  return '[]'::jsonb;
 end if;
 -- A timed-out send may already have reached Expo: never resend automatically.
 update private.push_deliveries set status='permanent',failed_at=now(),
  last_error_code='ambiguous_delivery',last_error_detail=null,claim_id=null
 where status='claimed' and claim_expires_at<now();
 update private.push_deliveries d set status='disabled',last_error_code='source_unavailable',
  last_error_detail=null,failed_at=now()
 where d.status in ('pending','retryable') and not private.push_dispatch_current(d.id);
 if p_kind='send' then
  -- Serialize the short dispatch budget across concurrent worker invocations.
  select next_dispatch_at into v_next from private.push_dispatch_settings where singleton for update;
  if v_next>now() then return '[]'::jsonb; end if;
  update private.push_dispatch_settings set next_dispatch_at=now()+interval '5 seconds' where singleton;
  with candidates as (
   select d.id from private.push_deliveries d
   where d.status in ('pending','retryable') and d.available_at<=now() and d.next_attempt_at<=now()
    and d.attempt_count<5 and private.push_dispatch_current(d.id)
   order by d.available_at,d.id for update skip locked
   limit greatest(1,least(coalesce(p_limit,25),25))
  ), claimed as (
   update private.push_deliveries d set status='claimed',claim_id=v_claim,
    claimed_at=now(),claim_expires_at=now()+interval '2 minutes',attempt_count=attempt_count+1
   from candidates c where d.id=c.id returning d.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'claimId',d.claim_id,
    'notificationId',d.notification_id,'category',o.category,'token',i.expo_push_token,'appVersion',i.app_version,
    'conversationId',(select n.conversation_id from public.notifications n where n.id=d.notification_id))), '[]'::jsonb)
   into v_result from claimed d join private.push_installations i on i.id=d.installation_id
   join private.push_occurrences o on o.id=d.occurrence_id;
 else
  with candidates as (
   select d.id from private.push_deliveries d
   where d.status='ticketed' and d.receipt_next_check_at<=now()
    and (d.claim_expires_at is null or d.claim_expires_at<now())
   order by d.receipt_next_check_at,d.id for update skip locked
   limit greatest(1,least(coalesce(p_limit,25),25))
  ), claimed as (
   update private.push_deliveries d set claim_id=v_claim,claim_expires_at=now()+interval '2 minutes'
   from candidates c where d.id=c.id returning d.*
  ) select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'claimId',d.claim_id,
    'ticketId',d.expo_ticket_id)), '[]'::jsonb) into v_result from claimed d;
 end if;
 return v_result;
end $$;
create or replace function private.invoke_push_dispatch() returns bigint
language plpgsql security definer set search_path=''
as $fn$
declare v_url text; v_secret text; response extensions.http_response;
begin
 if not exists(select 1 from private.push_dispatch_settings where singleton and enabled) then
  return null;
 end if;
 -- Avoid idle HTTP invocations while retaining send, receipt and expired-claim cleanup.
 if not exists(select 1 from private.push_deliveries
   where (status in ('pending','retryable') and available_at<=now() and next_attempt_at<=now())
     or (status='ticketed' and receipt_next_check_at<=now()
       and (claim_expires_at is null or claim_expires_at<now()))
     or (status='claimed' and claim_expires_at<now())) then
  return null;
 end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='dietbridge_push_project_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='dietbridge_push_dispatch_secret';
 if v_url is null or v_url !~ '^https://[a-z0-9]{20}[.]supabase[.]co$'
  or v_secret is null or char_length(v_secret) not between 32 and 512 then
  raise exception 'Push scheduler configuration missing or invalid';
 end if;
 begin
  -- The installed http 1.6 exposes C option functions, not newer GUC names.
  if not extensions.http_reset_curlopt()
   or not extensions.http_set_curlopt('CURLOPT_TIMEOUT_MS','30000')
   or not extensions.http_set_curlopt('CURLOPT_CONNECTTIMEOUT','5') then
   raise exception 'Push HTTP timeout configuration failed';
  end if;
  select * into response from extensions.http(row('POST',v_url||'/functions/v1/dispatch-push',
   array[row('x-dispatch-secret',v_secret)::extensions.http_header],
   'application/json','{}')::extensions.http_request);
  perform extensions.http_reset_curlopt();
 exception when others then
  perform extensions.http_reset_curlopt();
  -- Do not include libcurl messages, response bodies, headers or credentials.
  raise exception 'Push scheduler HTTP request failed' using errcode='58000';
 end;
 if response.status is distinct from 200 then
  raise exception 'Push scheduler returned an unsuccessful status' using errcode='58000';
 end if;
 return response.status::bigint;
end $fn$;
revoke all on function private.invoke_push_dispatch() from public,anon,authenticated,service_role;

-- Prevent a historical minute budget from delaying the first short-interval run.
update private.push_dispatch_settings set next_dispatch_at=least(next_dispatch_at,now()) where singleton;
-- Idempotent named schedule; no secret is embedded in cron job text.
select cron.schedule('dietbridge-push-dispatch','10 seconds','select private.invoke_push_dispatch();');
commit;

