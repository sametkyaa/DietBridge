-- Faz 2 / 7: dietitian application result e-mail (approval / rejection).
--
-- There is no transactional e-mail provider in the project today (Supabase
-- Auth sends only its own Auth e-mails). This migration adds the durable,
-- provider-agnostic part:
--   * every Product Admin decision row in dietitian_verification_audit
--     enqueues exactly one outbox row (status-change trigger);
--   * the send-application-result-emails Edge Function claims rows through
--     service_role-only RPCs, sends them through the configured provider and
--     records the outcome. Without provider secrets the function refuses to
--     claim, so rows simply wait in the queue; nothing is lost and nothing is
--     reported as sent.
begin;

do $preflight$
begin
  if to_regclass('public.dietitian_verification_audit') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Application result e-mail prerequisites are missing.';
  end if;

  if to_regclass('private.application_result_emails') is not null
     or to_regprocedure('public.claim_application_result_emails(integer)') is not null
     or to_regprocedure('public.complete_application_result_email(uuid,boolean,text,text)') is not null then
    raise exception 'Application result e-mail objects already exist; inspect schema drift.';
  end if;
end
$preflight$;

create table private.application_result_emails (
  id uuid primary key default gen_random_uuid(),
  audit_id uuid not null unique,
  subject_user_id uuid not null,
  recipient_email text not null,
  recipient_name text,
  decision text not null,
  rejection_reason text,
  status text not null default 'pending',
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  last_error text,
  provider_message_id text,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint application_result_emails_decision_check check (decision in ('approved', 'rejected')),
  constraint application_result_emails_status_check check (status in ('pending', 'sending', 'sent', 'failed')),
  constraint application_result_emails_attempts_check check (attempts between 0 and 10),
  constraint application_result_emails_email_check check (recipient_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  constraint application_result_emails_error_length_check check (last_error is null or char_length(last_error) <= 500),
  constraint application_result_emails_sent_check check ((status = 'sent') = (sent_at is not null))
);

revoke all on table private.application_result_emails from public, anon, authenticated, service_role;

create index application_result_emails_due_idx
  on private.application_result_emails (next_attempt_at, id)
  where status in ('pending', 'failed');

create function private.enqueue_application_result_email()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $function$
declare
  v_email text;
  v_name text;
begin
  if new.new_status not in ('approved', 'rejected') then
    return new;
  end if;

  select nullif(btrim(p.email), ''), nullif(left(btrim(p.full_name), 120), '')
    into v_email, v_name
    from public.profiles as p
   where p.id = new.subject_user_id_snapshot;

  if v_email is null or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    return new;
  end if;

  insert into private.application_result_emails (
    audit_id, subject_user_id, recipient_email, recipient_name, decision, rejection_reason
  ) values (
    new.id, new.subject_user_id_snapshot, v_email, v_name, new.new_status, new.rejection_reason
  )
  on conflict (audit_id) do nothing;

  return new;
end
$function$;

alter function private.enqueue_application_result_email() owner to postgres;
revoke all on function private.enqueue_application_result_email() from public, anon, authenticated, service_role;

create trigger trg_enqueue_application_result_email
after insert on public.dietitian_verification_audit
for each row execute function private.enqueue_application_result_email();

-- Claims due rows for the Edge Function. Rows stuck in "sending" for more than
-- 10 minutes (crashed worker) become claimable again. At most 5 attempts.
create function public.claim_application_result_emails(p_limit integer default 10)
returns table (
  id uuid,
  recipient_email text,
  recipient_name text,
  decision text,
  rejection_reason text,
  attempts integer
)
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
begin
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'Claim limit must be between 1 and 50.' using errcode = '22023';
  end if;

  return query
  with due as (
    select e.id
      from private.application_result_emails as e
     where (
         (e.status in ('pending', 'failed') and e.next_attempt_at <= now())
         or (e.status = 'sending' and e.locked_at < now() - interval '10 minutes')
       )
       and e.attempts < 5
     order by e.next_attempt_at, e.id
     limit p_limit
     for update skip locked
  )
  update private.application_result_emails as e
     set status = 'sending',
         attempts = e.attempts + 1,
         locked_at = now(),
         updated_at = now()
    from due
   where e.id = due.id
  returning e.id, e.recipient_email, e.recipient_name, e.decision, e.rejection_reason, e.attempts;
end
$function$;

alter function public.claim_application_result_emails(integer) owner to postgres;
revoke all on function public.claim_application_result_emails(integer) from public, anon, authenticated;
grant execute on function public.claim_application_result_emails(integer) to service_role;

create function public.complete_application_result_email(
  p_id uuid,
  p_sent boolean,
  p_provider_message_id text default null,
  p_error text default null
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, private
as $function$
begin
  if p_id is null or p_sent is null then
    raise exception 'Outbox completion input is invalid.' using errcode = '22023';
  end if;

  update private.application_result_emails as e
     set status = case when p_sent then 'sent' else 'failed' end,
         sent_at = case when p_sent then now() else null end,
         provider_message_id = case when p_sent then left(p_provider_message_id, 200) else null end,
         last_error = case when p_sent then null else left(coalesce(p_error, 'send_failed'), 500) end,
         -- exponential backoff: 2, 4, 8, 16 minutes
         next_attempt_at = case when p_sent then e.next_attempt_at
                                else now() + make_interval(mins => power(2, least(e.attempts, 5))::integer) end,
         locked_at = null,
         updated_at = now()
   where e.id = p_id
     and e.status = 'sending';

  return found;
end
$function$;

alter function public.complete_application_result_email(uuid, boolean, text, text) owner to postgres;
revoke all on function public.complete_application_result_email(uuid, boolean, text, text) from public, anon, authenticated;
grant execute on function public.complete_application_result_email(uuid, boolean, text, text) to service_role;

do $postflight$
begin
  if has_function_privilege('authenticated', 'public.claim_application_result_emails(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_application_result_emails(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_application_result_email(uuid,boolean,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_application_result_email(uuid,boolean,text,text)', 'EXECUTE') then
    raise exception 'Application result e-mail RPCs must be service_role only.';
  end if;
end
$postflight$;

commit;
