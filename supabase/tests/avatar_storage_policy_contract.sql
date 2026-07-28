\set ON_ERROR_STOP on

begin;
set transaction read only;

do $$
declare
  target_policy record;
  normalized_qual text;
begin
  select
    cmd,
    roles,
    qual,
    with_check
  into target_policy
  from pg_catalog.pg_policies
  where schemaname = 'storage'
    and tablename = 'objects'
    and policyname = 'avatar_objects_select_linked_dietitian_for_active_client';

  if not found then
    raise exception 'FAIL: linked-dietitian avatar SELECT policy is missing';
  end if;

  if target_policy.cmd <> 'SELECT'
     or target_policy.roles <> array['authenticated']::name[]
     or target_policy.with_check is not null then
    raise exception 'FAIL: linked-dietitian avatar policy command/role/check contract drifted';
  end if;

  normalized_qual := pg_catalog.regexp_replace(
    pg_catalog.lower(target_policy.qual),
    '[[:space:]"()]',
    '',
    'g'
  );

  if pg_catalog.strpos(normalized_qual, 'objects.bucket_id=''avatars''::text') = 0
     or pg_catalog.strpos(normalized_qual, 'avatar\.(jpe?g|png|webp)') = 0
     or pg_catalog.strpos(normalized_qual, 'relationship.client_id=') = 0
     or pg_catalog.strpos(pg_catalog.lower(target_policy.qual), 'auth.uid()') = 0
     or pg_catalog.strpos(normalized_qual, 'relationship.status=''active''::client_status') = 0
     or pg_catalog.strpos(normalized_qual, 'relationship.dietitian_id::text=storage.foldernameobjects.name[1]') = 0
     or pg_catalog.strpos(normalized_qual, 'dietitian_profile.avatar_url=objects.name') = 0 then
    raise exception 'FAIL: linked-dietitian avatar policy predicate drifted';
  end if;

  if not exists (
    select 1
    from storage.buckets
    where id = 'avatars'
      and public is false
  ) then
    raise exception 'FAIL: avatars bucket must remain private';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Users can view own avatars'
      and cmd = 'SELECT'
  ) then
    raise exception 'FAIL: existing avatar owner SELECT policy is missing';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Dietitians can view active client avatars'
      and cmd = 'SELECT'
  ) then
    raise exception 'FAIL: existing dietitian-to-client avatar SELECT policy is missing';
  end if;
end
$$;

rollback;
