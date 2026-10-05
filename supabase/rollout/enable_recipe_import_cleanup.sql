-- Operational configuration, NOT an automatic schema migration.
-- Production target: kagvxhyvxxypspdxcuxz only.
-- Run only after APPROVE_RECIPE_CLEANUP_CRON and successful cleanup Edge,
-- server secret and Vault gates; reverify project identity immediately first.
-- Does not dispatch HTTP, mutate Vault, or log any decrypted token.
begin;
do $$
declare v_job cron.job; v_url text; v_token text;
begin
  if to_regprocedure('private.dispatch_recipe_import_cleanup()') is null then
    raise exception 'Recipe cleanup dispatcher missing';
  end if;
  if (select count(*) from vault.secrets where name='recipe_import_cleanup_url')<>1
     or (select count(*) from vault.secrets where name='recipe_import_cleanup_token')<>1 then
    raise exception 'Unique cleanup Vault entries required';
  end if;
  select decrypted_secret into v_url from vault.decrypted_secrets where name='recipe_import_cleanup_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name='recipe_import_cleanup_token';
  if v_url is distinct from 'https://kagvxhyvxxypspdxcuxz.supabase.co/functions/v1/cleanup-recipe-imports'
     or nullif(btrim(v_token),'') is null then
    raise exception 'Cleanup Vault readiness mismatch';
  end if;
  if (select count(*) from cron.job where jobname='recipe-import-cleanup')>1 then
    raise exception 'Duplicate recipe cleanup jobs; separate forward-fix required';
  end if;
  select * into v_job from cron.job where jobname='recipe-import-cleanup';
  if found then
    if v_job.schedule is distinct from '*/15 * * * *'
       or v_job.command is distinct from 'select private.dispatch_recipe_import_cleanup();'
       or v_job.active is distinct from true or v_job.username is distinct from current_user then
      raise exception 'Existing cleanup job differs; separate forward-fix required';
    end if;
    return;
  end if;
  perform cron.schedule('recipe-import-cleanup','*/15 * * * *','select private.dispatch_recipe_import_cleanup();');
end $$;
commit;
