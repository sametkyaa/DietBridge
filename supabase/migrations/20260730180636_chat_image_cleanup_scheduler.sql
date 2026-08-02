begin;

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
declare
  v_existing_job_id bigint;
begin
  if to_regclass('vault.decrypted_secrets') is null then
    raise exception 'Vault is required for the chat image cleanup scheduler.';
  end if;

  select jobid
    into v_existing_job_id
    from cron.job
   where jobname = 'chat-image-cleanup-every-5-minutes';

  if v_existing_job_id is not null then
    perform cron.unschedule(v_existing_job_id);
  end if;
end
$$;

select cron.schedule(
  'chat-image-cleanup-every-5-minutes',
  '*/5 * * * *',
  $schedule$
    select net.http_post(
      url := (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'chat_image_cleanup_function_url'
      ),
      headers := jsonb_build_object(
        'Content-Type',
        'application/json',
        'x-chat-image-cleanup-secret',
        (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'chat_image_cleanup_scheduler_secret'
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 5000
    );
  $schedule$
);

do $$
begin
  if (
    select count(*)
    from cron.job
    where jobname = 'chat-image-cleanup-every-5-minutes'
      and active
      and schedule = '*/5 * * * *'
  ) <> 1 then
    raise exception 'Chat image cleanup scheduler postcondition failed.';
  end if;
end
$$;

commit;
