-- Storage creates object metadata after the INSERT policy is evaluated.
-- Keep authorization path-only; bucket settings enforce MIME and byte limits.
begin;

do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.dietitian_clients') is null then
    raise exception 'Meal-photo storage policy prerequisites are missing.';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'meal-photos'
      and public is false
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then
    raise exception 'meal-photos bucket contract is not the expected private image-only configuration.';
  end if;
end
$$;

drop policy if exists meal_photo_objects_insert_active_dietitian on storage.objects;

create policy meal_photo_objects_insert_active_dietitian
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'meal-photos'
  and name ~ '^meal-plans/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpe?g|png|webp)$'
  and split_part(name, '/', 3) = (select auth.uid())::text
  and exists (
    select 1
    from public.profiles as dietitian_profile
    join public.dietitian_profiles as verification
      on verification.user_id = dietitian_profile.id
    join public.dietitian_clients as relationship
      on relationship.dietitian_id = dietitian_profile.id
     and relationship.client_id::text = split_part(storage.objects.name, '/', 2)
    where dietitian_profile.id = (select auth.uid())
      and dietitian_profile.role = 'dietitian'::public.user_role
      and verification.verification_status = 'approved'
      and verification.is_verified is true
      and relationship.status = 'active'::public.client_status
  )
);

commit;
