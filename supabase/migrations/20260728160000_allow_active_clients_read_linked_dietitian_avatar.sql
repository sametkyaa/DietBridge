begin;

do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regtype('public.client_status') is null
     or to_regprocedure('storage.foldername(text)') is null then
    raise exception 'Expected linked-dietitian avatar Storage contract is missing; migration stopped.';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'avatars'
      and public is false
  ) then
    raise exception 'Expected private avatars bucket is missing; migration stopped.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'avatar_objects_select_linked_dietitian_for_active_client'
  ) then
    raise exception 'Target linked-dietitian avatar policy already exists; migration stopped.';
  end if;
end
$$;

create policy avatar_objects_select_linked_dietitian_for_active_client
on storage.objects
for select
to authenticated
using (
  storage.objects.bucket_id = 'avatars'
  and storage.objects.name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/avatar\.(jpe?g|png|webp)$'
  and exists (
    select 1
    from public.dietitian_clients as relationship
    join public.profiles as dietitian_profile
      on dietitian_profile.id = relationship.dietitian_id
    where relationship.client_id = (select auth.uid())
      and relationship.status = 'active'::public.client_status
      and relationship.dietitian_id::text = (storage.foldername(storage.objects.name))[1]
      and dietitian_profile.avatar_url = storage.objects.name
  )
);

commit;
