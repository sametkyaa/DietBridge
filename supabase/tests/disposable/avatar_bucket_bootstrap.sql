\set ON_ERROR_STOP on

begin;

do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null then
    raise exception 'Disposable Storage schema prerequisite is missing.';
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
on conflict (id) do nothing;

do $$
begin
  if not exists (
    select 1
    from storage.buckets
    where id = 'avatars'
      and name = 'avatars'
      and public is false
      and file_size_limit = 5242880
      and allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
  ) then
    raise exception 'Disposable avatars bucket does not match the exact prerequisite contract.';
  end if;
end
$$;

commit;

\echo DISPOSABLE_AVATAR_BOOTSTRAP_PASS
