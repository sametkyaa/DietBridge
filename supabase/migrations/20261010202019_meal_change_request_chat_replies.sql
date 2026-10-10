-- New review notes are sent through the existing text-chat RPC in the same
-- transaction as the decision. No table, RLS, mobile message shape or history
-- is changed. Reapplying this CREATE OR REPLACE migration is safe; historical
-- reviews are never backfilled. Rollback: restore the preceding review RPC.
begin;

do $preflight$
begin
  if to_regprocedure('public.review_meal_change_request(uuid,text,text)') is null
     or to_regprocedure('public.send_chat_message(uuid,uuid,text)') is null
     or to_regclass('public.chat_conversations') is null
     or to_regclass('public.chat_messages') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'meal_change_requests'
         and column_name = 'response_note' and data_type = 'text'
     ) then
    raise exception 'Meal request chat reply prerequisites are missing.';
  end if;
  if has_table_privilege('authenticated', 'public.meal_change_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.meal_change_requests', 'DELETE') then
    raise exception 'Meal request direct writes must remain disabled.';
  end if;
end
$preflight$;

create or replace function public.review_meal_change_request(
  p_request_id uuid,
  p_decision text,
  p_response_note text default null
)
returns public.meal_change_requests
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_actor_id uuid := auth.uid();
  v_request public.meal_change_requests%rowtype;
  v_note text := nullif(btrim(coalesce(p_response_note, '')), '');
  v_result public.meal_change_requests%rowtype;
  v_relation_id uuid;
  v_slots text;
  v_body text;
begin
  if v_actor_id is null or p_request_id is null then
    raise exception 'Meal change request access denied.' using errcode = '42501';
  end if;
  if p_decision is null or p_decision not in ('approved', 'rejected') then
    raise exception 'Decision must be approved or rejected.' using errcode = '22023';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then
    raise exception 'Response note exceeds the supported length.' using errcode = '22023';
  end if;
  if not (select public.is_current_user_dietitian()) then
    raise exception 'Meal change request access denied.' using errcode = '42501';
  end if;

  select r.* into v_request
    from public.meal_change_requests as r
   where r.id = p_request_id
   for update;
  if not found or v_request.dietitian_id is distinct from v_actor_id then
    raise exception 'Meal change request access denied.' using errcode = '42501';
  end if;

  -- Hold the active relationship stable until both writes have committed.
  select dc.id into v_relation_id
    from public.dietitian_clients as dc
   where dc.dietitian_id = v_actor_id
     and dc.client_id = v_request.client_id
     and dc.status = 'active'::public.client_status
   order by dc.id
   limit 1
   for share;
  if not found then
    raise exception 'An active dietitian-client relationship is required.' using errcode = '42501';
  end if;

  if v_request.status is distinct from 'pending' then
    -- A lost HTTP response may be retried with the identical decision and
    -- trimmed note. Never resend, resurrect a deleted message, or turn a
    -- historical review without a chat message into a backfill.
    if v_request.status = p_decision
       and v_request.reviewed_by = v_actor_id
       and v_request.response_note is not distinct from v_note
       and (v_note is null or exists (
         select 1 from public.chat_messages m
         join public.chat_conversations c on c.id = m.conversation_id
         where m.sender_id = v_actor_id and m.client_message_id = v_request.id
           and c.dietitian_client_id = v_relation_id
           and m.message_kind = 'text'
       )) then
      return v_request;
    end if;
    raise exception 'Meal change request is no longer pending.' using errcode = 'P0001';
  end if;

  update public.meal_change_requests as r
     set status = p_decision,
         reviewed_at = now(),
         reviewed_by = v_actor_id,
         response_note = v_note
   where r.id = v_request.id and r.status = 'pending'
  returning r.* into v_result;
  if not found then
    raise exception 'Meal change request decision could not be applied.' using errcode = 'P0001';
  end if;

  if v_note is not null then
    -- Mobile sends selected meal types in requested_meals.alternatives.
    -- Only known types are used, keeping the header bounded even for malformed
    -- or oversized legacy payloads. Preserve selection order and deduplicate.
    select string_agg(s.label, ', ' order by s.first_position) into v_slots
    from (
      select case e.value #>> '{}' when 'breakfast' then 'Kahvaltı'
        when 'lunch' then 'Öğle' when 'dinner' then 'Akşam'
        when 'snack' then 'Ara öğün' when 'all' then 'Tüm öğünler' end as label,
        min(e.position) as first_position
      from jsonb_array_elements(case
        when jsonb_typeof(v_request.requested_meals -> 'alternatives') = 'array'
        then v_request.requested_meals -> 'alternatives' else '[]'::jsonb end)
        with ordinality as e(value, position)
      where e.value #>> '{}' in ('breakfast', 'lunch', 'dinner', 'snack', 'all')
      group by e.value
    ) s;
    v_slots := coalesce(v_slots, case v_request.meal_slot
      when 'breakfast' then 'Kahvaltı' when 'lunch' then 'Öğle'
      when 'dinner' then 'Akşam' when 'snack' then 'Ara öğün'
      when 'all' then 'Tüm öğünler' else 'Öğün' end);
    v_body := format(E'Öğün değişikliği talebine yanıt\n%s · %s\nKarar: %s\n\n%s',
      to_char(v_request.plan_date, 'DD.MM.YYYY'), v_slots,
      case p_decision when 'approved' then 'Onaylandı' else 'Reddedildi' end,
      v_note);

    -- Reuse canonical ownership checks, conversation creation, last-message
    -- tracking, notification aggregation and push eligibility. Any failure
    -- propagates and rolls back the review as well. Request UUID is the stable
    -- chat idempotency key; no direct chat INSERT or separate client send.
    perform public.send_chat_message(v_relation_id, v_request.id, v_body);
  end if;
  return v_result;
end
$function$;

alter function public.review_meal_change_request(uuid, text, text) owner to postgres;
revoke all on function public.review_meal_change_request(uuid, text, text) from public, anon, service_role;
grant execute on function public.review_meal_change_request(uuid, text, text) to authenticated;

do $postflight$
begin
  if has_function_privilege('anon', 'public.review_meal_change_request(uuid,text,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.review_meal_change_request(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.review_meal_change_request(uuid,text,text)', 'EXECUTE')
     or not (select relrowsecurity from pg_class where oid = 'public.meal_change_requests'::regclass)
     or position('perform public.send_chat_message' in pg_get_functiondef('public.review_meal_change_request(uuid,text,text)'::regprocedure)) = 0 then
    raise exception 'Meal request chat reply postflight failed.';
  end if;
end
$postflight$;
commit;
