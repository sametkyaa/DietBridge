-- MVP-3 forward-only correction: the Storage service supplies MIME during the
-- INSERT policy check, but persists object size only after that check. Keep
-- content constraints on the private bucket and keep RLS focused on actor,
-- canonical path, approval, and active relationship authorization.
begin;

do $preflight$
declare
  v_mime_types text[];
  v_insert_check text;
  v_select_qual text;
begin
  select array_agg(mime_type order by mime_type)
    into v_mime_types
    from storage.buckets as b,
         unnest(b.allowed_mime_types) as mime_type
   where b.id = 'meal-photos';

  if not exists (
    select 1 from storage.buckets as b
     where b.id = 'meal-photos'
       and b.name = 'meal-photos'
       and b.public is false
       and b.file_size_limit = 5242880
       and cardinality(b.allowed_mime_types) = 3
  ) or v_mime_types is distinct from array['image/jpeg', 'image/png', 'image/webp']::text[] then
    raise exception 'meal-photos bucket differs from the immutable private 5 MiB JPEG/PNG/WebP contract.';
  end if;

  if (select count(*) from pg_catalog.pg_policies
       where schemaname = 'storage' and tablename = 'objects'
         and lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%meal-photos%') <> 2
     or exists (
       select 1 from pg_catalog.pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%meal-photos%'
          and cmd in ('UPDATE', 'DELETE')
     ) then
    raise exception 'Unexpected meal-photo policy surface; correction refused.';
  end if;

  select qual into v_select_qual
    from pg_catalog.pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'meal_photo_objects_select_referenced_linked_actor'
     and permissive = 'PERMISSIVE' and cmd = 'SELECT'
     and roles = array['authenticated']::name[]
     and with_check is null;

  if v_select_qual is null
     or v_select_qual not like '%m.photo_url = objects.name%'
     or v_select_qual not like '%dietitian_clients%'
     or v_select_qual not like '%dc.status = ''active''%'
     or v_select_qual not like '%p.client_id%split_part(objects.name, ''/''::text, 2)%'
     or v_select_qual not like '%p.dietitian_id%split_part(objects.name, ''/''::text, 3)%'
     or v_select_qual not like '%is_current_user_dietitian%'
     or v_select_qual not like '%auth.uid()%'
     or v_select_qual not like '%p.client_id%' then
    raise exception 'Expected canonical referenced-meal SELECT policy shape is absent; correction refused.';
  end if;

  select with_check into v_insert_check
    from pg_catalog.pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'meal_photo_objects_insert_active_approved_dietitian'
     and permissive = 'PERMISSIVE' and cmd = 'INSERT'
     and roles = array['authenticated']::name[]
     and qual is null;

  if v_insert_check is null
     or v_insert_check not like '%metadata%''mimetype''%'
     or v_insert_check not like '%metadata%''size''%'
     or v_insert_check not like '%is_current_user_dietitian%'
     or v_insert_check not like '%dietitian_clients%'
     or v_insert_check not like '%split_part(name, ''/''::text, 3)%'
     or v_insert_check not like '%auth.uid()%'
     or v_insert_check not like '%split_part(%''/''::text, 2)%' then
    raise exception 'Expected defective MVP-3 INSERT policy shape is absent; correction refused.';
  end if;
end
$preflight$;

drop policy meal_photo_objects_insert_active_approved_dietitian on storage.objects;

create policy meal_photo_objects_insert_active_approved_dietitian
on storage.objects for insert to authenticated
with check (
  bucket_id = 'meal-photos'
  and name ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and split_part(name, '/', 3) = (select auth.uid())::text
  and (select public.is_current_user_dietitian())
  and exists (
    select 1 from public.dietitian_clients as dc
     where dc.dietitian_id = (select auth.uid())
       and dc.client_id::text = split_part(name, '/', 2)
       and dc.status = 'active'::public.client_status
  )
);

do $postflight$
declare
  v_mime_types text[];
  v_insert_check text;
  v_select_qual text;
begin
  select array_agg(mime_type order by mime_type)
    into v_mime_types
    from storage.buckets as b,
         unnest(b.allowed_mime_types) as mime_type
   where b.id = 'meal-photos';

  if not exists (
    select 1 from storage.buckets as b
     where b.id = 'meal-photos' and b.name = 'meal-photos' and b.public is false
       and b.file_size_limit = 5242880 and cardinality(b.allowed_mime_types) = 3
  ) or v_mime_types is distinct from array['image/jpeg', 'image/png', 'image/webp']::text[] then
    raise exception 'Meal-photo bucket postcondition changed unexpectedly.';
  end if;

  select with_check into v_insert_check
    from pg_catalog.pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'meal_photo_objects_insert_active_approved_dietitian'
     and permissive = 'PERMISSIVE' and cmd = 'INSERT'
     and roles = array['authenticated']::name[]
     and qual is null;

  if v_insert_check is null
     or v_insert_check like '%metadata%'
     or v_insert_check not like '%is_current_user_dietitian%'
     or v_insert_check not like '%dietitian_clients%'
     or v_insert_check not like '%^meal-plans/%'
     or v_insert_check not like '%(jpe?g|png|webp)$%'
     or v_insert_check not like '%split_part(name, ''/''::text, 3)%'
     or v_insert_check not like '%auth.uid()%'
     or v_insert_check not like '%split_part(%''/''::text, 2)%'
     or (select count(*) from pg_catalog.pg_policies
          where schemaname = 'storage' and tablename = 'objects'
            and lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%meal-photos%') <> 2 then
    raise exception 'Corrected meal-photo INSERT policy postcondition failed.';
  end if;

  select qual into v_select_qual
    from pg_catalog.pg_policies
   where schemaname = 'storage' and tablename = 'objects'
     and policyname = 'meal_photo_objects_select_referenced_linked_actor'
     and permissive = 'PERMISSIVE' and cmd = 'SELECT'
     and roles = array['authenticated']::name[] and with_check is null;

  if v_select_qual is null
     or v_select_qual not like '%m.photo_url = objects.name%'
     or v_select_qual not like '%dietitian_clients%'
     or v_select_qual not like '%dc.status = ''active''%'
     or v_select_qual not like '%p.client_id%split_part(objects.name, ''/''::text, 2)%'
     or v_select_qual not like '%p.dietitian_id%split_part(objects.name, ''/''::text, 3)%'
     or v_select_qual not like '%is_current_user_dietitian%'
     or exists (
       select 1 from pg_catalog.pg_policies
        where schemaname = 'storage' and tablename = 'objects'
          and lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%meal-photos%'
          and cmd in ('UPDATE', 'DELETE')
     ) then
    raise exception 'Meal-photo SELECT or no-browser-mutation postcondition failed.';
  end if;
end
$postflight$;

notify pgrst, 'reload schema';
commit;
