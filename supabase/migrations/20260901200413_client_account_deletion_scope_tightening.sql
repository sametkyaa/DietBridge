-- Client account deletion scope tightening.
--
-- This is a forward-only correction to the account-deletion hardening
-- functions. A client deletion is scoped only by client-side ownership;
-- malformed values in a dietitian-side column must never widen the target.

begin;

do $preflight$
begin
  if to_regprocedure('public.delete_client_account_data(uuid)') is null
     or to_regprocedure('public.prepare_client_account_deletion(uuid,jsonb)') is null
     or to_regclass('public.client_account_deletion_tombstones') is null
     or to_regclass('public.client_account_deletion_storage_manifest') is null then
    raise exception 'Client account deletion scope-tightening prerequisites are missing.';
  end if;
end
$preflight$;

create or replace function public.delete_client_account_data(p_client_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_role public.user_role;
  v_conversation_ids uuid[];
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

  -- Freeze the canonical chat scope before deleting any source rows. Every
  -- chat cleanup below uses only conversations owned by this client.
  select coalesce(array_agg(c.id order by c.id), '{}'::uuid[])
    into v_conversation_ids
    from public.chat_conversations as c
   where c.client_id = p_client_id;

  -- Notifications are projections. Delete rows carrying the client's
  -- identity or a client-associated source before source rows disappear.
  delete from public.notifications as n
   where n.recipient_id = p_client_id
      or n.actor_id = p_client_id
      or n.conversation_id = any(v_conversation_ids)
      or exists (
        select 1
          from public.appointments as a
         where a.client_id = p_client_id
           and n.appointment_id = a.id
      )
      or exists (
        select 1
          from public.dietitian_clients as dc
         where dc.client_id = p_client_id
           and n.dietitian_client_id = dc.id
      );

  -- This transaction removes relational references before it commits. The
  -- caller deletes the persisted exact Storage manifest only after commit,
  -- then performs Auth deletion as the final side effect.
  delete from public.chat_image_cleanup_queue as q
   where q.intent_id in (
           select i.id
             from public.chat_upload_intents as i
            where i.created_by = p_client_id
               or i.conversation_id = any(v_conversation_ids)
         )
      or q.attachment_id in (
           select a.id
             from public.chat_attachments as a
            where a.message_id in (
              select m.id
                from public.chat_messages as m
               where m.conversation_id = any(v_conversation_ids)
            )
         );

  delete from public.chat_read_states as rs
   where rs.conversation_id = any(v_conversation_ids);

  update public.chat_conversations as c
     set last_message_id = null,
         last_message_at = null
   where c.id = any(v_conversation_ids);

  delete from public.chat_attachments as a
   where a.intent_id in (
           select i.id
             from public.chat_upload_intents as i
            where i.created_by = p_client_id
               or i.conversation_id = any(v_conversation_ids)
         )
      or a.message_id in (
           select m.id
             from public.chat_messages as m
            where m.conversation_id = any(v_conversation_ids)
         );

  delete from public.chat_upload_intents as i
   where i.created_by = p_client_id
      or i.conversation_id = any(v_conversation_ids);

  delete from public.chat_messages as m
   where m.conversation_id = any(v_conversation_ids);

  delete from public.chat_conversations as c
   where c.id = any(v_conversation_ids);

  delete from public.dietitian_clients as dc
   where dc.client_id = p_client_id;

  delete from public.appointments as a
   where a.client_id = p_client_id;

  delete from public.meal_change_requests as r
   where r.client_id = p_client_id;

  delete from public.daily_tasks as t
   where t.client_id = p_client_id;

  delete from public.dietitian_notes as n
   where n.client_id = p_client_id;

  delete from public.meal_completion_photo_cleanup_queue as q
   where q.client_id = p_client_id;

  delete from public.meals as m
   where m.plan_id in (
     select mp.id
       from public.meal_plans as mp
      where mp.client_id = p_client_id
   );

  delete from public.meal_plans as mp
   where mp.client_id = p_client_id;

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

create or replace function public.prepare_client_account_deletion(
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

  -- Tombstone, manifest, relational cleanup, and profile deletion remain one
  -- transaction. Storage and Auth are deliberately outside this transaction.
  perform public.delete_client_account_data(p_client_id);
end
$function$;

comment on function public.delete_client_account_data(uuid) is
  'Service-only client-scoped relational transaction. The caller deletes the persisted exact Storage manifest after commit, then performs Auth deletion last.';

comment on function public.prepare_client_account_deletion(uuid, jsonb) is
  'Service-only client-scoped first-attempt/retry transaction that validates exact Storage paths and removes relational data including public.profiles.';

alter function public.delete_client_account_data(uuid) owner to postgres;
alter function public.prepare_client_account_deletion(uuid, jsonb) owner to postgres;

revoke all on function public.delete_client_account_data(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_client_account_data(uuid) to service_role;

revoke all on function public.prepare_client_account_deletion(uuid, jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.prepare_client_account_deletion(uuid, jsonb) to service_role;

do $postflight$
declare
  v_delete_definition text;
  v_prepare_definition text;
begin
  select pg_get_functiondef('public.delete_client_account_data(uuid)'::regprocedure)
    into v_delete_definition;
  select pg_get_functiondef('public.prepare_client_account_deletion(uuid,jsonb)'::regprocedure)
    into v_prepare_definition;

  if v_delete_definition ~* 'dietitian_id[[:space:]]*=[[:space:]]*p_client_id'
     or v_prepare_definition ~* 'dietitian_id[[:space:]]*=[[:space:]]*p_client_id' then
    raise exception 'Client account deletion scope still contains a dietitian-side target predicate.';
  end if;

  if has_function_privilege('anon', 'public.delete_client_account_data(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.delete_client_account_data(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.prepare_client_account_deletion(uuid,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.prepare_client_account_deletion(uuid,jsonb)', 'EXECUTE') then
    raise exception 'Client account deletion functions are browser-callable.';
  end if;

  if not has_function_privilege('service_role', 'public.delete_client_account_data(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.prepare_client_account_deletion(uuid,jsonb)', 'EXECUTE') then
    raise exception 'Service-only client account deletion grants are missing.';
  end if;
end
$postflight$;

commit;
