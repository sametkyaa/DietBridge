begin;

do $$
begin
  if to_regclass('storage.buckets') is null
     or to_regclass('storage.objects') is null
     or to_regclass('public.chat_upload_intents') is null
     or to_regclass('public.chat_attachments') is null then
    raise exception 'Chat image Storage prerequisites are missing.';
  end if;
end
$$;

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
) values (
  'chat-images',
  'chat-images',
  false,
  4194304,
  array['image/jpeg']::text[]
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists chat_images_insert_pending_intent on storage.objects;
create policy chat_images_insert_pending_intent
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'chat-images'
  and owner = (select auth.uid())
  and exists (
    select 1
    from public.chat_upload_intents as i
    where i.created_by = (select auth.uid())
      and i.bucket_id = storage.objects.bucket_id
      and i.object_path = storage.objects.name
      and i.expected_mime = 'image/jpeg'
      and i.status = 'pending'
      and i.expires_at > now()
      and i.validated_at is null
  )
);

drop policy if exists chat_images_select_live_attachment on storage.objects;
create policy chat_images_select_live_attachment
on storage.objects
for select
to authenticated
using (
  bucket_id = 'chat-images'
  and exists (
    select 1
    from public.chat_attachments as a
    join public.chat_messages as m
      on m.id = a.message_id
    join public.chat_conversations as c
      on c.id = m.conversation_id
    where a.bucket_id = storage.objects.bucket_id
      and a.object_path = storage.objects.name
      and a.deleted_at is null
      and m.message_kind = 'image'
      and m.deleted_at is null
      and (select auth.uid()) in (c.dietitian_id, c.client_id)
  )
);

do $$
declare
  v_public boolean;
  v_limit bigint;
  v_mimes text[];
begin
  select b.public, b.file_size_limit, b.allowed_mime_types
    into v_public, v_limit, v_mimes
    from storage.buckets as b
    where b.id = 'chat-images';

  if not found
     or v_public
     or v_limit is distinct from 4194304
     or v_mimes is distinct from array['image/jpeg']::text[]
     or exists (
       select 1 from pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and policyname in (
           'chat_images_insert_pending_intent',
           'chat_images_select_live_attachment'
         )
         and roles <> array['authenticated']::name[]
     )
     or exists (
       select 1 from pg_policies
       where schemaname = 'storage'
         and tablename = 'objects'
         and policyname like 'chat_images_%'
         and cmd in ('UPDATE', 'DELETE')
     ) then
    raise exception 'Chat image Storage postcondition failed.';
  end if;
end
$$;

commit;
