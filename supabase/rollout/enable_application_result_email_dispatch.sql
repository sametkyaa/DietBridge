-- Operational configuration, NOT an automatic schema migration.
-- Production target: kagvxhyvxxypspdxcuxz only.
-- Drains private.application_result_emails (20261006090600) by calling the
-- send-application-result-emails Edge Function every 10 minutes with the
-- service-role key, as described in docs/FAZ2_BACKEND_RELEASE_RUNBOOK.md.
--
-- Prerequisites (values are never written to the repository or logs):
--   vault secret application_result_email_function_url
--     = https://kagvxhyvxxypspdxcuxz.supabase.co/functions/v1/send-application-result-emails
--   vault secret application_result_email_service_role_key
--     = the project's service_role key (the function only accepts this key
--       for scheduled calls)
-- Without the provider secrets the function answers 503 and claims nothing.
-- Rollback: select cron.unschedule('application-result-email-dispatch');
begin;
do $$
declare v_job cron.job; v_url text;
  v_command constant text :=
    'select net.http_post('
    || 'url := (select decrypted_secret from vault.decrypted_secrets where name = ''application_result_email_function_url''), '
    || 'headers := jsonb_build_object(''Content-Type'', ''application/json'', ''Authorization'', ''Bearer '' || (select decrypted_secret from vault.decrypted_secrets where name = ''application_result_email_service_role_key'')), '
    || 'body := ''{}''::jsonb, timeout_milliseconds := 30000);';
begin
  if to_regprocedure('public.claim_application_result_emails(integer)') is null then
    raise exception 'Application result e-mail outbox missing';
  end if;
  if (select count(*) from vault.secrets where name = 'application_result_email_function_url') <> 1
     or (select count(*) from vault.secrets where name = 'application_result_email_service_role_key') <> 1 then
    raise exception 'Unique application e-mail Vault entries required';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name = 'application_result_email_function_url';
  if v_url is distinct from 'https://kagvxhyvxxypspdxcuxz.supabase.co/functions/v1/send-application-result-emails'
     or (select nullif(btrim(decrypted_secret), '') from vault.decrypted_secrets
          where name = 'application_result_email_service_role_key') is null then
    raise exception 'Application e-mail Vault readiness mismatch';
  end if;
  if (select count(*) from cron.job where jobname = 'application-result-email-dispatch') > 1 then
    raise exception 'Duplicate application e-mail jobs; separate forward-fix required';
  end if;
  select * into v_job from cron.job where jobname = 'application-result-email-dispatch';
  if found then
    if v_job.schedule is distinct from '*/10 * * * *'
       or v_job.command is distinct from v_command
       or v_job.active is distinct from true then
      raise exception 'Existing application e-mail job differs; separate forward-fix required';
    end if;
    return;
  end if;
  perform cron.schedule('application-result-email-dispatch', '*/10 * * * *', v_command);
end $$;
commit;
