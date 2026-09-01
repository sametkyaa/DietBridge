-- Package 1: persist client-owned meal completion evidence separately from
-- the dietitian-owned meal snapshot photo.
--
-- completion_photo_url stores a path relative to the private
-- meal-completion-photos bucket. meal.photo_url remains the plan/recipe
-- snapshot image and is never changed by the completion RPC.

begin;

do $preflight$
declare
  v_bucket_public boolean;
  v_bucket_limit bigint;
  v_bucket_mimes text[];
begin
  if to_regclass('public.meals') is null
     or to_regclass('public.meal_plans') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regclass('public.profiles') is null
     or to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regprocedure('public.set_my_meal_completion(uuid,boolean)') is null
     or to_regnamespace('private') is null then
    raise exception 'Meal completion photo prerequisites are missing.';
  end if;

  if exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'meals'
       and column_name = 'completion_photo_url'
  )
  or to_regclass('public.meal_completion_photo_cleanup_queue') is not null
  or to_regprocedure('private.set_my_meal_completion_impl(uuid,boolean,text)') is not null
  or to_regprocedure('public.set_my_meal_completion_with_photo(uuid,boolean,text)') is not null
  or to_regprocedure('public.enqueue_my_unreferenced_meal_completion_photo_cleanup(text)') is not null
  or to_regprocedure('public.claim_meal_completion_photo_cleanup_batch(integer)') is not null
  or to_regprocedure('public.complete_meal_completion_photo_cleanup(uuid)') is not null then
    raise exception 'Meal completion photo contract already exists; inspect migration history or drift.';
  end if;

  select b.public, b.file_size_limit, b.allowed_mime_types
    into v_bucket_public, v_bucket_limit, v_bucket_mimes
    from storage.buckets as b
   where b.id = 'meal-completion-photos';

  if found and (
       v_bucket_public is distinct from false
       or v_bucket_limit is distinct from 4194304
       or v_bucket_mimes is distinct from array['image/jpeg']::text[]
     ) then
    raise exception 'Existing meal-completion-photos bucket does not match the private JPEG contract.';
  end if;

  if exists (
    select 1
      from storage.buckets
     where name = 'meal-completion-photos'
       and id <> 'meal-completion-photos'
  ) then
    raise exception 'meal-completion-photos bucket name is bound to a different id.';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and policyname in (
         'meal_completion_photo_objects_insert_own_canonical',
         'meal_completion_photo_objects_select_referenced_actor'
       )
  ) then
    raise exception 'Meal completion photo Storage policies already exist; inspect drift.';
  end if;
end
$preflight$;

alter table public.meals
  add column completion_photo_url text;

alter table public.meals
  add constraint meals_completion_photo_url_canonical_path_check
    check (
      completion_photo_url is null
      or completion_photo_url ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    ),
  add constraint meals_completion_photo_requires_eaten_check
    check (completion_photo_url is null or is_eaten is true);

comment on column public.meals.completion_photo_url is
  'Client-owned completion evidence path relative to the private meal-completion-photos bucket; distinct from photo_url.';

create unique index meals_completion_photo_url_unique
  on public.meals (completion_photo_url)
 where completion_photo_url is not null;

create table public.meal_completion_photo_cleanup_queue (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null,
  meal_id uuid not null,
  bucket_id text not null default 'meal-completion-photos',
  object_path text not null,
  reason text not null,
  available_at timestamptz not null default now(),
  attempt_count integer not null default 0,
  claimed_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint meal_completion_photo_cleanup_queue_bucket_check
    check (bucket_id = 'meal-completion-photos'),
  constraint meal_completion_photo_cleanup_queue_path_check
    check (
      object_path ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    ),
  constraint meal_completion_photo_cleanup_queue_client_check
    check (split_part(object_path, '/', 1) = client_id::text),
  constraint meal_completion_photo_cleanup_queue_meal_check
    check (split_part(object_path, '/', 2) = meal_id::text),
  constraint meal_completion_photo_cleanup_queue_reason_check
    check (reason in ('failed_save', 'replaced', 'meal_undone', 'meal_deleted')),
  constraint meal_completion_photo_cleanup_queue_attempt_count_check
    check (attempt_count >= 0)
);

alter table public.meal_completion_photo_cleanup_queue owner to postgres;
alter table public.meal_completion_photo_cleanup_queue enable row level security;
revoke all on table public.meal_completion_photo_cleanup_queue from public, anon, authenticated, service_role;

create unique index meal_completion_photo_cleanup_queue_one_pending_path_idx
  on public.meal_completion_photo_cleanup_queue (object_path)
 where completed_at is null;

create index meal_completion_photo_cleanup_queue_available_idx
  on public.meal_completion_photo_cleanup_queue (available_at, claimed_at, id)
 where completed_at is null;

create function private.enqueue_meal_completion_photo_cleanup(
  p_object_path text,
  p_meal_id uuid,
  p_client_id uuid,
  p_reason text
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
     or p_meal_id is null
     or p_client_id is null
     or p_reason not in ('failed_save', 'replaced', 'meal_undone', 'meal_deleted')
     or p_object_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
     or split_part(p_object_path, '/', 1) <> p_client_id::text
     or split_part(p_object_path, '/', 2) <> p_meal_id::text then
    raise exception 'Invalid meal completion photo cleanup request.' using errcode = '22023';
  end if;

  insert into public.meal_completion_photo_cleanup_queue (
    client_id,
    meal_id,
    bucket_id,
    object_path,
    reason
  ) values (
    p_client_id,
    p_meal_id,
    'meal-completion-photos',
    p_object_path,
    p_reason
  )
  on conflict (object_path) where completed_at is null do update
    set reason = excluded.reason,
        available_at = least(public.meal_completion_photo_cleanup_queue.available_at, now())
  returning id into v_id;

  return v_id;
end
$function$;

create function private.queue_replaced_meal_completion_photo()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_reason text;
begin
  if tg_op = 'DELETE' then
    v_reason := 'meal_deleted';
  elsif old.completion_photo_url is distinct from new.completion_photo_url then
    v_reason := case when new.is_eaten is false then 'meal_undone' else 'replaced' end;
  else
    return new;
  end if;

  if old.completion_photo_url is not null then
    perform private.enqueue_meal_completion_photo_cleanup(
      old.completion_photo_url,
      old.id,
      split_part(old.completion_photo_url, '/', 1)::uuid,
      v_reason
    );
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create trigger trg_queue_replaced_meal_completion_photo
after update of completion_photo_url or delete on public.meals
for each row execute function private.queue_replaced_meal_completion_photo();

create function public.enqueue_my_unreferenced_meal_completion_photo_cleanup(
  p_object_path text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_meal_id uuid;
begin
  if v_actor_id is null
     or p_object_path is null
     or p_object_path !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
     or split_part(p_object_path, '/', 1) <> v_actor_id::text
     or not exists (
       select 1
         from public.profiles as p
        where p.id = v_actor_id
          and p.role = 'client'::public.user_role
     )
       or not exists (
         select 1
           from storage.objects as o
          where o.bucket_id = 'meal-completion-photos'
            and o.name = p_object_path
            and split_part(o.name, '/', 1) = v_actor_id::text
            and (o.owner_id is null or o.owner_id = v_actor_id::text)
       )
     or exists (
       select 1
         from public.meals as m
        where m.completion_photo_url = p_object_path
     ) then
    raise exception 'Meal completion photo cleanup authorization failed.' using errcode = '42501';
  end if;

  v_meal_id := split_part(p_object_path, '/', 2)::uuid;
  return private.enqueue_meal_completion_photo_cleanup(
    p_object_path,
    v_meal_id,
    v_actor_id,
    'failed_save'
  );
end
$function$;

create function private.set_my_meal_completion_impl(
  p_meal_id uuid,
  p_is_eaten boolean,
  p_completion_photo_url text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid := auth.uid();
  v_meal public.meals%rowtype;
  v_object_owner text;
  v_object_mime text;
  v_object_size bigint;
  v_updated_count integer;
begin
  if v_user_id is null
     or p_meal_id is null
     or p_is_eaten is null then
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '42501';
  end if;

  if p_completion_photo_url is not null
     and (
       p_completion_photo_url <> btrim(p_completion_photo_url)
       or p_completion_photo_url !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
       or split_part(p_completion_photo_url, '/', 1) <> v_user_id::text
       or split_part(p_completion_photo_url, '/', 2) <> p_meal_id::text
     ) then
    raise exception 'Meal completion photo path is invalid.' using errcode = '22023';
  end if;

  if not p_is_eaten and p_completion_photo_url is not null then
    raise exception 'An undone meal cannot retain a completion photo.' using errcode = '22023';
  end if;

  select m.*
    into v_meal
    from public.meals as m
    join public.meal_plans as mp on mp.id = m.plan_id
    join public.dietitian_clients as dc
      on dc.dietitian_id = mp.dietitian_id
     and dc.client_id = mp.client_id
     and dc.status = 'active'::public.client_status
    join public.profiles as p on p.id = mp.client_id
   where m.id = p_meal_id
     and mp.client_id = v_user_id
     and p.role = 'client'::public.user_role
   for update of m;

  if not found then
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '42501';
  end if;

  if p_completion_photo_url is not null then
    select
      o.owner_id,
      o.metadata ->> 'mimetype',
      case
        when o.metadata ->> 'size' ~ '^[0-9]+$'
          then (o.metadata ->> 'size')::bigint
        else null
      end
      into v_object_owner, v_object_mime, v_object_size
      from storage.objects as o
     where o.bucket_id = 'meal-completion-photos'
       and o.name = p_completion_photo_url;

    if not found
      or (v_object_owner is not null and v_object_owner is distinct from v_user_id::text)
       or v_object_mime is distinct from 'image/jpeg'
       or v_object_size is null
       or v_object_size not between 1 and 4194304 then
      raise exception 'Meal completion photo object is not valid.' using errcode = '22023';
    end if;
  end if;

  update public.meals as m
     set is_eaten = p_is_eaten,
         completed_at = case
           when p_is_eaten then coalesce(m.completed_at, now())
           else null
         end,
         completion_photo_url = case
           when p_is_eaten then p_completion_photo_url
           else null
         end
   where m.id = v_meal.id;

  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '42501';
  end if;

  return true;
end
$function$;

create or replace function public.set_my_meal_completion(
  p_meal_id uuid,
  p_is_eaten boolean
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  -- The legacy two-argument contract means "no completion photo". This
  -- deliberately clears a stale path on both complete and undo.
  return private.set_my_meal_completion_impl(p_meal_id, p_is_eaten, null);
end
$function$;

create function public.set_my_meal_completion_with_photo(
  p_meal_id uuid,
  p_is_eaten boolean,
  p_completion_photo_url text
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  return private.set_my_meal_completion_impl(
    p_meal_id,
    p_is_eaten,
    p_completion_photo_url
  );
end
$function$;

create function public.claim_meal_completion_photo_cleanup_batch(
  p_limit integer default 50
)
returns table (cleanup_id uuid, bucket_id text, object_path text)
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'Meal completion photo cleanup worker authorization failed.' using errcode = '42501';
  end if;

  if p_limit is null or p_limit not between 1 and 100 then
    raise exception 'Invalid cleanup batch size.' using errcode = '22023';
  end if;

  return query
  with candidates as (
    select q.id
      from public.meal_completion_photo_cleanup_queue as q
     where q.completed_at is null
       and q.available_at <= now()
       and (q.claimed_at is null or q.claimed_at <= now() - interval '5 minutes')
       and not exists (
         select 1
           from public.meals as m
          where m.completion_photo_url = q.object_path
       )
     order by q.available_at, q.id
     for update skip locked
     limit p_limit
  ), claimed as (
    update public.meal_completion_photo_cleanup_queue as q
       set claimed_at = now(),
           attempt_count = q.attempt_count + 1
      from candidates as c
     where q.id = c.id
     returning q.id, q.bucket_id, q.object_path
  )
  select c.id, c.bucket_id, c.object_path
    from claimed as c;
end
$function$;

create function public.complete_meal_completion_photo_cleanup(
  p_cleanup_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_completed boolean;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role' then
    raise exception 'Meal completion photo cleanup worker authorization failed.' using errcode = '42501';
  end if;

  if p_cleanup_id is null then
    raise exception 'Invalid cleanup identifier.' using errcode = '22023';
  end if;

  update public.meal_completion_photo_cleanup_queue as q
     set completed_at = coalesce(q.completed_at, now())
   where q.id = p_cleanup_id
     and q.completed_at is null
     and not exists (
       select 1
         from public.meals as m
        where m.completion_photo_url = q.object_path
     )
     and not exists (
       select 1
         from storage.objects as o
        where o.bucket_id = q.bucket_id
          and o.name = q.object_path
     )
   returning true into v_completed;

  return coalesce(v_completed, false);
end
$function$;

alter function private.enqueue_meal_completion_photo_cleanup(text, uuid, uuid, text) owner to postgres;
alter function private.queue_replaced_meal_completion_photo() owner to postgres;
alter function private.set_my_meal_completion_impl(uuid, boolean, text) owner to postgres;
alter function public.set_my_meal_completion(uuid, boolean) owner to postgres;
alter function public.set_my_meal_completion_with_photo(uuid, boolean, text) owner to postgres;
alter function public.enqueue_my_unreferenced_meal_completion_photo_cleanup(text) owner to postgres;
alter function public.claim_meal_completion_photo_cleanup_batch(integer) owner to postgres;
alter function public.complete_meal_completion_photo_cleanup(uuid) owner to postgres;

revoke all on function private.enqueue_meal_completion_photo_cleanup(text, uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function private.queue_replaced_meal_completion_photo() from public, anon, authenticated, service_role;
revoke all on function private.set_my_meal_completion_impl(uuid, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.set_my_meal_completion(uuid, boolean) from public, anon, authenticated, service_role;
revoke all on function public.set_my_meal_completion_with_photo(uuid, boolean, text) from public, anon, authenticated, service_role;
revoke all on function public.enqueue_my_unreferenced_meal_completion_photo_cleanup(text) from public, anon, authenticated, service_role;
revoke all on function public.claim_meal_completion_photo_cleanup_batch(integer) from public, anon, authenticated, service_role;
revoke all on function public.complete_meal_completion_photo_cleanup(uuid) from public, anon, authenticated, service_role;

grant execute on function public.set_my_meal_completion(uuid, boolean) to authenticated;
grant execute on function public.set_my_meal_completion_with_photo(uuid, boolean, text) to authenticated;
grant execute on function public.enqueue_my_unreferenced_meal_completion_photo_cleanup(text) to authenticated;
grant execute on function public.claim_meal_completion_photo_cleanup_batch(integer) to service_role;
grant execute on function public.complete_meal_completion_photo_cleanup(uuid) to service_role;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'meal-completion-photos',
  'meal-completion-photos',
  false,
  4194304,
  array['image/jpeg']::text[]
)
on conflict (id) do nothing;

create policy meal_completion_photo_objects_insert_own_canonical
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'meal-completion-photos'
  and split_part(name, '/', 1) = (select auth.uid())::text
  and (select public.current_user_role()) = 'client'::public.user_role
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
  and exists (
    select 1
      from public.meals as m
      join public.meal_plans as mp on mp.id = m.plan_id
      join public.dietitian_clients as dc
        on dc.dietitian_id = mp.dietitian_id
       and dc.client_id = mp.client_id
       and dc.status = 'active'::public.client_status
     where m.id = split_part(name, '/', 2)::uuid
       and mp.client_id = (select auth.uid())
  )
  -- The Storage API applies the bucket MIME/size limits while inserting. The
  -- completion RPC revalidates the object metadata and the active meal/client
  -- relationship immediately before creating the database reference.
);

create policy meal_completion_photo_objects_select_referenced_actor
on storage.objects
for select
to authenticated
using (
  bucket_id = 'meal-completion-photos'
  and name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
  and exists (
    select 1
      from public.meals as m
      join public.meal_plans as mp on mp.id = m.plan_id
     where m.completion_photo_url = storage.objects.name
       and split_part(storage.objects.name, '/', 1) = mp.client_id::text
       and split_part(storage.objects.name, '/', 2) = m.id::text
       and (
         mp.client_id = (select auth.uid())
         or (
           mp.dietitian_id = (select auth.uid())
           and (select public.is_current_user_dietitian())
           and exists (
             select 1
               from public.dietitian_clients as dc
              where dc.dietitian_id = mp.dietitian_id
                and dc.client_id = mp.client_id
                and dc.status = 'active'::public.client_status
           )
         )
       )
  )
);

do $postflight$
declare
  v_mime_types text[];
begin
  select array_agg(mime_type order by mime_type)
    into v_mime_types
    from storage.buckets as b,
         unnest(b.allowed_mime_types) as mime_type
   where b.id = 'meal-completion-photos';

  if not exists (
    select 1
      from storage.buckets as b
     where b.id = 'meal-completion-photos'
       and b.name = 'meal-completion-photos'
       and b.public is false
       and b.file_size_limit = 4194304
  )
  or v_mime_types is distinct from array['image/jpeg']::text[]
  or not exists (
    select 1
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'meals'
       and column_name = 'completion_photo_url'
       and is_nullable = 'YES'
  )
  or to_regprocedure('public.set_my_meal_completion_with_photo(uuid,boolean,text)') is null
  or has_function_privilege('anon', 'public.set_my_meal_completion(uuid,boolean)', 'EXECUTE')
  or has_function_privilege('anon', 'public.set_my_meal_completion_with_photo(uuid,boolean,text)', 'EXECUTE')
  or has_function_privilege('anon', 'public.enqueue_my_unreferenced_meal_completion_photo_cleanup(text)', 'EXECUTE')
  or has_function_privilege('authenticated', 'public.claim_meal_completion_photo_cleanup_batch(integer)', 'EXECUTE')
  or has_function_privilege('authenticated', 'public.complete_meal_completion_photo_cleanup(uuid)', 'EXECUTE')
  or not has_function_privilege('authenticated', 'public.set_my_meal_completion_with_photo(uuid,boolean,text)', 'EXECUTE')
  or not has_function_privilege('authenticated', 'public.enqueue_my_unreferenced_meal_completion_photo_cleanup(text)', 'EXECUTE')
  or not has_function_privilege('service_role', 'public.claim_meal_completion_photo_cleanup_batch(integer)', 'EXECUTE')
  or not has_function_privilege('service_role', 'public.complete_meal_completion_photo_cleanup(uuid)', 'EXECUTE')
  or exists (
    select 1
      from pg_catalog.pg_policies
     where schemaname = 'storage'
       and tablename = 'objects'
       and lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%meal-completion-photos%'
       and (
         cmd in ('UPDATE', 'DELETE')
         or roles <> array['authenticated']::name[]
       )
  ) then
    raise exception 'Meal completion photo contract postcondition failed.';
  end if;
end
$postflight$;

notify pgrst, 'reload schema';
commit;
