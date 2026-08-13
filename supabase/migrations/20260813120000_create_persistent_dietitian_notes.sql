begin;

create table public.dietitian_notes (
  id uuid primary key default gen_random_uuid(),
  dietitian_id uuid not null references public.profiles(id) on delete cascade,
  client_id uuid null references public.profiles(id) on delete set null,
  title text not null,
  content text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint dietitian_notes_title_check check (char_length(btrim(title)) between 1 and 160),
  constraint dietitian_notes_content_check check (char_length(btrim(content)) between 1 and 10000),
  constraint dietitian_notes_distinct_client_check check (client_id is null or client_id <> dietitian_id)
);

create index dietitian_notes_owner_updated_idx on public.dietitian_notes (dietitian_id, updated_at desc, id);
create index dietitian_notes_client_idx on public.dietitian_notes (client_id) where client_id is not null;

create function public.enforce_dietitian_note_contract()
returns trigger language plpgsql set search_path = pg_catalog, public as $function$
begin
  new.title := btrim(new.title);
  new.content := btrim(new.content);
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    if new.id is distinct from old.id or new.dietitian_id is distinct from old.dietitian_id
       or new.created_at is distinct from old.created_at then
      raise exception 'Note identity and ownership fields are immutable.' using errcode = '42501';
    end if;
  end if;
  if new.client_id is not null and not exists (
    select 1 from public.dietitian_clients dc
    where dc.dietitian_id = new.dietitian_id and dc.client_id = new.client_id
      and dc.status = 'active'::public.client_status
  ) then
    raise exception 'Notes can reference only an active linked client.' using errcode = '42501';
  end if;
  new.updated_at := now();
  return new;
end
$function$;

create trigger dietitian_notes_enforce_contract before insert or update on public.dietitian_notes
for each row execute function public.enforce_dietitian_note_contract();

alter table public.dietitian_notes enable row level security;

create policy "Approved dietitians can select own notes" on public.dietitian_notes
for select to authenticated using (dietitian_id = (select auth.uid()) and (select public.is_current_user_dietitian()));
create policy "Approved dietitians can create own notes" on public.dietitian_notes
for insert to authenticated with check (
  dietitian_id = (select auth.uid()) and (select public.is_current_user_dietitian()) and (
    client_id is null or exists (
      select 1 from public.dietitian_clients dc where dc.dietitian_id = (select auth.uid())
      and dc.client_id = dietitian_notes.client_id and dc.status = 'active'::public.client_status
    )
  )
);
-- A stale client link may only be cleared; it cannot remain attached to a mutation.
create policy "Approved dietitians can update own notes" on public.dietitian_notes
for update to authenticated using (dietitian_id = (select auth.uid()) and (select public.is_current_user_dietitian()))
with check (
  dietitian_id = (select auth.uid()) and (select public.is_current_user_dietitian()) and (
    client_id is null or exists (
      select 1 from public.dietitian_clients dc where dc.dietitian_id = (select auth.uid())
      and dc.client_id = dietitian_notes.client_id and dc.status = 'active'::public.client_status
    )
  )
);
create policy "Approved dietitians can delete own notes" on public.dietitian_notes
for delete to authenticated using (dietitian_id = (select auth.uid()) and (select public.is_current_user_dietitian()));

revoke all privileges on table public.dietitian_notes from public, anon, authenticated;
grant select, insert, update, delete on table public.dietitian_notes to authenticated;
grant all privileges on table public.dietitian_notes to service_role;
revoke all on function public.enforce_dietitian_note_contract() from public, anon, authenticated;
grant execute on function public.enforce_dietitian_note_contract() to service_role;

comment on table public.dietitian_notes is 'Private dietitian-owned notes; optional client association never grants client visibility.';

do $postflight$
begin
  if to_regclass('public.dietitian_notes') is null
    or not (select relrowsecurity from pg_class where oid = 'public.dietitian_notes'::regclass)
    or (select count(*) from pg_policies where schemaname = 'public' and tablename = 'dietitian_notes') <> 4
    or has_table_privilege('anon', 'public.dietitian_notes', 'select')
    or not has_table_privilege('authenticated', 'public.dietitian_notes', 'select,insert,update,delete') then
    raise exception 'Dietitian notes schema, RLS, or privilege postflight failed.';
  end if;
end
$postflight$;

commit;
