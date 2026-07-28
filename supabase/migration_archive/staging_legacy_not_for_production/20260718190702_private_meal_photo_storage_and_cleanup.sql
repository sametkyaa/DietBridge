-- Keep meal-photo objects private and store only canonical object paths in meals.
-- Old object cleanup is persisted in PostgreSQL so a Storage failure can be retried.

begin;

do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regclass('public.meals') is null
     or to_regclass('public.meal_plans') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regprocedure('public.save_weekly_meal_plan(uuid,date,jsonb)') is null
     or to_regprocedure('storage.foldername(text)') is null then
    raise exception 'Meal-photo storage prerequisites are missing.';
  end if;

  if exists (
    select 1
    from public.meals
    where photo_url is not null
      and photo_url !~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  ) then
    raise exception 'Existing meal photo_url values are incompatible with the canonical private-path contract.';
  end if;
end
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'meal-photos',
  'meal-photos',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

alter table public.meals
  drop constraint if exists meals_photo_url_canonical_path_check;

alter table public.meals
  add constraint meals_photo_url_canonical_path_check
  check (
    photo_url is null
    or photo_url ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  );

create unique index meals_photo_url_one_reference
  on public.meals (photo_url)
  where photo_url is not null;

create table public.meal_photo_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  object_path text not null,
  client_id uuid not null,
  dietitian_id uuid not null,
  created_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  completed_at timestamptz,
  completed_by uuid,
  check (
    object_path ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  ),
  check (split_part(object_path, '/', 2) = client_id::text),
  check (split_part(object_path, '/', 3) = dietitian_id::text)
);

create unique index meal_photo_cleanup_queue_one_pending_path
  on public.meal_photo_cleanup_queue (object_path)
  where completed_at is null;

create index meal_photo_cleanup_queue_pending_dietitian
  on public.meal_photo_cleanup_queue (dietitian_id, created_at)
  where completed_at is null;

alter table public.meal_photo_cleanup_queue enable row level security;
revoke all on table public.meal_photo_cleanup_queue from public, anon, authenticated;

create or replace function private.enqueue_meal_photo_cleanup(
  p_object_path text,
  p_client_id uuid,
  p_dietitian_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_id uuid;
begin
  if p_object_path is null
     or p_client_id is null
     or p_dietitian_id is null
     or p_object_path !~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
     or split_part(p_object_path, '/', 2) <> p_client_id::text
     or split_part(p_object_path, '/', 3) <> p_dietitian_id::text then
    raise exception 'Invalid meal photo cleanup path.' using errcode = '22023';
  end if;

  insert into public.meal_photo_cleanup_queue (
    object_path,
    client_id,
    dietitian_id
  )
  values (
    p_object_path,
    p_client_id,
    p_dietitian_id
  )
  on conflict (object_path) where completed_at is null do update
  set client_id = excluded.client_id,
      dietitian_id = excluded.dietitian_id
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function private.queue_replaced_meal_photo()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_path text;
begin
  if tg_op = 'DELETE' then
    v_path := old.photo_url;
  elsif old.photo_url is distinct from new.photo_url then
    v_path := old.photo_url;
  else
    return new;
  end if;

  if v_path is not null then
    perform private.enqueue_meal_photo_cleanup(
      v_path,
      split_part(v_path, '/', 2)::uuid,
      split_part(v_path, '/', 3)::uuid
    );
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  return new;
end;
$function$;

create or replace function private.has_my_pending_meal_photo_cleanup(p_object_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select auth.uid() is not null
    and exists (
      select 1
      from public.meal_photo_cleanup_queue as cleanup
      where cleanup.object_path = p_object_path
        and cleanup.dietitian_id = auth.uid()
        and cleanup.completed_at is null
    );
$function$;

drop trigger if exists meals_queue_replaced_photo on public.meals;
create trigger meals_queue_replaced_photo
after update of photo_url or delete on public.meals
for each row execute function private.queue_replaced_meal_photo();

-- Remove only meal-photo-specific legacy policies. A policy that references
-- this bucket without an explicitly meal-photo-scoped name is ambiguous.
do $$
declare
  v_policy record;
begin
  for v_policy in
    select policyname,
           lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) as expression
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        lower(policyname) like '%meal%photo%'
        or lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%meal-photos%'
      )
  loop
    if lower(v_policy.policyname) not like '%meal%photo%' then
      raise exception 'Storage policy % references meal-photos but is not meal-photo-scoped.', v_policy.policyname;
    end if;

    execute format('drop policy if exists %I on storage.objects', v_policy.policyname);
  end loop;
end
$$;

create policy meal_photo_objects_select_canonical
on storage.objects
for select
to authenticated
using (
  bucket_id = 'meal-photos'
  and name ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and exists (
    select 1
    from public.meals as meal
    join public.meal_plans as plan on plan.id = meal.plan_id
    where meal.photo_url = storage.objects.name
      and split_part(storage.objects.name, '/', 2) = plan.client_id::text
      and split_part(storage.objects.name, '/', 3) = plan.dietitian_id::text
      and (
        (
          plan.client_id = (select auth.uid())
          and exists (
            select 1 from public.profiles as client_profile
            where client_profile.id = (select auth.uid())
              and client_profile.role = 'client'::public.user_role
          )
        )
        or (
          plan.dietitian_id = (select auth.uid())
          and exists (
            select 1
            from public.profiles as dietitian_profile
            join public.dietitian_profiles as verification
              on verification.user_id = dietitian_profile.id
            join public.dietitian_clients as relationship
              on relationship.dietitian_id = dietitian_profile.id
             and relationship.client_id = plan.client_id
            where dietitian_profile.id = (select auth.uid())
              and dietitian_profile.role = 'dietitian'::public.user_role
              and verification.verification_status = 'approved'
              and verification.is_verified is true
              and relationship.status = 'active'::public.client_status
          )
        )
      )
  )
);

create policy meal_photo_objects_insert_active_dietitian
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'meal-photos'
  and name ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and split_part(name, '/', 3) = (select auth.uid())::text
  and (
    (storage.extension(name) = 'png' and metadata ->> 'mimetype' = 'image/png')
    or (storage.extension(name) = 'webp' and metadata ->> 'mimetype' = 'image/webp')
    or (storage.extension(name) in ('jpg', 'jpeg') and metadata ->> 'mimetype' = 'image/jpeg')
  )
  and coalesce((metadata ->> 'size')::bigint, 0) > 0
  and coalesce((metadata ->> 'size')::bigint, 0) <= 5242880
  and exists (
    select 1
    from public.profiles as dietitian_profile
    join public.dietitian_profiles as verification
      on verification.user_id = dietitian_profile.id
    join public.dietitian_clients as relationship
      on relationship.dietitian_id = dietitian_profile.id
     and relationship.client_id::text = split_part(name, '/', 2)
    where dietitian_profile.id = (select auth.uid())
      and dietitian_profile.role = 'dietitian'::public.user_role
      and verification.verification_status = 'approved'
      and verification.is_verified is true
      and relationship.status = 'active'::public.client_status
  )
);

create policy meal_photo_objects_delete_authorized
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'meal-photos'
  and name ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and (
    exists (
      select 1
      from public.meals as meal
      join public.meal_plans as plan on plan.id = meal.plan_id
      join public.profiles as dietitian_profile on dietitian_profile.id = plan.dietitian_id
      join public.dietitian_profiles as verification on verification.user_id = dietitian_profile.id
      join public.dietitian_clients as relationship
        on relationship.dietitian_id = dietitian_profile.id
       and relationship.client_id = plan.client_id
      where meal.photo_url = storage.objects.name
        and plan.dietitian_id = (select auth.uid())
        and dietitian_profile.role = 'dietitian'::public.user_role
        and verification.verification_status = 'approved'
        and verification.is_verified is true
        and relationship.status = 'active'::public.client_status
    )
    or private.has_my_pending_meal_photo_cleanup(storage.objects.name)
  )
);

create or replace function public.list_my_pending_meal_photo_cleanup()
returns table (
  cleanup_id uuid,
  object_path text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null
     or not exists (
       select 1 from public.profiles
       where id = v_actor_id and role = 'dietitian'::public.user_role
     ) then
    raise exception 'Meal photo cleanup authorization failed.' using errcode = '42501';
  end if;

  return query
  select cleanup.id, cleanup.object_path, cleanup.attempt_count
  from public.meal_photo_cleanup_queue as cleanup
  where cleanup.dietitian_id = v_actor_id
    and cleanup.completed_at is null
  order by cleanup.created_at, cleanup.id;
end;
$function$;

create or replace function public.record_my_meal_photo_cleanup_attempt(p_cleanup_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null then
    raise exception 'Meal photo cleanup authorization failed.' using errcode = '42501';
  end if;

  update public.meal_photo_cleanup_queue
  set attempt_count = attempt_count + 1,
      last_attempt_at = now()
  where id = p_cleanup_id
    and dietitian_id = v_actor_id
    and completed_at is null;

  if not found then
    raise exception 'Meal photo cleanup authorization failed.' using errcode = '42501';
  end if;

  return true;
end;
$function$;

create or replace function public.complete_my_meal_photo_cleanup(p_cleanup_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_object_path text;
begin
  if v_actor_id is null then
    raise exception 'Meal photo cleanup authorization failed.' using errcode = '42501';
  end if;

  select object_path
  into v_object_path
  from public.meal_photo_cleanup_queue
  where id = p_cleanup_id
    and dietitian_id = v_actor_id
    and completed_at is null
  for update;

  if not found then
    raise exception 'Meal photo cleanup authorization failed.' using errcode = '42501';
  end if;

  if exists (
    select 1 from storage.objects
    where bucket_id = 'meal-photos'
      and name = v_object_path
  ) then
    raise exception 'Meal photo object still exists; cleanup cannot be completed.' using errcode = '23514';
  end if;

  update public.meal_photo_cleanup_queue
  set completed_at = now(),
      completed_by = v_actor_id
  where id = p_cleanup_id;

  return true;
end;
$function$;

create or replace function public.enqueue_my_unreferenced_meal_photo_cleanup(p_object_path text)
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
       select 1 from public.profiles
       where id = v_actor_id and role = 'dietitian'::public.user_role
     )
     or exists (
       select 1 from public.meals where photo_url = p_object_path
     )
     or not exists (
       select 1 from storage.objects
       where bucket_id = 'meal-photos' and name = p_object_path
     ) then
    raise exception 'Meal photo cleanup authorization failed.' using errcode = '42501';
  end if;

  return private.enqueue_meal_photo_cleanup(
    p_object_path,
    split_part(p_object_path, '/', 2)::uuid,
    v_actor_id
  );
end;
$function$;

revoke all on function private.enqueue_meal_photo_cleanup(text, uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.queue_replaced_meal_photo()
from public, anon, authenticated, service_role;
revoke all on function private.has_my_pending_meal_photo_cleanup(text)
from public, anon, authenticated, service_role;
grant execute on function private.has_my_pending_meal_photo_cleanup(text) to authenticated;
revoke all on function public.list_my_pending_meal_photo_cleanup()
from public, anon, authenticated, service_role;
revoke all on function public.record_my_meal_photo_cleanup_attempt(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.complete_my_meal_photo_cleanup(uuid)
from public, anon, authenticated, service_role;
revoke all on function public.enqueue_my_unreferenced_meal_photo_cleanup(text)
from public, anon, authenticated, service_role;

grant execute on function public.list_my_pending_meal_photo_cleanup() to authenticated;
grant execute on function public.record_my_meal_photo_cleanup_attempt(uuid) to authenticated;
grant execute on function public.complete_my_meal_photo_cleanup(uuid) to authenticated;
grant execute on function public.enqueue_my_unreferenced_meal_photo_cleanup(text) to authenticated;

create or replace function public.save_weekly_meal_plan(
  p_client_id uuid,
  p_week_start date,
  p_days jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_day jsonb;
  v_meal jsonb;
  v_photo_path text;
begin
  if p_days is not null and pg_catalog.jsonb_typeof(p_days) = 'array' then
    for v_day in
      select item.value
      from pg_catalog.jsonb_array_elements(p_days) as item(value)
    loop
      if pg_catalog.jsonb_typeof(v_day) = 'object'
         and pg_catalog.jsonb_typeof(v_day -> 'meals') = 'array' then
        for v_meal in
          select meal.value
          from pg_catalog.jsonb_array_elements(v_day -> 'meals') as meal(value)
        loop
          if pg_catalog.jsonb_typeof(v_meal) = 'object' then
            if (v_meal ->> 'source') is distinct from 'manual'
               or (v_meal ? 'recipe_id' and pg_catalog.jsonb_typeof(v_meal -> 'recipe_id') <> 'null') then
              raise exception 'Recipe-backed meals are not supported until canonical recipe persistence exists.'
                using errcode = '22023';
            end if;

            if not (v_meal ? 'photo_url') or pg_catalog.jsonb_typeof(v_meal -> 'photo_url') = 'null' then
              continue;
            end if;

            if pg_catalog.jsonb_typeof(v_meal -> 'photo_url') <> 'string' then
              raise exception 'Meal photo_url must be a canonical object path or null.' using errcode = '22023';
            end if;

            v_photo_path := v_meal ->> 'photo_url';
            if v_actor_id is null
               or v_photo_path !~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
               or split_part(v_photo_path, '/', 2) <> p_client_id::text
               or split_part(v_photo_path, '/', 3) <> v_actor_id::text
               or not exists (
                 select 1
                 from storage.objects
                 where bucket_id = 'meal-photos'
                   and name = v_photo_path
               ) then
              raise exception 'Meal photo_url is not authorized for this client and dietitian.' using errcode = '42501';
            end if;
          end if;
        end loop;
      end if;
    end loop;
  end if;

  return private.save_weekly_meal_plan_impl(p_client_id, p_week_start, p_days);
end;
$function$;

revoke all on function public.save_weekly_meal_plan(uuid, date, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_weekly_meal_plan(uuid, date, jsonb) to authenticated;

comment on table public.meal_photo_cleanup_queue is
  'Persistent cleanup queue for replaced, deleted, or failed-to-persist private meal photos.';
comment on function public.save_weekly_meal_plan(uuid, date, jsonb) is
  'Atomic weekly save with manual-only source and canonical private meal-photo path validation.';

commit;
