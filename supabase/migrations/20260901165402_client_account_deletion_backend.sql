-- Client account deletion backend.
--
-- The function removes client-owned and client-associated relational data but
-- deliberately keeps public.profiles until the final Auth admin deletion. The
-- profiles -> auth.users ON DELETE CASCADE constraint then removes the last
-- profile row. Keeping that row until the final step makes an Auth failure
-- retryable without retaining a second deletion-state table.

begin;

do $preflight$
begin
  if to_regclass('public.profiles') is null
     or to_regclass('public.client_profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regclass('public.appointments') is null
     or to_regclass('public.daily_logs') is null
     or to_regclass('public.body_measurements') is null
     or to_regclass('public.measurements') is null
     or to_regclass('public.client_medical_conditions') is null
     or to_regclass('public.client_medications') is null
     or to_regclass('public.meal_change_requests') is null
     or to_regclass('public.meal_plans') is null
     or to_regclass('public.meals') is null
     or to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_messages') is null
     or to_regclass('public.chat_read_states') is null
     or to_regclass('public.chat_upload_intents') is null
     or to_regclass('public.chat_attachments') is null
     or to_regclass('public.chat_image_cleanup_queue') is null
     or to_regclass('public.meal_completion_photo_cleanup_queue') is null
     or to_regclass('public.meal_photo_cleanup_queue') is null
     or to_regclass('public.daily_tasks') is null
     or to_regclass('public.dietitian_notes') is null
     or to_regclass('public.notifications') is null
     or to_regclass('public.grocery_items') is null
     or to_regclass('public.platform_admins') is null then
    raise exception 'Client account deletion prerequisites are missing.';
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_constraint
     where conrelid = 'public.profiles'::regclass
       and confrelid = 'auth.users'::regclass
       and contype = 'f'
       and confdeltype = 'c'
  ) then
    raise exception 'The profiles to Auth cascade is missing; refusing account deletion migration.';
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
begin
  if (select auth.jwt() ->> 'role') is distinct from 'service_role'
     or p_client_id is null then
    raise exception 'Client account deletion authorization failed.' using errcode = '42501';
  end if;

  -- Lock the profile and fail closed for missing, dietitian, or otherwise
  -- non-client targets. platform_admins is checked independently because the
  -- current role enum has only dietitian/client values.
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

  -- Notifications are projections. Delete rows carrying the client's
  -- identity or a client-owned source before source rows disappear.
  delete from public.notifications as n
   where n.recipient_id = p_client_id
      or n.actor_id = p_client_id
      or exists (
        select 1
          from public.chat_conversations as c
         where c.client_id = p_client_id
           and n.conversation_id = c.id
      )
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

  -- Cleanup queue rows hold RESTRICT references to chat intents/attachments.
  -- Client-owned chat objects have already been removed by the Edge Function;
  -- dietitian-owned chat objects are intentionally not broad-purged here.
  delete from public.chat_image_cleanup_queue as q
   where q.intent_id in (
           select i.id
             from public.chat_upload_intents as i
            where i.created_by = p_client_id
               or i.conversation_id in (
                 select c.id
                   from public.chat_conversations as c
                  where c.client_id = p_client_id
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
               )
            )
         );

  -- Read/delivery state and the conversation's last-message pointer both
  -- restrict message deletion, so remove/clear them first.
  delete from public.chat_read_states as rs
   where rs.user_id = p_client_id
      or rs.conversation_id in (
        select c.id
          from public.chat_conversations as c
         where c.client_id = p_client_id
      );

  update public.chat_conversations as c
     set last_message_id = null,
         last_message_at = null
   where c.client_id = p_client_id;

  delete from public.chat_attachments as a
   where a.intent_id in (
           select i.id
             from public.chat_upload_intents as i
            where i.created_by = p_client_id
               or i.conversation_id in (
                 select c.id
                   from public.chat_conversations as c
                  where c.client_id = p_client_id
               )
         )
      or a.message_id in (
           select m.id
             from public.chat_messages as m
            where m.conversation_id in (
              select c.id
                from public.chat_conversations as c
               where c.client_id = p_client_id
            )
         );

  delete from public.chat_upload_intents as i
   where i.created_by = p_client_id
      or i.conversation_id in (
        select c.id
          from public.chat_conversations as c
         where c.client_id = p_client_id
      );

  delete from public.chat_messages as m
   where m.conversation_id in (
           select c.id
             from public.chat_conversations as c
            where c.client_id = p_client_id
         )
      or m.sender_id = p_client_id
      or m.receiver_id = p_client_id
      or m.deleted_by = p_client_id;

  delete from public.chat_conversations as c
   where c.client_id = p_client_id;

  -- Relationship identity is client-associated and cannot be retained after
  -- the profile is removed.
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

  -- These queue rows have no FK by design. Remove stale/current completion
  -- queue state before meals are deleted; the meal delete trigger may enqueue
  -- one final row, which is removed again immediately below.
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

  -- Do not delete public.profiles here. The Edge Function's final
  -- auth.admin.deleteUser(p_client_id, false) removes Auth and this row via
  -- the reviewed ON DELETE CASCADE. A failed Auth call can therefore retry.
end
$function$;

alter function public.delete_client_account_data(uuid) owner to postgres;
revoke all on function public.delete_client_account_data(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.delete_client_account_data(uuid) to service_role;

comment on function public.delete_client_account_data(uuid) is
  'Service-only transactional cleanup for an authenticated client account. Auth deletion is the final caller-side step.';

do $postflight$
begin
  if to_regprocedure('public.delete_client_account_data(uuid)') is null
     or has_function_privilege('anon', 'public.delete_client_account_data(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.delete_client_account_data(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.delete_client_account_data(uuid)', 'EXECUTE')
     or not exists (
       select 1
        from pg_catalog.pg_proc as p
         join pg_catalog.pg_namespace as n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.proname = 'delete_client_account_data'
          and p.pronargs = 1
          and p.proargtypes[0] = 'uuid'::regtype
          and p.prosecdef
          and p.proconfig @> array['search_path=""']::text[]
     ) then
    raise exception 'Client account deletion function security postcondition failed.';
  end if;
end
$postflight$;

commit;
