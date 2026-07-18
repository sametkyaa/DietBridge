-- WP4.6: keep private avatar objects behind owner/active-relationship Storage RLS.
-- Canonical stored paths use: <profile uuid>/avatar.<jpg|jpeg|png|webp>.

begin;

do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regprocedure('storage.foldername(text)') is null then
    raise exception 'Expected avatar Storage contract is missing; migration stopped.';
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
  'avatars',
  'avatars',
  false,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Remove only clearly avatar-scoped legacy policies. If an ambiguously named
-- multi-bucket policy also references this bucket, stop for manual review.
do $$
declare
  avatar_policy record;
begin
  for avatar_policy in
    select
      policyname,
      lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) as expression
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and (
        lower(policyname) like '%avatar%'
        or lower(coalesce(qual, '') || ' ' || coalesce(with_check, '')) like '%avatars%'
      )
  loop
    if lower(avatar_policy.policyname) not like '%avatar%' then
      raise exception
        'Storage policy % references avatars but is not avatar-scoped; migration stopped.',
        avatar_policy.policyname;
    end if;

    execute format(
      'drop policy if exists %I on storage.objects',
      avatar_policy.policyname
    );
  end loop;
end
$$;

create policy avatar_objects_select_authorized
on storage.objects
for select
to authenticated
using (
  bucket_id = 'avatars'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/avatar\.(jpe?g|png|webp)$'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or (
      exists (
        select 1
        from public.profiles as profile
        where profile.id::text = (storage.foldername(name))[1]
          and profile.avatar_url = name
      )
      and exists (
        select 1
        from public.dietitian_clients as relationship
        where relationship.dietitian_id = auth.uid()
          and relationship.client_id::text = (storage.foldername(name))[1]
          and relationship.status = 'active'
      )
    )
  )
);

create policy avatar_objects_insert_own
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'avatars'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/avatar\.(jpe?g|png|webp)$'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy avatar_objects_update_own
on storage.objects
for update
to authenticated
using (
  bucket_id = 'avatars'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/avatar\.(jpe?g|png|webp)$'
  and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/avatar\.(jpe?g|png|webp)$'
  and (storage.foldername(name))[1] = auth.uid()::text
);

create policy avatar_objects_delete_own
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'avatars'
  and name ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/avatar\.(jpe?g|png|webp)$'
  and (storage.foldername(name))[1] = auth.uid()::text
);

commit;
