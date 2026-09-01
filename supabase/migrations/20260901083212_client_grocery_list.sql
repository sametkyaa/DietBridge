-- Package 3: client-private manual grocery list.
-- This migration creates schema and RLS only; it inserts no fixture data.

begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regprocedure('public.current_user_role()') is null then
    raise exception 'Grocery list prerequisites are missing; migration stopped.';
  end if;

  if to_regclass('public.grocery_items') is not null then
    raise exception 'public.grocery_items already exists; migration will not overwrite it.';
  end if;
end
$preflight$;

create table public.grocery_items (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null
    references public.profiles(id) on delete cascade,
  name text not null,
  is_completed boolean not null default false,
  created_at timestamptz not null default now(),
  constraint grocery_items_name_length_check
    check (char_length(btrim(name)) between 1 and 120)
);

create index grocery_items_client_completion_created_idx
  on public.grocery_items (client_id, is_completed, created_at, id);

alter table public.grocery_items enable row level security;

create policy grocery_items_select_own_client
on public.grocery_items
for select
to authenticated
using (
  client_id = (select auth.uid())
  and (select public.current_user_role()) = 'client'::public.user_role
);

create policy grocery_items_insert_own_client
on public.grocery_items
for insert
to authenticated
with check (
  client_id = (select auth.uid())
  and (select public.current_user_role()) = 'client'::public.user_role
);

create policy grocery_items_update_own_client
on public.grocery_items
for update
to authenticated
using (
  client_id = (select auth.uid())
  and (select public.current_user_role()) = 'client'::public.user_role
)
with check (
  client_id = (select auth.uid())
  and (select public.current_user_role()) = 'client'::public.user_role
);

create policy grocery_items_delete_own_client
on public.grocery_items
for delete
to authenticated
using (
  client_id = (select auth.uid())
  and (select public.current_user_role()) = 'client'::public.user_role
);

revoke all privileges on table public.grocery_items from public, anon, authenticated;
grant select, insert, update, delete on table public.grocery_items to authenticated;
grant all privileges on table public.grocery_items to service_role;

comment on table public.grocery_items is
  'Client-private manually managed grocery items.';

do $postflight$
begin
  if to_regclass('public.grocery_items') is null
     or not (select relrowsecurity from pg_class where oid = 'public.grocery_items'::regclass)
     or not exists (
       select 1
       from pg_constraint
       where conrelid = 'public.grocery_items'::regclass
         and conname = 'grocery_items_name_length_check'
         and contype = 'c'
     )
     or not exists (
       select 1
       from pg_indexes
       where schemaname = 'public'
         and tablename = 'grocery_items'
         and indexname = 'grocery_items_client_completion_created_idx'
     )
     or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'grocery_items') <> 4
     or has_table_privilege('anon', 'public.grocery_items', 'select')
     or has_table_privilege('anon', 'public.grocery_items', 'insert')
     or has_table_privilege('anon', 'public.grocery_items', 'update')
     or has_table_privilege('anon', 'public.grocery_items', 'delete')
     or not has_table_privilege('authenticated', 'public.grocery_items', 'select')
     or not has_table_privilege('authenticated', 'public.grocery_items', 'insert')
     or not has_table_privilege('authenticated', 'public.grocery_items', 'update')
     or not has_table_privilege('authenticated', 'public.grocery_items', 'delete') then
    raise exception 'Grocery list schema, RLS, constraint, index, or privilege postflight failed.';
  end if;
end
$postflight$;

commit;
