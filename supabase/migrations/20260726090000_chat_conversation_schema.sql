-- Aşama 6.1: Legacy chat_messages tablosunu veri kaybetmeden canonical
-- conversation/message/read-state modeline hazırlar. Supabase migration runner
-- bu dosyayı tek transaction içinde uygular; mevcut satırlar legacy kalır.

do $$
begin
  if to_regclass('public.chat_messages') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regclass('public.profiles') is null then
    raise exception 'Chat schema prerequisites are missing.';
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'chat_messages'
      and column_name not in ('id', 'sender_id', 'receiver_id', 'message_text', 'created_at', 'is_read')
  ) then
    raise exception 'chat_messages has unexpected columns; inspect legacy drift before migration.';
  end if;

  if to_regclass('public.chat_conversations') is not null
     or to_regclass('public.chat_read_states') is not null then
    raise exception 'Canonical chat tables already exist; migration history or schema drift must be reconciled first.';
  end if;
end
$$
-- Legacy columns remain untouched. Canonical messages use the new nullable
-- columns; the next migration prevents partially canonical rows.
alter table public.chat_messages
  add column conversation_id uuid,
  add column client_message_id uuid,
  add column body text,
  add column edited_at timestamptz,
  add column deleted_at timestamptz
create table public.chat_conversations (
  id uuid primary key default gen_random_uuid(),
  dietitian_client_id uuid not null,
  dietitian_id uuid not null,
  client_id uuid not null,
  last_message_id uuid,
  last_message_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_conversations_dietitian_client_fkey
    foreign key (dietitian_client_id)
    references public.dietitian_clients(id)
    on delete restrict,
  constraint chat_conversations_dietitian_fkey
    foreign key (dietitian_id)
    references public.profiles(id)
    on delete restrict,
  constraint chat_conversations_client_fkey
    foreign key (client_id)
    references public.profiles(id)
    on delete restrict,
  constraint chat_conversations_last_message_fkey
    foreign key (last_message_id)
    references public.chat_messages(id)
    on delete restrict
)
alter table public.chat_messages
  add constraint chat_messages_conversation_fkey
    foreign key (conversation_id)
    references public.chat_conversations(id)
    on delete restrict
create table public.chat_read_states (
  conversation_id uuid not null,
  user_id uuid not null,
  last_read_message_id uuid,
  last_read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chat_read_states_pkey primary key (conversation_id, user_id),
  constraint chat_read_states_conversation_fkey
    foreign key (conversation_id)
    references public.chat_conversations(id)
    on delete restrict,
  constraint chat_read_states_user_fkey
    foreign key (user_id)
    references public.profiles(id)
    on delete restrict,
  constraint chat_read_states_last_read_message_fkey
    foreign key (last_read_message_id)
    references public.chat_messages(id)
    on delete restrict
)
do $$
begin
  if to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_read_states') is null
     or not exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'chat_messages'
         and column_name = 'conversation_id'
     ) then
    raise exception 'Chat schema postcondition failed.';
  end if;
end
$$
-- Forward-only rollback: do not drop these tables or columns from an applied
-- environment. Ship a separately reviewed forward-fix migration if needed.
