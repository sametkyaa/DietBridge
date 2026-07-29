begin;

do $$
begin
  if to_regclass('public.chat_messages') is null
     or to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_read_states') is null
     or to_regprocedure('public.enforce_chat_message_contract()') is null then
    raise exception 'Canonical chat prerequisites are missing.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_messages'
      and column_name = 'message_kind'
  )
  or to_regclass('public.chat_upload_intents') is not null
  or to_regclass('public.chat_attachments') is not null then
    raise exception 'Chat image schema already exists; inspect migration history or drift.';
  end if;
end
$$;

alter table public.chat_messages
  add column message_kind text not null default 'text';

alter table public.chat_messages
  add constraint chat_messages_message_kind_check
    check (message_kind in ('text', 'image')),
  drop constraint chat_messages_canonical_shape_check,
  add constraint chat_messages_canonical_shape_check check (
    (
      conversation_id is null
      and client_message_id is null
      and body is null
      and deleted_at is null
      and deleted_by is null
      and message_kind = 'text'
    )
    or (
      conversation_id is not null
      and sender_id is not null
      and client_message_id is not null
      and message_kind = 'text'
      and body is not null
      and deleted_at is null
      and deleted_by is null
    )
    or (
      conversation_id is not null
      and sender_id is not null
      and client_message_id is not null
      and message_kind = 'image'
      and deleted_at is null
      and deleted_by is null
    )
    or (
      conversation_id is not null
      and sender_id is not null
      and client_message_id is not null
      and body is null
      and deleted_at is not null
      and deleted_by is not distinct from sender_id
      and message_kind in ('text', 'image')
    )
  );

create table public.chat_upload_intents (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null
    references public.chat_conversations(id) on delete restrict,
  created_by uuid not null
    references public.profiles(id) on delete restrict,
  client_message_id uuid not null,
  bucket_id text not null default 'chat-images',
  object_path text not null,
  expected_mime text not null,
  max_bytes bigint not null default 4194304,
  status text not null default 'pending',
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  validated_mime text,
  validated_byte_size bigint,
  validated_width integer,
  validated_height integer,
  validated_at timestamptz,
  finalized_at timestamptz,
  aborted_at timestamptz,
  constraint chat_upload_intents_actor_client_key
    unique (created_by, client_message_id),
  constraint chat_upload_intents_bucket_path_key
    unique (bucket_id, object_path),
  constraint chat_upload_intents_bucket_check
    check (bucket_id = 'chat-images'),
  constraint chat_upload_intents_path_check
    check (
      object_path ~ '^pending/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    ),
  constraint chat_upload_intents_expected_mime_check
    check (expected_mime = 'image/jpeg'),
  constraint chat_upload_intents_max_bytes_check
    check (max_bytes = 4194304),
  constraint chat_upload_intents_expiry_check
    check (expires_at > created_at),
  constraint chat_upload_intents_status_check
    check (status in ('pending', 'finalized', 'aborted')),
  constraint chat_upload_intents_state_timestamps_check check (
    (status = 'pending' and finalized_at is null and aborted_at is null)
    or (status = 'finalized' and finalized_at is not null and aborted_at is null)
    or (status = 'aborted' and finalized_at is null and aborted_at is not null)
  ),
  constraint chat_upload_intents_validation_shape_check check (
    num_nonnulls(
      validated_mime,
      validated_byte_size,
      validated_width,
      validated_height,
      validated_at
    ) = 0
    or (
      num_nonnulls(
        validated_mime,
        validated_byte_size,
        validated_width,
        validated_height,
        validated_at
      ) = 5
      and
      validated_mime = 'image/jpeg'
      and validated_byte_size between 1 and 4194304
      and validated_width between 1 and 2048
      and validated_height between 1 and 2048
      and validated_width::bigint * validated_height::bigint <= 4194304
      and validated_at is not null
    )
  ),
  constraint chat_upload_intents_finalized_validation_check
    check (status <> 'finalized' or validated_at is not null)
);

create index chat_upload_intents_owner_status_expiry_idx
  on public.chat_upload_intents (created_by, status, expires_at, id);

create index chat_upload_intents_conversation_status_idx
  on public.chat_upload_intents (conversation_id, status, expires_at, id);

create table public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null unique
    references public.chat_messages(id) on delete restrict,
  intent_id uuid not null unique
    references public.chat_upload_intents(id) on delete restrict,
  bucket_id text not null,
  object_path text not null unique,
  mime_type text not null,
  byte_size bigint not null,
  width integer not null,
  height integer not null,
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint chat_attachments_bucket_check
    check (bucket_id = 'chat-images'),
  constraint chat_attachments_path_check
    check (
      object_path ~ '^pending/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
    ),
  constraint chat_attachments_mime_check
    check (mime_type = 'image/jpeg'),
  constraint chat_attachments_byte_size_check
    check (byte_size between 1 and 4194304),
  constraint chat_attachments_dimensions_check
    check (
      width between 1 and 2048
      and height between 1 and 2048
      and width::bigint * height::bigint <= 4194304
    )
);

comment on table public.chat_upload_intents is
  'Canonical JPEG-only chat image upload intents. Before creating an intent, web and mobile clients must decode a picked JPEG, PNG, or WebP; apply orientation; resize to at most 2048 px on the longest edge and 4194304 total pixels; re-encode as image/jpeg at approximately 82 percent quality; strip EXIF and all other metadata; and keep the result at or below 4194304 bytes.';

create index chat_attachments_live_message_idx
  on public.chat_attachments (message_id)
  where deleted_at is null;

create or replace function public.enforce_chat_message_contract()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_dietitian_id uuid;
  v_client_id uuid;
begin
  if tg_op = 'UPDATE' then
    if old.conversation_id is null
       or old.deleted_at is not null
       or (
         new.conversation_id,
         new.sender_id,
         new.client_message_id,
         new.created_at,
         new.receiver_id,
         new.message_text,
         new.edited_at,
         new.message_kind
       ) is distinct from (
         old.conversation_id,
         old.sender_id,
         old.client_message_id,
         old.created_at,
         old.receiver_id,
         old.message_text,
         old.edited_at,
         old.message_kind
       )
       or new.body is not null
       or new.deleted_at is null
       or new.deleted_by is distinct from old.sender_id then
      raise exception 'Invalid canonical chat message update.' using errcode = '23514';
    end if;
    return new;
  end if;

  if new.conversation_id is null then
    raise exception 'New legacy chat_messages rows are not permitted.' using errcode = '23514';
  end if;

  select c.dietitian_id, c.client_id
    into v_dietitian_id, v_client_id
    from public.chat_conversations as c
    where c.id = new.conversation_id
    for key share;

  if not found
     or new.sender_id is null
     or new.sender_id not in (v_dietitian_id, v_client_id)
     or new.client_message_id is null
     or new.message_kind not in ('text', 'image')
     or new.deleted_at is not null
     or new.deleted_by is not null
     or (new.message_kind = 'text' and new.body is null)
     or (
       new.body is not null
       and char_length(btrim(new.body)) not between 1 and 4000
     ) then
    raise exception 'Invalid canonical chat message.' using errcode = '23514';
  end if;

  if new.body is not null then
    new.body := btrim(new.body);
  end if;
  return new;
end
$function$;

create function public.enforce_chat_attachment_contract()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_message_kind text;
  v_message_deleted_at timestamptz;
  v_intent public.chat_upload_intents%rowtype;
begin
  if tg_op = 'UPDATE' then
    if old.deleted_at is not null
       or new.deleted_at is null
       or (
         new.message_id,
         new.intent_id,
         new.bucket_id,
         new.object_path,
         new.mime_type,
         new.byte_size,
         new.width,
         new.height,
         new.created_at
       ) is distinct from (
         old.message_id,
         old.intent_id,
         old.bucket_id,
         old.object_path,
         old.mime_type,
         old.byte_size,
         old.width,
         old.height,
         old.created_at
       ) then
      raise exception 'Invalid chat attachment update.' using errcode = '23514';
    end if;
    return new;
  end if;

  select m.message_kind, m.deleted_at
    into v_message_kind, v_message_deleted_at
    from public.chat_messages as m
    where m.id = new.message_id
    for key share;

  if not found or v_message_kind <> 'image' or v_message_deleted_at is not null then
    raise exception 'Chat attachment requires a live image message.' using errcode = '23514';
  end if;

  select i.*
    into v_intent
    from public.chat_upload_intents as i
    where i.id = new.intent_id
    for key share;

  if not found
     or v_intent.status <> 'finalized'
     or v_intent.bucket_id is distinct from new.bucket_id
     or v_intent.object_path is distinct from new.object_path
     or v_intent.validated_mime is distinct from new.mime_type
     or v_intent.validated_byte_size is distinct from new.byte_size
     or v_intent.validated_width is distinct from new.width
     or v_intent.validated_height is distinct from new.height then
    raise exception 'Chat attachment does not match its finalized intent.' using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger trg_enforce_chat_attachment_contract
before insert or update on public.chat_attachments
for each row execute function public.enforce_chat_attachment_contract();

alter table public.chat_upload_intents enable row level security;
alter table public.chat_attachments enable row level security;

revoke all on table public.chat_upload_intents from public, anon, authenticated;
revoke all on table public.chat_attachments from public, anon, authenticated;
revoke all on function public.enforce_chat_attachment_contract() from public, anon, authenticated, service_role;

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_messages'
      and column_name = 'message_kind'
      and is_nullable = 'NO'
      and column_default like '%text%'
  )
  or to_regclass('public.chat_upload_intents') is null
  or to_regclass('public.chat_attachments') is null
  or to_regprocedure('public.enforce_chat_attachment_contract()') is null then
    raise exception 'Chat image schema postcondition failed.';
  end if;
end
$$;

commit;
