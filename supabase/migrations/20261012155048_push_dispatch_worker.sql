begin;

-- One-shot migration. Deliberately OFF until credentials and a native device
-- acceptance test are ready. No scheduler or secret is installed here.
do $$ begin
 if to_regprocedure('private.notification_health_allows(public.notifications,boolean)') is null then
  raise exception 'Health notification guard prerequisite missing';
 end if;
end $$;

create table private.push_dispatch_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 project_id uuid not null,
 next_dispatch_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
insert into private.push_dispatch_settings(singleton,project_id)
 values(true,'51259ad9-2efb-4393-9e40-8c22238a5cf8');
alter table private.push_dispatch_settings enable row level security;
revoke all on private.push_dispatch_settings from public,anon,authenticated,service_role;

alter table private.push_deliveries
 add column claim_id uuid,
 add column sent_token_sha256 text check(sent_token_sha256 is null or sent_token_sha256 ~ '^[a-f0-9]{64}$'),
 add column receipt_next_check_at timestamptz,
 add column receipt_poll_count integer not null default 0 check(receipt_poll_count between 0 and 100);

create index push_dispatch_receipt_due_idx on private.push_deliveries(receipt_next_check_at,id)
 where status='ticketed';

create function private.push_dispatch_current(p_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists (
  select 1 from private.push_deliveries d
  join private.push_installations i on i.id=d.installation_id
  join private.push_occurrences o on o.id=d.occurrence_id
  join public.notifications n on n.id=d.notification_id
  join private.push_dispatch_settings cfg on cfg.singleton
  where d.id=p_id and cfg.enabled and i.enabled and i.user_id=d.recipient_id
   and i.project_id=cfg.project_id and n.recipient_id=d.recipient_id
   and n.read_at is null and n.occurred_at=o.occurred_at and n.event_count=o.event_count
   and o.created_at>=now()-interval '1 hour'
   and n.event_type=o.event_type and private.notification_health_allows(n,false)
   and (n.category<>'chat_message' or exists (
    select 1 from public.chat_conversations c where c.id=n.conversation_id
     and d.recipient_id in (c.client_id,c.dietitian_id)
     and public.chat_has_active_relationship(c.dietitian_id,c.client_id)))
 );
$$;

create function public.claim_push_dispatch(p_kind text, p_limit integer default 25)
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
  -- Serialize the minute budget across concurrent worker invocations.
  select next_dispatch_at into v_next from private.push_dispatch_settings where singleton for update;
  if v_next>now() then return '[]'::jsonb; end if;
  update private.push_dispatch_settings set next_dispatch_at=now()+interval '1 minute' where singleton;
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
    'notificationId',d.notification_id,'category',o.category,'token',i.expo_push_token)), '[]'::jsonb)
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

-- Last eligibility check immediately before the provider request. A hash binds
-- any later DeviceNotRegistered receipt to the token actually sent, not a new one.
create function public.prepare_push_dispatch(p_id uuid,p_claim_id uuid,p_token_sha256 text)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_ok boolean;
begin
 if p_token_sha256 !~ '^[a-f0-9]{64}$' then raise exception 'Invalid token hash'; end if;
 select private.push_dispatch_current(d.id) and
  encode(extensions.digest(i.expo_push_token,'sha256'),'hex')=p_token_sha256 into v_ok
 from private.push_deliveries d join private.push_installations i on i.id=d.installation_id
 where d.id=p_id and d.claim_id=p_claim_id and d.status='claimed' and d.claim_expires_at>now()
 for update of d,i;
 if not found then return false; end if;
 update private.push_deliveries set sent_token_sha256=case when v_ok then p_token_sha256 else null end,
  status=case when v_ok then 'claimed' else 'disabled' end,
  last_error_code=case when v_ok then null else 'source_unavailable' end
 where id=p_id;
 return coalesce(v_ok,false);
end $$;

create function public.finish_push_dispatch(p_id uuid,p_claim_id uuid,p_outcome text,
 p_ticket_id text default null,p_error_code text default null)
returns boolean language plpgsql security definer set search_path='' as $$
declare d private.push_deliveries%rowtype; v_status text;
begin
 select * into d from private.push_deliveries where id=p_id and claim_id=p_claim_id
  and status in ('claimed','ticketed') and claim_expires_at>now() for update;
 if not found then return false; end if;
 if p_outcome is null or p_outcome not in ('ticketed','receipt_ok','retryable','permanent','missing')
  or (d.status='claimed' and p_outcome in ('receipt_ok','missing'))
  or (d.status='ticketed' and p_outcome='ticketed') then raise exception 'Invalid outcome'; end if;
 if p_error_code is not null and p_error_code not in
  ('DeviceNotRegistered','MessageTooBig','MessageRateExceeded','InvalidCredentials','MismatchSenderId',
   'provider_retry','ambiguous_delivery','invalid_provider_response','receipt_expired','provider_error')
  then raise exception 'Invalid provider error code'; end if;
 if p_outcome='ticketed' and (p_ticket_id is null or char_length(p_ticket_id) not between 1 and 160)
  then raise exception 'Ticket required'; end if;
 v_status:=case when p_outcome='missing' then 'ticketed'
  when p_outcome='retryable' and d.attempt_count>=5 then 'permanent' else p_outcome end;
 if p_outcome='missing' and (d.ticketed_at<now()-interval '23 hours' or d.receipt_poll_count>=95) then
  v_status:='permanent'; p_error_code:='receipt_expired';
 end if;
 if p_error_code='DeviceNotRegistered' then
  update private.push_installations i set enabled=false,disabled_at=now(),
   disabled_reason='DeviceNotRegistered',updated_at=now()
  where i.id=d.installation_id and i.user_id=d.recipient_id and i.enabled
   and encode(extensions.digest(i.expo_push_token,'sha256'),'hex')=d.sent_token_sha256;
 end if;
 update private.push_deliveries set status=v_status,claim_id=null,claim_expires_at=null,
  expo_ticket_id=case when p_outcome='ticketed' then p_ticket_id else expo_ticket_id end,
  ticketed_at=case when p_outcome='ticketed' then now() else ticketed_at end,
  receipt_next_check_at=case when p_outcome in ('ticketed','missing') then now()+interval '15 minutes' else null end,
  receipt_poll_count=receipt_poll_count+case when d.status='ticketed' then 1 else 0 end,
  receipt_checked_at=case when d.status='ticketed' then now() else receipt_checked_at end,
  receipt_status=case when d.status='ticketed' then p_outcome else receipt_status end,
  next_attempt_at=case when v_status='retryable' then now()+make_interval(secs=>least(3600,60*power(2,d.attempt_count)::integer)) else next_attempt_at end,
  failed_at=case when v_status='permanent' then now() else failed_at end,
  last_error_code=p_error_code,last_error_detail=null,updated_at=now()
 where id=p_id;
 return true;
end $$;

-- Cron invokes this owner-only function. The job text contains no credential.
-- Neither scheduling nor activation is performed by this migration.
create function private.invoke_push_dispatch() returns bigint
language plpgsql security definer set search_path='' as $$
declare v_url text; v_secret text;
begin
 if not exists(select 1 from private.push_dispatch_settings where singleton and enabled) then
  return null;
 end if;
 if has_table_privilege('anon','net.http_request_queue','SELECT')
  or has_table_privilege('authenticated','net.http_request_queue','SELECT') then
  raise exception 'Push HTTP queue client access must be restricted';
 end if;
 select decrypted_secret into v_url from vault.decrypted_secrets where name='dietbridge_push_project_url';
 select decrypted_secret into v_secret from vault.decrypted_secrets where name='dietbridge_push_dispatch_secret';
 if v_url is null or v_url !~ '^https://[a-z0-9]{20}\.supabase\.co$'
  or v_secret is null or char_length(v_secret) not between 32 and 512 then
  raise exception 'Push scheduler configuration missing or invalid';
 end if;
 return net.http_post(url:=v_url||'/functions/v1/dispatch-push',body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','x-dispatch-secret',v_secret),
  timeout_milliseconds:=30000);
end $$;

revoke all on function private.invoke_push_dispatch() from public,anon,authenticated,service_role;
revoke all on function private.push_dispatch_current(uuid) from public,anon,authenticated,service_role;
revoke all on function public.claim_push_dispatch(text,integer) from public,anon,authenticated;
revoke all on function public.prepare_push_dispatch(uuid,uuid,text) from public,anon,authenticated;
revoke all on function public.finish_push_dispatch(uuid,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.claim_push_dispatch(text,integer),
 public.prepare_push_dispatch(uuid,uuid,text),public.finish_push_dispatch(uuid,uuid,text,text,text) to service_role;
commit;


