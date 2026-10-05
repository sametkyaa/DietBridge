-- Additive import metadata only. No recipe business column changes.
-- Repeat apply supported. Production application requires separate approval.
begin;
do $$ begin
  if to_regclass('public.recipes') is null or to_regprocedure('public.is_current_user_dietitian()') is null then
    raise exception 'Recipe import prerequisites missing';
  end if;
end $$;

-- Single authoritative application limit configuration, returned to Web and workers.
create or replace function public.recipe_import_limits() returns jsonb
language sql immutable set search_path=pg_catalog as $$
  select '{"maxBytes":5242880,"maxRecipes":20,"maxRows":200,"maxColumns":50,"maxExpandedBytes":20971520,"retentionHours":24}'::jsonb;
$$;
revoke all on function public.recipe_import_limits() from public, anon;
grant execute on function public.recipe_import_limits() to authenticated, service_role;

create table if not exists public.recipe_import_jobs (
  id uuid primary key default gen_random_uuid(),
  dietitian_id uuid not null references public.profiles(id) on delete cascade,
  request_id uuid not null,
  status text not null default 'uploaded' check(status in ('uploaded','processing','ready','failed','saved','expired')),
  source_file_name text not null check(length(source_file_name) between 1 and 160 and source_file_name !~ '[\\/]'),
  source_mime_type text not null,
  source_storage_path text not null unique,
  file_size integer not null check(file_size > 0),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default(now()+make_interval(hours:=(public.recipe_import_limits()->>'retentionHours')::integer)),
  error_code text check(error_code in ('invalid_file','unsupported_file','extraction_failed','provider_unavailable','provider_timeout','invalid_output','empty_output','too_many_recipes','abandoned')),
  ai_model text,
  ai_input_tokens integer check(ai_input_tokens >= 0),
  ai_output_tokens integer check(ai_output_tokens >= 0),
  cleanup_pending boolean not null default true,
  raw_deleted_at timestamptz,
  saved_recipe_ids uuid[],
  save_selection_hash text,
  unique(dietitian_id,request_id),
  unique(id,dietitian_id),
  check(source_storage_path = dietitian_id::text || '/' || id::text || '/source.' || lower(substring(source_file_name from '\.([^.]+)$')))
);
create index if not exists recipe_import_jobs_owner_time on public.recipe_import_jobs(dietitian_id,created_at desc);
create index if not exists recipe_import_jobs_cleanup on public.recipe_import_jobs(expires_at) where cleanup_pending;
create table if not exists public.recipe_import_items (
  id uuid primary key default gen_random_uuid(),
  import_job_id uuid not null,
  dietitian_id uuid not null,
  recipe_draft jsonb not null check(jsonb_typeof(recipe_draft)='object' and octet_length(recipe_draft::text)<=30000),
  source_reference jsonb not null default '{}'::jsonb check(octet_length(source_reference::text)<=1000),
  validation_state text not null check(validation_state in ('valid','needs_review')),
  warnings jsonb not null default '[]'::jsonb check(jsonb_typeof(warnings)='array' and octet_length(warnings::text)<=3000),
  saved_recipe_id uuid references public.recipes(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key(import_job_id,dietitian_id) references public.recipe_import_jobs(id,dietitian_id) on delete cascade
);
create index if not exists recipe_import_items_job on public.recipe_import_items(import_job_id);
alter table public.recipe_import_jobs enable row level security;
alter table public.recipe_import_items enable row level security;
revoke all on public.recipe_import_jobs, public.recipe_import_items from public, anon, authenticated;
grant select on public.recipe_import_jobs, public.recipe_import_items to authenticated;
grant all on public.recipe_import_jobs, public.recipe_import_items to service_role;

create or replace function private.require_recipe_import_actor() returns uuid
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=auth.uid();
begin
  perform 1 from public.profiles p join public.dietitian_profiles dp on dp.user_id=p.id
    where p.id=v_actor and p.role='dietitian' and dp.is_verified and dp.verification_status='approved'
    for key share of p,dp;
  if not found then raise exception 'Import authorization failed' using errcode='42501'; end if;
  return v_actor;
end $$;
revoke all on function private.require_recipe_import_actor() from public,anon,authenticated;
drop policy if exists recipe_import_jobs_read_own on public.recipe_import_jobs;
create policy recipe_import_jobs_read_own on public.recipe_import_jobs for select to authenticated
using(dietitian_id=(select auth.uid()) and (select public.is_current_user_dietitian()) and exists(select 1 from public.dietitian_profiles where user_id=(select auth.uid()) and is_verified and verification_status='approved'));
drop policy if exists recipe_import_items_read_own on public.recipe_import_items;
create policy recipe_import_items_read_own on public.recipe_import_items for select to authenticated
using(dietitian_id=(select auth.uid()) and (select public.is_current_user_dietitian()) and exists(select 1 from public.dietitian_profiles where user_id=(select auth.uid()) and is_verified and verification_status='approved'));

create or replace function public.begin_recipe_import(p_request_id uuid,p_name text,p_mime text,p_size integer) returns public.recipe_import_jobs
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=private.require_recipe_import_actor(); v_job public.recipe_import_jobs; v_ext text; v_mime text;
begin
  if p_request_id is null or p_name is null or length(p_name) not between 1 and 160 or p_name ~ '[\\/]' or p_name ~ '[[:cntrl:]]'
    or p_size is null or p_size<=0 or p_size>(public.recipe_import_limits()->>'maxBytes')::integer then
    raise exception 'Invalid import file' using errcode='22023';
  end if;
  v_ext:=lower(substring(p_name from '\.([^.]+)$'));
  v_mime:=case v_ext when 'csv' then 'text/csv' when 'xls' then 'application/vnd.ms-excel'
    when 'xlsx' then 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    when 'pdf' then 'application/pdf' when 'doc' then 'application/msword'
    when 'docx' then 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg' when 'png' then 'image/png' end;
  if v_mime is null or p_mime is distinct from v_mime then raise exception 'Invalid import type' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('recipe-import:'||v_actor::text,0));
  select * into v_job from public.recipe_import_jobs where dietitian_id=v_actor and request_id=p_request_id;
  if found then
    if v_job.source_file_name<>p_name or v_job.file_size<>p_size or v_job.source_mime_type<>p_mime then raise exception 'Request conflict' using errcode='22023'; end if;
    return v_job;
  end if;
  if (select count(*) from public.recipe_import_jobs where dietitian_id=v_actor and created_at>now()-interval '1 hour')>=10 then
    raise exception 'Import rate limit' using errcode='54000';
  end if;
  v_job.id:=gen_random_uuid();
  insert into public.recipe_import_jobs(id,dietitian_id,request_id,source_file_name,source_mime_type,file_size,source_storage_path)
  values(v_job.id,v_actor,p_request_id,p_name,p_mime,p_size,v_actor::text||'/'||v_job.id::text||'/source.'||v_ext) returning * into v_job;
  return v_job;
end $$;

-- Atomic service-only claim. A duplicate request cannot create a second provider invocation.
create or replace function public.claim_recipe_import(p_job_id uuid,p_actor uuid) returns public.recipe_import_jobs
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_job public.recipe_import_jobs;
begin
  if not exists(select 1 from public.profiles p join public.dietitian_profiles dp on dp.user_id=p.id where p.id=p_actor and p.role='dietitian' and dp.is_verified and dp.verification_status='approved') then raise exception 'Unauthorized' using errcode='42501'; end if;
  update public.recipe_import_jobs set status='processing' where id=p_job_id and dietitian_id=p_actor and status='uploaded' and expires_at>now() returning * into v_job;
  return v_job;
end $$;

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
  update public.recipe_import_jobs set status=case when p_error is null then 'ready' else 'failed' end,completed_at=now(),error_code=p_error,
    ai_model=p_metrics->>'model',ai_input_tokens=(p_metrics->>'inputTokens')::integer,ai_output_tokens=(p_metrics->>'outputTokens')::integer
    where id=p_job_id;
  return true;
end $$;

create or replace function public.save_recipe_import(p_job_id uuid,p_selected jsonb) returns uuid[]
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=private.require_recipe_import_actor(); v_job public.recipe_import_jobs; v_row jsonb; v_input jsonb; v_id uuid; v_ids uuid[]:='{}'; v_seen uuid[]:='{}';
begin
  select * into v_job from public.recipe_import_jobs where id=p_job_id and dietitian_id=v_actor for update;
  if not found then raise exception 'Import not found' using errcode='42501'; end if;
  if v_job.status='saved' then
    if v_job.save_selection_hash is distinct from encode(extensions.digest(p_selected::text,'sha256'),'hex') then raise exception 'Saved selection is immutable' using errcode='22023'; end if;
    return v_job.saved_recipe_ids;
  end if;
  if v_job.status<>'ready' or v_job.expires_at<=now() then raise exception 'Import unavailable' using errcode='22023'; end if;
  if p_selected is null or jsonb_typeof(p_selected)<>'array' or jsonb_array_length(p_selected) not between 1 and (public.recipe_import_limits()->>'maxRecipes')::integer then raise exception 'Invalid selection' using errcode='22023'; end if;
  for v_row in select value from jsonb_array_elements(p_selected) loop
    v_id:=(v_row->>'id')::uuid;
    if v_id=any(v_seen) or not exists(select 1 from public.recipe_import_items where id=v_id and import_job_id=p_job_id and dietitian_id=v_actor) then raise exception 'Invalid selection' using errcode='42501'; end if;
    v_seen:=array_append(v_seen,v_id); v_input:=v_row->'input';
    if v_input is null or not (v_input ?& array['name','mealType','calories','macros'])
      or jsonb_typeof(v_input->'macros')<>'object' or (select count(*) from jsonb_object_keys(v_input->'macros'))<>3
      or not ((v_input->'macros') ?& array['protein','carbs','fat'])
      or jsonb_typeof(v_input->'name')<>'string' or jsonb_typeof(v_input->'mealType')<>'string'
      or jsonb_typeof(v_input->'calories')<>'number' or (v_input->>'calories')::numeric<>trunc((v_input->>'calories')::numeric)
      or jsonb_typeof(v_input->'macros'->'protein')<>'number' or jsonb_typeof(v_input->'macros'->'carbs')<>'number' or jsonb_typeof(v_input->'macros'->'fat')<>'number'
      or (v_input ? 'description' and jsonb_typeof(v_input->'description') not in ('string','null')) then raise exception 'Invalid recipe input' using errcode='22023'; end if;
    -- Same recipes table, constraints, timestamps and owner semantics as manual create.
    insert into public.recipes(dietitian_id,name,description,meal_type,calories,protein,carbs,fat,image_path)
    values(v_actor,btrim(v_input->>'name'),nullif(btrim(v_input->>'description'),''),v_input->>'mealType',(v_input->>'calories')::integer,
      (v_input->'macros'->>'protein')::numeric,(v_input->'macros'->>'carbs')::numeric,(v_input->'macros'->>'fat')::numeric,null)
    returning id into v_id;
    update public.recipe_import_items set saved_recipe_id=v_id,recipe_draft=v_input,validation_state='valid' where id=(v_row->>'id')::uuid;
    v_ids:=array_append(v_ids,v_id);
  end loop;
  update public.recipe_import_jobs set status='saved',completed_at=now(),saved_recipe_ids=v_ids,save_selection_hash=encode(extensions.digest(p_selected::text,'sha256'),'hex') where id=p_job_id;
  return v_ids;
end $$;

create or replace function public.cancel_recipe_import(p_job_id uuid) returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=private.require_recipe_import_actor();
begin
  update public.recipe_import_jobs set status='failed',error_code='abandoned',completed_at=now() where id=p_job_id and dietitian_id=v_actor and status in ('uploaded','ready');
  return found;
end $$;
-- Deletes payload through Storage API first; DB acknowledgement is retried safely.
create or replace function public.recipe_import_cleanup_candidates() returns table(id uuid,source_storage_path text)
language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.recipe_import_jobs set status='expired' where expires_at<=now() and status not in ('saved','expired');
  delete from public.recipe_import_items where import_job_id in(select j.id from public.recipe_import_jobs j where j.expires_at<=now());
  return query select j.id,j.source_storage_path from public.recipe_import_jobs j where j.cleanup_pending and (j.status in ('ready','failed','saved','expired') or j.expires_at<=now()) order by j.created_at limit 100;
  -- An account deletion can cascade the job before Storage is removed. Reconcile
  -- that case through the real Storage API too, never DELETE storage.objects SQL.
  return query select null::uuid,o.name from storage.objects o where o.bucket_id='recipe-imports'
    and not exists(select 1 from public.recipe_import_jobs j where j.source_storage_path=o.name)
    and o.created_at<now()-interval '1 hour' order by o.created_at limit 100;
end $$;
create or replace function public.ack_recipe_import_cleanup(p_job_id uuid) returns void
language sql security definer set search_path=pg_catalog,public as $$
  update public.recipe_import_jobs set cleanup_pending=false,raw_deleted_at=now() where id=p_job_id;
$$;

revoke all on function public.begin_recipe_import(uuid,text,text,integer),public.save_recipe_import(uuid,jsonb),public.cancel_recipe_import(uuid) from public,anon;
grant execute on function public.begin_recipe_import(uuid,text,text,integer),public.save_recipe_import(uuid,jsonb),public.cancel_recipe_import(uuid) to authenticated;
revoke all on function public.claim_recipe_import(uuid,uuid),public.finish_recipe_import(uuid,uuid,jsonb,text,jsonb),public.recipe_import_cleanup_candidates(),public.ack_recipe_import_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.claim_recipe_import(uuid,uuid),public.finish_recipe_import(uuid,uuid,jsonb,text,jsonb),public.recipe_import_cleanup_candidates(),public.ack_recipe_import_cleanup(uuid) to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('recipe-imports','recipe-imports',false,(public.recipe_import_limits()->>'maxBytes')::integer,array['text/csv','application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/jpeg','image/png'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists recipe_import_upload_own on storage.objects;
create policy recipe_import_upload_own on storage.objects for insert to authenticated with check(bucket_id='recipe-imports' and exists(select 1 from public.recipe_import_jobs j where j.dietitian_id=(select auth.uid()) and j.source_storage_path=storage.objects.name and j.status='uploaded' and j.expires_at>now()));
drop policy if exists recipe_import_read_own on storage.objects;
create policy recipe_import_read_own on storage.objects for select to authenticated using(bucket_id='recipe-imports' and exists(select 1 from public.recipe_import_jobs j where j.dietitian_id=(select auth.uid()) and j.source_storage_path=storage.objects.name and j.expires_at>now()));
-- No owner UPDATE/overwrite, public access, or direct Storage delete policy.
create or replace function private.dispatch_recipe_import_cleanup() returns boolean
language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_url text;v_token text;
begin
  select decrypted_secret into v_url from vault.decrypted_secrets where name='recipe_import_cleanup_url';
  select decrypted_secret into v_token from vault.decrypted_secrets where name='recipe_import_cleanup_token';
  if v_url is null or v_token is null then return false; end if;
  perform net.http_post(url:=v_url,headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_token),body:='{}'::jsonb,timeout_milliseconds:=30000);
  return true;
end $$;
revoke all on function private.dispatch_recipe_import_cleanup() from public,anon,authenticated;
-- Scheduling is an operational rollout step, separately authorized only after
-- cleanup Edge, server secrets and Vault readiness. Core/reapply never changes
-- an existing cron job. See supabase/rollout/enable_recipe_import_cleanup.sql.
notify pgrst,'reload schema';
commit;
