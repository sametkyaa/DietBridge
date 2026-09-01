-- Client account deletion hardening.
--
-- This is a forward-only amendment to the original account-deletion
-- migration. The tombstone and exact Storage manifest are owned by Auth,
-- not by public.profiles, so an Auth-admin failure leaves a retryable state
-- while the relational cleanup has already made the profile unusable.

begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.platform_admins') is null
     or to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_upload_intents') is null
     or to_regclass('public.chat_attachments') is null
     or to_regprocedure('public.delete_client_account_data(uuid)') is null then
    raise exception 'Client account deletion hardening prerequisites are missing.';
  end if;

  if to_regclass('public.client_account_deletion_tombstones') is not null
     or to_regclass('public.client_account_deletion_storage_manifest') is not null
     or to_regprocedure('public.prepare_client_account_deletion(uuid,jsonb)') is not null
     or to_regprocedure('public.get_client_account_deletion_state(uuid)') is not null
     or to_regprocedure('public.mark_client_account_storage_cleaned(uuid)') is not null then
    raise exception 'Client account deletion hardening objects already exist; refusing overwrite.';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.profiles'::regclass
       and confrelid = 'auth.users'::regclass
       and contype = 'f'
       and confdeltype = 'c'
  ) then
    raise exception 'The profiles to Auth cascade is missing; refusing hardening migration.';
  end if;
end
$preflight$;

create table public.client_account_deletion_tombstones (
  user_id uuid primary key
    references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  relational_cleanup_at timestamptz,
  storage_cleanup_at timestamptz,
  constraint client_account_deletion_tombstone_timestamps_check check (
    (relational_cleanup_at is null or relational_cleanup_at >= started_at)
    and (storage_cleanup_at is null or storage_cleanup_at >= started_at)
    and (storage_cleanup_at is null or relational_cleanup_at is not null)
  )
);

create table public.client_account_deletion_storage_manifest (
  user_id uuid not null
    references auth.users(id) on delete cascade,
  bucket_id text not null,
  object_path text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, bucket_id, object_path),
  constraint client_account_deletion_manifest_bucket_check check (
    bucket_id in ('avatars', 'meal-completion-photos', 'chat-images')
  ),
  constraint client_account_deletion_manifest_path_length_check check (
    char_length(object_path) between 1 and 1024
  )
);

comment on table public.client_account_deletion_tombstones is
  'Service-only Auth-owned deletion state. The row remains retryable until Auth deletes the user.';

comment on table public.client_account_deletion_storage_manifest is
  'Service-only exact Storage objects collected before relational deletion. Rows cascade with Auth.';

alter table public.client_account_deletion_tombstones enable row level security;
alter table public.client_account_deletion_storage_manifest enable row level security;
revoke all privileges on table public.client_account_deletion_tombstones
  from public, anon, authenticated, service_role;
revoke all privileges on table public.client_account_deletion_storage_manifest
  from public, anon, authenticated, service_role;
grant select on table public.client_account_deletion_tombstones
  to service_role;
grant select on table public.client_account_deletion_storage_manifest
  to service_role;

create or replace function public.delete_client_account_data(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.user_role;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role'
     or p_client_id is null then
    raise exception 'Client account deletion authorization failed.' using errcode = '42501';
  end if;

  -- A tombstone is the only retry authorization. A missing profile is valid
  -- here because relational cleanup intentionally removes it before Auth.
  perform 1
    from public.client_account_deletion_tombstones as t
   where t.user_id = p_client_id
   for update;

  if not found then
    raise exception 'Client account deletion tombstone is missing.' using errcode = '42501';
  end if;

  select p.role
    into v_role
    from public.profiles as p
   where p.id = p_client_id
   for update;

  if found and v_role is distinct from 'client'::public.user_role then
    raise exception 'Client account deletion target is not an eligible client.' using errcode = '42501';
  end if;

  -- Notifications are projections. Delete rows carrying the client's
  -- identity or a client-associated source before source rows disappear.
  delete from public.notifications as n
   where n.recipient_id = p_client_id
      or n.actor_id = p_client_id
      or exists (
        select 1
          from public.chat_conversations as c
         where (c.client_id = p_client_id or c.dietitian_id = p_client_id)
           and n.conversation_id = c.id
      )
      or exists (
        select 1
          from public.appointments as a
         where (a.client_id = p_client_id or a.dietitian_id = p_client_id)
           and n.appointment_id = a.id
      )
      or exists (
        select 1
          from public.dietitian_clients as dc
         where (dc.client_id = p_client_id or dc.dietitian_id = p_client_id)
           and n.dietitian_client_id = dc.id
      );

  -- Cleanup queue rows hold RESTRICT references to chat intents/attachments.
  -- The exact Storage objects have already been removed by the caller, but
  -- every target conversation's intent is still removed relationally.
  delete from public.chat_image_cleanup_queue as q
   where q.intent_id in (
           select i.id
             from public.chat_upload_intents as i
            where i.created_by = p_client_id
               or i.conversation_id in (
                 select c.id
                   from public.chat_conversations as c
                  where c.client_id = p_client_id
                     or c.dietitian_id = p_client_id
               )
         )
      or q.attachment_id in (
           select a.id
             from public.chat_attachments as a
            where a.message_id in (
              select m.id
                from public.chat_messages as m
               where m.conversation_id in (
                 select c.id
                   from public.chat_conversations as c
                  where c.client_id = p_client_id
                     or c.dietitian_id = p_client_id
               )
            )
         );

  delete from public.chat_read_states as rs
   where rs.user_id = p_client_id
      or rs.conversation_id in (
        select c.id
          from public.chat_conversations as c
         where c.client_id = p_client_id
            or c.dietitian_id = p_client_id
      );

  update public.chat_conversations as c
     set last_message_id = null,
         last_message_at = null
   where c.client_id = p_client_id
      or c.dietitian_id = p_client_id;

  delete from public.chat_attachments as a
   where a.intent_id in (
           select i.id
             from public.chat_upload_intents as i
            where i.created_by = p_client_id
               or i.conversation_id in (
                 select c.id
                   from public.chat_conversations as c
                  where c.client_id = p_client_id
                     or c.dietitian_id = p_client_id
               )
         )
      or a.message_id in (
           select m.id
             from public.chat_messages as m
            where m.conversation_id in (
              select c.id
                from public.chat_conversations as c
               where c.client_id = p_client_id
                  or c.dietitian_id = p_client_id
            )
         );

  delete from public.chat_upload_intents as i
   where i.created_by = p_client_id
      or i.conversation_id in (
        select c.id
          from public.chat_conversations as c
         where c.client_id = p_client_id
            or c.dietitian_id = p_client_id
      );

  delete from public.chat_messages as m
   where m.conversation_id in (
           select c.id
             from public.chat_conversations as c
            where c.client_id = p_client_id
               or c.dietitian_id = p_client_id
         )
      or m.sender_id = p_client_id
      or m.receiver_id = p_client_id
      or m.deleted_by = p_client_id;

  delete from public.chat_conversations as c
   where c.client_id = p_client_id
      or c.dietitian_id = p_client_id;

  delete from public.dietitian_clients as dc
   where dc.client_id = p_client_id
      or dc.dietitian_id = p_client_id;

  delete from public.appointments as a
   where a.client_id = p_client_id
      or a.dietitian_id = p_client_id;

  delete from public.meal_change_requests as r
   where r.client_id = p_client_id
      or r.dietitian_id = p_client_id;

  delete from public.daily_tasks as t
   where t.client_id = p_client_id
      or t.dietitian_id = p_client_id;

  delete from public.dietitian_notes as n
   where n.client_id = p_client_id
      or n.dietitian_id = p_client_id;

  delete from public.meal_completion_photo_cleanup_queue as q
   where q.client_id = p_client_id;

  delete from public.meals as m
   where m.plan_id in (
     select mp.id
       from public.meal_plans as mp
      where mp.client_id = p_client_id
         or mp.dietitian_id = p_client_id
   );

  delete from public.meal_plans as mp
   where mp.client_id = p_client_id
      or mp.dietitian_id = p_client_id;

  delete from public.meal_completion_photo_cleanup_queue as q
   where q.client_id = p_client_id;

  delete from public.grocery_items as g
   where g.client_id = p_client_id;

  delete from public.daily_logs as dl
   where dl.client_id = p_client_id;

  delete from public.measurements as m
   where m.client_id = p_client_id;

  delete from public.body_measurements as bm
   where bm.client_id = p_client_id;

  delete from public.client_medical_conditions as cmc
   where cmc.client_id = p_client_id;

  delete from public.client_medications as cm
   where cm.client_id = p_client_id;

  delete from public.client_profiles as cp
   where cp.user_id = p_client_id;

  -- This is intentionally before COMMIT. Auth deletion is the caller's final
  -- side effect; an Auth failure therefore cannot leave a usable profile.
  delete from public.profiles as p
   where p.id = p_client_id;

  update public.client_account_deletion_tombstones
     set relational_cleanup_at = coalesce(relational_cleanup_at, now())
   where user_id = p_client_id;
end
$function$;

create function public.prepare_client_account_deletion(
  p_client_id uuid,
  p_storage_objects jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.user_role;
  v_object jsonb;
  v_bucket_id text;
  v_object_path text;
  v_is_retry boolean;
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role'
     or p_client_id is null
     or jsonb_typeof(p_storage_objects) is distinct from 'array' then
    raise exception 'Client account deletion authorization failed.' using errcode = '42501';
  end if;

  select exists (
    select 1
      from public.client_account_deletion_tombstones as t
     where t.user_id = p_client_id
     for update
  )
    into v_is_retry;

  if v_is_retry then
    if p_storage_objects <> '[]'::jsonb then
      raise exception 'Client account deletion retry must use the persisted Storage manifest.';
    end if;
  else
    select p.role
      into v_role
      from public.profiles as p
     where p.id = p_client_id
     for update;

    if v_role is distinct from 'client'::public.user_role
       or exists (
         select 1
           from public.platform_admins as pa
          where pa.user_id = p_client_id
            and pa.revoked_at is null
       ) then
      raise exception 'Client account deletion target is not an eligible client.' using errcode = '42501';
    end if;

    insert into public.client_account_deletion_tombstones (user_id)
    values (p_client_id)
    on conflict (user_id) do nothing;
  end if;

  for v_object in
    select value
      from jsonb_array_elements(p_storage_objects) as item(value)
  loop
    if jsonb_typeof(v_object) is distinct from 'object'
       or (select count(*) from jsonb_object_keys(v_object)) <> 2
       or jsonb_typeof(v_object -> 'bucket_id') is distinct from 'string'
       or jsonb_typeof(v_object -> 'object_path') is distinct from 'string' then
      raise exception 'Client account deletion Storage manifest row is malformed.';
    end if;

    v_bucket_id := v_object ->> 'bucket_id';
    v_object_path := v_object ->> 'object_path';

    if char_length(v_object_path) not between 1 and 1024 then
      raise exception 'Client account deletion Storage manifest path is invalid.';
    end if;

    if v_bucket_id = 'avatars' then
      if v_object_path !~* (
        '^' || p_client_id::text || '/[A-Za-z0-9][A-Za-z0-9._-]*\.(jpe?g|png|webp)$'
      ) then
        raise exception 'Client account deletion avatar path contract failed.';
      end if;
    elsif v_bucket_id = 'meal-completion-photos' then
      if v_object_path !~* (
        '^' || p_client_id::text || '/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
      ) then
        raise exception 'Client account deletion completion path contract failed.';
      end if;
    elsif v_bucket_id = 'chat-images' then
      if v_object_path !~* (
        '^pending/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.jpg$'
      ) then
        raise exception 'Client account deletion chat path contract failed.';
      end if;

      -- On the first attempt, the path must belong to an intent in one of
      -- the client's conversations (or to a client-created orphan intent).
      -- Retries pass an empty array and use only the persisted manifest.
      if not v_is_retry and not exists (
        select 1
          from public.chat_upload_intents as i
         where i.bucket_id = v_bucket_id
           and i.object_path = v_object_path
           and (
             i.created_by = p_client_id
             or i.conversation_id in (
               select c.id
                 from public.chat_conversations as c
                where c.client_id = p_client_id
                   or c.dietitian_id = p_client_id
             )
           )
      ) then
        raise exception 'Client account deletion chat manifest ownership failed.';
      end if;
    else
      raise exception 'Client account deletion Storage bucket is invalid.';
    end if;

    insert into public.client_account_deletion_storage_manifest (
      user_id,
      bucket_id,
      object_path
    ) values (
      p_client_id,
      v_bucket_id,
      v_object_path
    ) on conflict (user_id, bucket_id, object_path) do nothing;
  end loop;

  -- This call stays in the same transaction as tombstone and manifest writes.
  perform public.delete_client_account_data(p_client_id);
end
$function$;

create function public.get_client_account_deletion_state(p_client_id uuid)
returns table (
  user_id uuid,
  started_at timestamptz,
  relational_cleanup_at timestamptz,
  storage_cleanup_at timestamptz,
  storage_objects jsonb
)
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role'
     or p_client_id is null then
    raise exception 'Client account deletion authorization failed.' using errcode = '42501';
  end if;

  return query
  select t.user_id,
         t.started_at,
         t.relational_cleanup_at,
         t.storage_cleanup_at,
         coalesce(
           jsonb_agg(
             jsonb_build_object(
               'bucket_id', m.bucket_id,
               'object_path', m.object_path
             ) order by m.bucket_id, m.object_path
           ) filter (where m.user_id is not null),
           '[]'::jsonb
         )
    from public.client_account_deletion_tombstones as t
    left join public.client_account_deletion_storage_manifest as m
      on m.user_id = t.user_id
   where t.user_id = p_client_id
   group by t.user_id, t.started_at, t.relational_cleanup_at, t.storage_cleanup_at;
end
$function$;

create function public.mark_client_account_storage_cleaned(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role'
     or p_client_id is null then
    raise exception 'Client account deletion authorization failed.' using errcode = '42501';
  end if;

  update public.client_account_deletion_tombstones
     set storage_cleanup_at = coalesce(storage_cleanup_at, now())
   where user_id = p_client_id
     and relational_cleanup_at is not null;

  if not found then
    raise exception 'Client account deletion state is not ready for Storage completion.';
  end if;
end
$function$;

alter function public.delete_client_account_data(uuid) owner to postgres;
alter function public.prepare_client_account_deletion(uuid, jsonb) owner to postgres;
alter function public.get_client_account_deletion_state(uuid) owner to postgres;
alter function public.mark_client_account_storage_cleaned(uuid) owner to postgres;

revoke all on function public.delete_client_account_data(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_client_account_data(uuid) to service_role;
revoke all on function public.prepare_client_account_deletion(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_client_account_deletion(uuid, jsonb) to service_role;
revoke all on function public.get_client_account_deletion_state(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_client_account_deletion_state(uuid) to service_role;
revoke all on function public.mark_client_account_storage_cleaned(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.mark_client_account_storage_cleaned(uuid) to service_role;

comment on function public.delete_client_account_data(uuid) is
  'Service-only transactional relational cleanup. Tombstone and manifest must exist; public.profiles is removed before commit.';

comment on function public.prepare_client_account_deletion(uuid, jsonb) is
  'Service-only first-attempt/retry transaction that persists exact Storage paths and removes relational data including public.profiles.';

comment on function public.get_client_account_deletion_state(uuid) is
  'Service-only retry-state lookup returning the persisted exact Storage manifest.';

comment on function public.mark_client_account_storage_cleaned(uuid) is
  'Service-only marker after exact persisted Storage deletion and before final Auth deletion.';

do $postflight$
declare
  v_table text;
  v_function text;
begin
  foreach v_table in array ARRAY[
    'public.client_account_deletion_tombstones',
    'public.client_account_deletion_storage_manifest'
  ] loop
    if not (
      has_table_privilege('anon', v_table, 'SELECT') = false
      and has_table_privilege('authenticated', v_table, 'SELECT') = false
      and has_table_privilege('anon', v_table, 'INSERT') = false
      and has_table_privilege('authenticated', v_table, 'INSERT') = false
      and has_table_privilege('anon', v_table, 'UPDATE') = false
      and has_table_privilege('authenticated', v_table, 'UPDATE') = false
      and has_table_privilege('anon', v_table, 'DELETE') = false
      and has_table_privilege('authenticated', v_table, 'DELETE') = false
    ) then
      raise exception 'Client account deletion state table browser privilege postcondition failed: %', v_table;
    end if;

    if not exists (
      select 1
        from pg_catalog.pg_class as c
       where c.oid = v_table::regclass
         and c.relrowsecurity
    ) then
      raise exception 'Client account deletion state table RLS postcondition failed: %', v_table;
    end if;
  end loop;

  if exists (
    select 1
      from pg_catalog.pg_constraint as c
     where c.conrelid in (
       'public.client_account_deletion_tombstones'::regclass,
       'public.client_account_deletion_storage_manifest'::regclass
     )
       and c.contype = 'f'
       and c.confrelid = 'public.profiles'::regclass
  ) then
    raise exception 'Client account deletion state must not reference public.profiles.';
  end if;

  if (
    select count(*)
      from pg_catalog.pg_constraint as c
     where c.conrelid in (
       'public.client_account_deletion_tombstones'::regclass,
       'public.client_account_deletion_storage_manifest'::regclass
     )
       and c.contype = 'f'
       and c.confrelid = 'auth.users'::regclass
       and c.confdeltype = 'c'
  ) <> 2 then
    raise exception 'Client account deletion state Auth cascade postcondition failed.';
  end if;

  foreach v_function in array ARRAY[
    'public.delete_client_account_data(uuid)',
    'public.prepare_client_account_deletion(uuid,jsonb)',
    'public.get_client_account_deletion_state(uuid)',
    'public.mark_client_account_storage_cleaned(uuid)'
  ] loop
    if not has_function_privilege('service_role', v_function, 'EXECUTE')
       or has_function_privilege('anon', v_function, 'EXECUTE')
       or has_function_privilege('authenticated', v_function, 'EXECUTE')
       or not exists (
         select 1
           from pg_catalog.pg_proc as p
          where p.oid = v_function::regprocedure
            and p.prosecdef
            and p.proconfig @> ARRAY['search_path=""']::text[]
       ) then
      raise exception 'Client account deletion function security postcondition failed: %', v_function;
    end if;
  end loop;
end
$postflight$;

commit;
