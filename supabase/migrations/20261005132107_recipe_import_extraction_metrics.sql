begin;
alter table public.recipe_import_jobs add column if not exists ai_attempt_count integer check(ai_attempt_count between 0 and 4);
alter table public.recipe_import_jobs add column if not exists ai_duration_ms integer check(ai_duration_ms>=0);
create or replace function public.finish_recipe_import(p_job_id uuid,p_actor uuid,p_items jsonb,p_error text default null,p_metrics jsonb default '{}'::jsonb) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.recipe_import_jobs; v_item jsonb;
begin
  select * into v_job from public.recipe_import_jobs where id=p_job_id and dietitian_id=p_actor for update;
  if not found or v_job.status<>'processing' or v_job.expires_at<=now() then return false; end if;
  if p_error is null then
    if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and (public.recipe_import_limits()->>'maxRecipes')::integer then raise exception 'Invalid extraction' using errcode='22023'; end if;
    for v_item in select value from jsonb_array_elements(p_items) loop
      insert into public.recipe_import_items(import_job_id,dietitian_id,recipe_draft,source_reference,validation_state,warnings)
      values(p_job_id,p_actor,v_item->'draft',v_item->'source',v_item->>'validationState',v_item->'warnings');
    end loop;
  end if;
  if (p_metrics->>'model') is not null and (p_metrics->>'model')<>'gpt-6-luna' then raise exception 'Invalid extraction model' using errcode='22023'; end if;
  update public.recipe_import_jobs set status=case when p_error is null then 'ready' else 'failed' end,completed_at=now(),error_code=p_error,
    ai_model=p_metrics->>'model',ai_input_tokens=(p_metrics->>'inputTokens')::integer,ai_output_tokens=(p_metrics->>'outputTokens')::integer,
    ai_attempt_count=(p_metrics->>'attemptCount')::integer,ai_duration_ms=(p_metrics->>'durationMs')::integer where id=p_job_id;
  return true;
end $$;
-- Existing service-role-only ACL is preserved by CREATE OR REPLACE and verified locally.
revoke all on function public.finish_recipe_import(uuid,uuid,jsonb,text,jsonb) from public,anon,authenticated;
grant execute on function public.finish_recipe_import(uuid,uuid,jsonb,text,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
