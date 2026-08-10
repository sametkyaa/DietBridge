-- MVP-3 meal-photo lifecycle closure.
-- The private bucket is an immutable prerequisite; this migration changes only
-- database queue/RPC/trigger contracts and the two exact legacy object policies.

begin;

do $preflight$
declare
  v_policy_count integer;
  v_mime_types text[];
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regclass('public.meals') is null
     or to_regclass('public.meal_plans') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null
     or to_regprocedure('storage.extension(text)') is null then
    raise exception 'MVP-3 meal-photo prerequisites are missing.';
  end if;

  if to_regclass('public.meal_photo_cleanup_queue') is not null
     or to_regprocedure('public.enqueue_my_unreferenced_meal_photo_cleanup(text)') is not null
     or to_regprocedure('public.get_my_meal_photo_cleanup_status()') is not null
     or to_regprocedure('public.claim_meal_photo_cleanup_batch(integer)') is not null
     or to_regprocedure('public.complete_meal_photo_cleanup(uuid)') is not null then
    raise exception 'MVP-3 meal-photo lifecycle objects already exist; reconcile explicitly.';
  end if;

  if to_regnamespace('private') is not null
     and (select pg_get_userbyid(nspowner) from pg_namespace where oid = to_regnamespace('private')) <> 'postgres' then
    raise exception 'Existing private schema has an unexpected owner.';
  end if;

  select array_agg(mime_type order by mime_type)
    into v_mime_types
    from storage.buckets as b,
         unnest(b.allowed_mime_types) as mime_type
   where b.id = 'meal-photos';

  if not exists (
    select 1
      from storage.buckets as b
     where b.id = 'meal-photos'
       and b.name = 'meal-photos'
       and b.public is false
       and b.file_size_limit = 5242880
       and coalesce(cardinality(b.allowed_mime_types), 0) = 3
  ) or v_mime_types is distinct from array['image/jpeg', 'image/png', 'image/webp']::text[] then
    raise exception 'meal-photos bucket differs from the private 5 MiB JPEG/PNG/WebP prerequisite.';
  end if;

  select count(*)
    into v_policy_count
    from pg_catalog.pg_policies
   where schemaname = 'storage'
     and tablename = 'objects'
     and (
       policyname in (
         'Give users access to own folder 1o5iea3_0',
         'Give users access to own folder 1o5iea3_1'
       )
       or lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%meal-photos%'
     );

  if v_policy_count <> 2
     or not exists (
       select 1 from pg_catalog.pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'Give users access to own folder 1o5iea3_0'
          and cmd = 'SELECT' and roles = array['public']::name[]
          and lower(coalesce(qual, '')) like '%meal-photos%'
          and lower(coalesce(qual, '')) like '%auth.uid()%'
          and lower(coalesce(qual, '')) like '%storage.foldername(name)%'
          and coalesce(qual, '') like '%[1]%'
     )
     or not exists (
       select 1 from pg_catalog.pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and policyname = 'Give users access to own folder 1o5iea3_1'
          and cmd = 'INSERT' and roles = array['public']::name[]
          and lower(coalesce(with_check, '')) like '%meal-photos%'
          and lower(coalesce(with_check, '')) like '%auth.uid()%'
          and lower(coalesce(with_check, '')) like '%storage.foldername(name)%'
          and coalesce(with_check, '') like '%[1]%'
     ) then
    raise exception 'Unexpected meal-photo Storage policy state; refusing broad policy replacement.';
  end if;
end
$preflight$;

create schema if not exists private authorization postgres;
revoke all on schema private from public, anon, authenticated, service_role;

create table public.meal_photo_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  object_path text not null,
  client_id uuid not null,
  dietitian_id uuid not null,
  reason text not null,
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint meal_photo_cleanup_queue_path_check check (
    object_path ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  ),
  constraint meal_photo_cleanup_queue_client_check
    check (split_part(object_path, '/', 2) = client_id::text),
  constraint meal_photo_cleanup_queue_dietitian_check
    check (split_part(object_path, '/', 3) = dietitian_id::text),
  constraint meal_photo_cleanup_queue_reason_check
    check (reason in ('replaced', 'meal_deleted', 'failed_save')),
  constraint meal_photo_cleanup_queue_attempt_count_check check (attempt_count >= 0)
);

alter table public.meal_photo_cleanup_queue owner to postgres;

create unique index meal_photo_cleanup_queue_one_pending_path_idx
  on public.meal_photo_cleanup_queue (object_path)
  where completed_at is null;

create index meal_photo_cleanup_queue_available_idx
  on public.meal_photo_cleanup_queue (available_at, claimed_at, id)
  where completed_at is null;

alter table public.meal_photo_cleanup_queue enable row level security;
revoke all on table public.meal_photo_cleanup_queue from public, anon, authenticated;

create function private.enqueue_meal_photo_cleanup(
  p_object_path text,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_id uuid;
  v_client_id uuid;
  v_dietitian_id uuid;
begin
  if p_object_path is null
     or p_object_path !~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
     or p_reason not in ('replaced', 'meal_deleted', 'failed_save') then
    raise exception 'Invalid meal photo cleanup request.' using errcode = '22023';
  end if;

  v_client_id := split_part(p_object_path, '/', 2)::uuid;
  v_dietitian_id := split_part(p_object_path, '/', 3)::uuid;

  insert into public.meal_photo_cleanup_queue (
    object_path, client_id, dietitian_id, reason
  ) values (
    p_object_path, v_client_id, v_dietitian_id, p_reason
  )
  on conflict (object_path) where completed_at is null do update
    set reason = excluded.reason,
        available_at = least(public.meal_photo_cleanup_queue.available_at, now())
  returning id into v_id;

  return v_id;
end
$function$;

create function private.queue_replaced_meal_photo()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_path text;
  v_reason text;
begin
  if tg_op = 'DELETE' then
    v_path := old.photo_url;
    v_reason := 'meal_deleted';
  elsif old.photo_url is distinct from new.photo_url then
    v_path := old.photo_url;
    v_reason := 'replaced';
  else
    return new;
  end if;

  -- Recipe-image and legacy URL references are deliberately outside this queue.
  if v_path ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$' then
    perform private.enqueue_meal_photo_cleanup(v_path, v_reason);
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create trigger meals_queue_replaced_photo
after update of photo_url or delete on public.meals
for each row execute function private.queue_replaced_meal_photo();

create function public.enqueue_my_unreferenced_meal_photo_cleanup(p_object_path text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null
     or p_object_path is null
     or p_object_path !~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
     or split_part(p_object_path, '/', 3) <> v_actor_id::text
     or not exists (
       select 1 from public.profiles as p
        where p.id = v_actor_id and p.role = 'dietitian'::public.user_role
     ) then
    raise exception 'Meal photo cleanup authorization failed.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from storage.objects as o
     where o.bucket_id = 'meal-photos'
       and o.name = p_object_path
       and o.owner_id = v_actor_id::text
  ) or exists (
    select 1 from public.meals as m where m.photo_url = p_object_path
  ) then
    raise exception 'Meal photo is not eligible for cleanup.' using errcode = '42501';
  end if;

  return private.enqueue_meal_photo_cleanup(p_object_path, 'failed_save');
end
$function$;

create function public.get_my_meal_photo_cleanup_status()
returns integer
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_count integer;
begin
  if v_actor_id is null or not exists (
    select 1 from public.profiles as p
     where p.id = v_actor_id and p.role = 'dietitian'::public.user_role
  ) then
    raise exception 'Meal photo cleanup authorization failed.' using errcode = '42501';
  end if;
  select count(*)::integer into v_count
    from public.meal_photo_cleanup_queue as q
   where q.dietitian_id = v_actor_id and q.completed_at is null;
  return v_count;
end
$function$;

create function public.claim_meal_photo_cleanup_batch(p_limit integer default 50)
returns table (cleanup_id uuid, bucket_id text, object_path text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'Meal photo cleanup worker authorization failed.' using errcode = '42501';
  end if;

  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid cleanup batch size.' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select q.id
      from public.meal_photo_cleanup_queue as q
     where q.completed_at is null
       and q.available_at <= now()
       and (q.claimed_at is null or q.claimed_at <= now() - interval '5 minutes')
       and not exists (select 1 from public.meals as m where m.photo_url = q.object_path)
     order by q.available_at, q.id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.meal_photo_cleanup_queue as q
       set claimed_at = now(), attempt_count = q.attempt_count + 1
      from candidates as c
     where q.id = c.id
     returning q.id, q.object_path
  )
  select c.id, 'meal-photos'::text, c.object_path from claimed as c;
end
$function$;

create function public.complete_meal_photo_cleanup(p_cleanup_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_completed boolean;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'Meal photo cleanup worker authorization failed.' using errcode = '42501';
  end if;

  if p_cleanup_id is null then
    raise exception 'Invalid cleanup identifier.' using errcode = '22023';
  end if;

  update public.meal_photo_cleanup_queue as q
     set completed_at = coalesce(q.completed_at, now())
   where q.id = p_cleanup_id
     and q.completed_at is null
     and not exists (select 1 from public.meals as m where m.photo_url = q.object_path)
     and not exists (
       select 1 from storage.objects as o
        where o.bucket_id = 'meal-photos' and o.name = q.object_path
     )
  returning true into v_completed;
  return coalesce(v_completed, false);
end
$function$;

alter function private.enqueue_meal_photo_cleanup(text, text) owner to postgres;
alter function private.queue_replaced_meal_photo() owner to postgres;
alter function public.enqueue_my_unreferenced_meal_photo_cleanup(text) owner to postgres;
alter function public.get_my_meal_photo_cleanup_status() owner to postgres;
alter function public.claim_meal_photo_cleanup_batch(integer) owner to postgres;
alter function public.complete_meal_photo_cleanup(uuid) owner to postgres;

revoke all on function private.enqueue_meal_photo_cleanup(text, text) from public, anon, authenticated, service_role;
revoke all on function private.queue_replaced_meal_photo() from public, anon, authenticated, service_role;
revoke all on function public.enqueue_my_unreferenced_meal_photo_cleanup(text) from public, anon, authenticated, service_role;
revoke all on function public.get_my_meal_photo_cleanup_status() from public, anon, authenticated, service_role;
revoke all on function public.claim_meal_photo_cleanup_batch(integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_meal_photo_cleanup(uuid) from public, anon, authenticated, service_role;

grant execute on function public.enqueue_my_unreferenced_meal_photo_cleanup(text) to authenticated;
grant execute on function public.get_my_meal_photo_cleanup_status() to authenticated;
grant execute on function public.claim_meal_photo_cleanup_batch(integer) to service_role;
grant execute on function public.complete_meal_photo_cleanup(uuid) to service_role;

drop policy "Give users access to own folder 1o5iea3_0" on storage.objects;
drop policy "Give users access to own folder 1o5iea3_1" on storage.objects;

create policy meal_photo_objects_insert_active_approved_dietitian
on storage.objects for insert to authenticated
with check (
  bucket_id = 'meal-photos'
  and name ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and split_part(name, '/', 3) = (select auth.uid())::text
  and (
    (storage.extension(name) = 'png' and metadata ->> 'mimetype' = 'image/png')
    or (storage.extension(name) = 'webp' and metadata ->> 'mimetype' = 'image/webp')
    or (storage.extension(name) in ('jpg', 'jpeg') and metadata ->> 'mimetype' = 'image/jpeg')
  )
  and coalesce((metadata ->> 'size')::bigint, 0) between 1 and 5242880
  and (select public.is_current_user_dietitian())
  and exists (
    select 1 from public.dietitian_clients as dc
     where dc.dietitian_id = (select auth.uid())
       and dc.client_id::text = split_part(name, '/', 2)
       and dc.status = 'active'::public.client_status
  )
);

create policy meal_photo_objects_select_referenced_linked_actor
on storage.objects for select to authenticated
using (
  bucket_id = 'meal-photos'
  and name ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and exists (
    select 1
      from public.meals as m
      join public.meal_plans as p on p.id = m.plan_id
      join public.dietitian_clients as dc
        on dc.dietitian_id = p.dietitian_id
       and dc.client_id = p.client_id
       and dc.status = 'active'::public.client_status
     where m.photo_url = storage.objects.name
       and p.client_id::text = split_part(storage.objects.name, '/', 2)
       and p.dietitian_id::text = split_part(storage.objects.name, '/', 3)
       and (
         p.client_id = (select auth.uid())
         or (
           p.dietitian_id = (select auth.uid())
           and (select public.is_current_user_dietitian())
         )
       )
  )
);

do $postflight$
begin
  if has_table_privilege('anon', 'public.meal_photo_cleanup_queue', 'SELECT')
     or has_table_privilege('authenticated', 'public.meal_photo_cleanup_queue', 'SELECT')
     or has_function_privilege('anon', 'public.claim_meal_photo_cleanup_batch(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_meal_photo_cleanup_batch(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_meal_photo_cleanup_batch(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_meal_photo_cleanup(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_meal_photo_cleanup(uuid)', 'EXECUTE') then
    raise exception 'MVP-3 meal-photo privilege postcondition failed.';
  end if;
end
$postflight$;

notify pgrst, 'reload schema';
commit;
