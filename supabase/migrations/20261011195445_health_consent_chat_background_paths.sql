-- Dormant authenticated chat + background consent extension. No activation.
begin;
create function private.health_consent_has(p_client uuid,p_sharing boolean)
returns boolean language sql security definer set search_path='' as $$
 select exists(select 1 from private.health_consent_settings c where c.singleton and
  (not c.enabled or exists(select 1 from private.health_consent_state s
   where s.user_id=p_client and s.document_version=c.document_version
    and s.storage_granted and (not p_sharing or s.sharing_granted))));
$$;
revoke all on function private.health_consent_has(uuid,boolean) from public,anon,authenticated,service_role;

grant usage on schema private to service_role;
grant execute on function private.health_consent_has(uuid,boolean) to service_role;

-- Background content writes need current sharing consent as well. Genuine
-- cleanup DELETE remains untouched; a service credential is not consent.
create or replace function private.guard_core_health_write()
returns trigger language plpgsql security invoker set search_path='' as $$
declare v_client uuid; v_actor uuid:=auth.uid(); v_json jsonb:=to_jsonb(new);
begin
 if not private.health_consent_enabled() then return new; end if;
 if tg_table_name='client_profiles' then
  v_json:=v_json-array['user_id','created_at','updated_at'];
  if tg_op='INSERT' and not exists(select 1 from jsonb_each(v_json) where value<>'null'::jsonb) then return new; end if;
  if tg_op='UPDATE' and new.user_id is distinct from old.user_id then raise exception 'Health record owner cannot change' using errcode='42501'; end if;
  if tg_op='UPDATE' and v_json=(to_jsonb(old)-array['user_id','created_at','updated_at']) then return new; end if;
  v_client:=new.user_id;
 else
  v_client:=new.client_id;
  if tg_op='UPDATE' and new.client_id is distinct from old.client_id then raise exception 'Health record owner cannot change' using errcode='42501'; end if;
 end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client::text,8311));
 if v_actor is null then
  if (current_setting('role',true) in ('postgres','supabase_admin','service_role') or
     (current_setting('role',true)='none' and session_user in ('postgres','supabase_admin')))
    and private.health_consent_has(v_client,true) then return new; end if;
  raise exception 'Health data sharing consent required' using errcode='42501';
 end if;
 if not private.health_consent_allows(v_client,v_actor<>v_client) then raise exception 'Health data consent required' using errcode='42501'; end if;
 return new;
end $$;

create or replace function private.guard_meal_health_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_client uuid; v_old_client uuid; v_actor uuid:=auth.uid();
begin
 if not private.health_consent_enabled() then return new; end if;
 if tg_table_name='meals' then
  select p.client_id into v_client from public.meal_plans p where p.id=new.plan_id;
  if tg_op='UPDATE' then select p.client_id into v_old_client from public.meal_plans p where p.id=old.plan_id; end if;
 else
  v_client:=new.client_id;
  if tg_op='UPDATE' then v_old_client:=old.client_id; end if;
 end if;
 if v_client is null or (tg_op='UPDATE' and v_old_client is distinct from v_client) then raise exception 'Health record owner cannot change' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client::text,8311));
 if v_actor is null then
  if (current_setting('role',true) in ('postgres','supabase_admin','service_role') or
    (current_setting('role',true)='none' and session_user in ('postgres','supabase_admin')))
    and private.health_consent_has(v_client,true) then return new; end if;
  raise exception 'Health data sharing consent required' using errcode='42501';
 end if;
 if not private.health_consent_allows(v_client,v_actor<>v_client) then raise exception 'Health data consent required' using errcode='42501'; end if;
 return new;
end $$;

-- Resolvers disclose no record payload; only trusted functions use them.
create function private.health_record_client(p_kind text,p_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_client uuid;
begin
 case p_kind
 when 'meal_request' then select client_id into v_client from public.meal_change_requests where id=p_id;
 when 'relationship' then select client_id into v_client from public.dietitian_clients where id=p_id;
 when 'conversation' then select client_id into v_client from public.chat_conversations where id=p_id;
 when 'message' then
  select coalesce(c.client_id,case when ps.role='client' then m.sender_id when pr.role='client' then m.receiver_id end)
   into v_client from public.chat_messages m left join public.chat_conversations c on c.id=m.conversation_id
   left join public.profiles ps on ps.id=m.sender_id left join public.profiles pr on pr.id=m.receiver_id where m.id=p_id;
 when 'intent' then select c.client_id into v_client from public.chat_upload_intents i join public.chat_conversations c on c.id=i.conversation_id where i.id=p_id;
 when 'notification' then
  select coalesce(c.client_id,d.client_id,a.client_id) into v_client from public.notifications n
   left join public.chat_conversations c on c.id=n.conversation_id
   left join public.dietitian_clients d on d.id=n.dietitian_client_id
   left join public.appointments a on a.id=n.appointment_id where n.id=p_id;
 else raise exception 'Unknown health record kind' using errcode='22023';
 end case;
 return v_client;
end $$;
revoke all on function private.health_record_client(text,uuid) from public,anon,authenticated,service_role;

create function private.health_record_read_allows(p_kind text,p_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_client uuid;
begin
 if not private.health_consent_enabled() then return true; end if;
 if auth.uid() is null then return false; end if;
 v_client:=private.health_record_client(p_kind,p_id);
 return v_client is not null and (v_client=auth.uid() or private.health_consent_has(v_client,true));
end $$;
revoke all on function private.health_record_read_allows(text,uuid) from public,anon,service_role;
grant execute on function private.health_record_read_allows(text,uuid) to authenticated;

create function private.require_health_record(p_kind text,p_id uuid,p_write boolean)
returns void language plpgsql security definer set search_path='' as $$
declare v_client uuid;
begin
 if not private.health_consent_enabled() then return; end if;
 if auth.uid() is null then raise exception 'Client session required' using errcode='42501'; end if;
 if p_kind='notification' and exists(select 1 from public.notifications n where n.id=p_id and private.notification_health_allows(n,true)) then return; end if;
 v_client:=private.health_record_client(p_kind,p_id);
 if v_client is null then raise exception 'Health record access denied' using errcode='42501'; end if;
 if not p_write and v_client=auth.uid() then return; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client::text,8311));
 if not private.health_consent_has(v_client,true) then raise exception 'Health data sharing consent required' using errcode='42501'; end if;
end $$;
revoke all on function private.require_health_record(text,uuid,boolean) from public,anon,authenticated,service_role;

-- Chat RPCs may replay previously stored rows before any trigger runs.
-- Inject the guard at the entry to the existing, precisely identified function.
-- Keep the original signature/defaults/owner/ACL/role/relationship logic intact.
do $rpc_guards$
declare sig text; kind text; parameter text; write_operation boolean; obj oid; src text; definition text; marker text:=E'\nbegin\n'; pos integer; acl aclitem[];
begin
 for sig,kind,parameter,write_operation in values
  ('public.review_meal_change_request(uuid,text,text)','meal_request','p_request_id',true),
  ('public.send_chat_message(uuid,uuid,text)','relationship','p_dietitian_client_id',true),
  ('public.create_chat_image_upload_intent(uuid,uuid,text)','conversation','p_conversation_id',true),
  ('public.finalize_chat_image_message(uuid,text)','intent','p_intent_id',true),
  ('public.delete_chat_message(uuid)','message','p_message_id',false),
  ('public.mark_chat_conversation_read(uuid,uuid)','conversation','p_conversation_id',false),
  ('public.mark_chat_conversation_delivered(uuid,uuid)','conversation','p_conversation_id',false),
  ('public.mark_notification_seen(uuid)','notification','p_notification_id',false),
  ('public.mark_notification_read(uuid)','notification','p_notification_id',false)
 loop
  obj:=to_regprocedure(sig);
  select p.prosrc,p.proacl into src,acl from pg_proc p join pg_language l on l.oid=p.prolang
    where p.oid=obj and p.prosecdef and l.lanname='plpgsql' and parameter=any(p.proargnames);
  if src is null or position('private.require_health_record' in src)>0 then raise exception 'RPC prerequisite/drift: %',sig; end if;
  pos:=position(marker in src);
  if pos=0 then raise exception 'RPC entry marker missing: %',sig; end if;
  definition:=pg_get_functiondef(obj);
  -- Replace the exact body, not SQL headers or parameter defaults.
  definition:=replace(definition,src,overlay(src placing marker||format(E'  perform private.require_health_record(%L,%s,%L);\n',kind,parameter,write_operation) from pos for length(marker)));
  execute definition;
  if (select proacl from pg_proc where oid=obj) is distinct from acl then raise exception 'RPC ACL changed: %',sig; end if;
 end loop;
end $rpc_guards$;

-- Pure read RPC: filter the existing query, retaining active/approved ownership.
do $$
declare obj oid:=to_regprocedure('public.get_dietitian_unread_counts()'); src text; replacement text;
begin
 select prosrc into src from pg_proc where oid=obj and prosecdef;
 if src is null or position('  where c.dietitian_id = v_actor_id' in src)=0 then raise exception 'Unread query prerequisite/drift'; end if;
 replacement:=replace(src,'  where c.dietitian_id = v_actor_id','  where c.dietitian_id = v_actor_id and private.health_consent_has(c.client_id,true)');
 execute replace(pg_get_functiondef(obj),src,replacement);
end $$;

create function private.guard_chat_health_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_client uuid; v_old_client uuid; v_json jsonb:=to_jsonb(new);
begin
 if not private.health_consent_enabled() then return new; end if;
 -- Soft deletion, upload cancellation and receipt-only changes do not create
 -- health content; original authorization/contract triggers still apply.
 if tg_op='UPDATE' then
  if tg_table_name='chat_messages' then
   if new.deleted_at is not null and new.body is null and (v_json-array['body','deleted_at','deleted_by'])=(to_jsonb(old)-array['body','deleted_at','deleted_by']) then return new; end if;
  end if;
  if tg_table_name='chat_attachments' then
   if new.deleted_at is not null and (v_json-'deleted_at')=(to_jsonb(old)-'deleted_at') then return new; end if;
  end if;
  if tg_table_name='chat_upload_intents' then
   if new.status='aborted' and (v_json-array['status','aborted_at'])=(to_jsonb(old)-array['status','aborted_at']) then return new; end if;
  end if;
 end if;
 case tg_table_name
 when 'chat_messages' then
  v_client:=private.health_record_client('conversation',new.conversation_id);
  if v_client is null then
   select id into v_client from public.profiles where role='client' and id in (new.sender_id,new.receiver_id);
  end if;
  if tg_op='UPDATE' then v_old_client:=private.health_record_client('message',old.id); end if;
 when 'chat_attachments' then
  v_client:=private.health_record_client('message',new.message_id);
  if tg_op='UPDATE' then v_old_client:=private.health_record_client('message',old.message_id); end if;
 when 'chat_upload_intents' then
  v_client:=private.health_record_client('conversation',new.conversation_id);
  if tg_op='UPDATE' then v_old_client:=private.health_record_client('conversation',old.conversation_id); end if;
 end case;
 if v_client is null or (tg_op='UPDATE' and v_old_client is distinct from v_client) then raise exception 'Health record owner cannot change' using errcode='42501'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client::text,8311));
 -- No service-role bypass for content/validation writes.
 if not private.health_consent_has(v_client,true) then raise exception 'Health data sharing consent required' using errcode='42501'; end if;
 return new;
end $$;
revoke all on function private.guard_chat_health_write() from public,anon,authenticated,service_role;
create trigger trg_guard_chat_health_write before insert or update on public.chat_messages for each row execute function private.guard_chat_health_write();
create trigger trg_guard_chat_health_write before insert or update on public.chat_attachments for each row execute function private.guard_chat_health_write();
create trigger trg_guard_chat_health_write before insert or update on public.chat_upload_intents for each row execute function private.guard_chat_health_write();
create policy "Chat consent read gate" on public.chat_conversations as restrictive for select to authenticated using (private.health_record_read_allows('conversation',id));
create policy "Chat consent read gate" on public.chat_messages as restrictive for select to authenticated using (private.health_record_read_allows('message',id));
create policy "Chat consent read gate" on public.chat_attachments as restrictive for select to authenticated using (private.health_record_read_allows('message',message_id));
create policy "Chat consent read gate" on public.chat_upload_intents as restrictive for select to authenticated using (private.health_record_read_allows('conversation',conversation_id));
create policy "Chat receipt consent read gate" on public.chat_read_states as restrictive for select to authenticated using (private.health_record_read_allows('conversation',conversation_id));

create function private.chat_object_consent_allows(p_name text,p_read boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_client uuid;
begin
 if not private.health_consent_enabled() then return true; end if;
 if auth.uid() is null then return false; end if;
 select c.client_id into v_client from public.chat_upload_intents i join public.chat_conversations c on c.id=i.conversation_id
  where i.bucket_id='chat-images' and i.object_path=p_name;
 if v_client is null then return false; end if;
 if not p_read then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client::text,8311)); end if;
 return (p_read and v_client=auth.uid()) or private.health_consent_has(v_client,true);
end $$;
revoke all on function private.chat_object_consent_allows(text,boolean) from public,anon,service_role;
grant execute on function private.chat_object_consent_allows(text,boolean) to authenticated;
create policy "Chat image consent read gate" on storage.objects as restrictive for select to authenticated using (bucket_id<>'chat-images' or private.chat_object_consent_allows(name,true));
create policy "Chat image consent insert gate" on storage.objects as restrictive for insert to authenticated with check (bucket_id<>'chat-images' or private.chat_object_consent_allows(name,false));
create policy "Chat image consent update gate" on storage.objects as restrictive for update to authenticated using (bucket_id<>'chat-images' or private.chat_object_consent_allows(name,false)) with check (bucket_id<>'chat-images' or private.chat_object_consent_allows(name,false));

create function private.plan_photo_consent_allows(p_name text,p_read boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_client uuid;
begin
 if not private.health_consent_enabled() then return true; end if;
 select id into v_client from public.profiles where role='client' and id::text=split_part(p_name,'/',2);
 if auth.uid() is null or v_client is null or split_part(p_name,'/',1)<>'meal-plans' then return false; end if;
 if not p_read then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_client::text,8311)); end if;
 return (p_read and v_client=auth.uid()) or private.health_consent_has(v_client,true);
end $$;
revoke all on function private.plan_photo_consent_allows(text,boolean) from public,anon,service_role;
grant execute on function private.plan_photo_consent_allows(text,boolean) to authenticated;
create policy "Plan image consent read gate" on storage.objects as restrictive for select to authenticated using (bucket_id<>'meal-photos' or private.plan_photo_consent_allows(name,true));
create policy "Plan image consent insert gate" on storage.objects as restrictive for insert to authenticated with check (bucket_id<>'meal-photos' or private.plan_photo_consent_allows(name,false));
create policy "Plan image consent update gate" on storage.objects as restrictive for update to authenticated using (bucket_id<>'meal-photos' or private.plan_photo_consent_allows(name,false)) with check (bucket_id<>'meal-photos' or private.plan_photo_consent_allows(name,false));

-- User JWT precheck before the validator uses service credentials to download
-- image bytes. The validation table trigger independently rechecks before write.
create function private.can_process_my_chat_image(p_intent_id uuid)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_conversation uuid; v_client uuid;
begin
 if auth.uid() is null then return false; end if;
 select i.conversation_id into v_conversation from public.chat_upload_intents i
  where i.id=p_intent_id and i.created_by=auth.uid();
 select c.client_id into v_client from public.chat_conversations c where c.id=v_conversation
  and public.chat_has_active_relationship(c.dietitian_id,c.client_id);
 return v_client is not null and private.health_consent_has(v_client,true);
end $$;
revoke all on function private.can_process_my_chat_image(uuid) from public,anon,service_role;
grant execute on function private.can_process_my_chat_image(uuid) to authenticated;
create function public.can_process_my_chat_image(p_intent_id uuid) returns boolean language sql security invoker set search_path='' as $$ select private.can_process_my_chat_image(p_intent_id); $$;
revoke all on function public.can_process_my_chat_image(uuid) from public,anon,service_role;
grant execute on function public.can_process_my_chat_image(uuid) to authenticated;

-- Background health notifications are skipped without sharing. Relationship
-- events carry no health content and retain the existing behavior.
create function private.notification_health_allows(p_row public.notifications,p_read boolean)
returns boolean language plpgsql security definer set search_path='' as $$
declare v_client uuid;
begin
 if not private.health_consent_enabled() or p_row.category='relationship' then return true; end if;
 v_client:=coalesce(private.health_record_client('conversation',p_row.conversation_id),private.health_record_client('relationship',p_row.dietitian_client_id));
 if v_client is null and p_row.appointment_id is not null then select client_id into v_client from public.appointments where id=p_row.appointment_id; end if;
 -- An unlinked dietitian calendar appointment has no client health record.
 if v_client is null then return p_row.category='appointment' and p_row.dietitian_client_id is null and p_row.conversation_id is null
   and exists(select 1 from public.appointments a where a.id=p_row.appointment_id and a.client_id is null); end if;
 return (p_read and auth.uid()=v_client) or private.health_consent_has(v_client,true);
end $$;
revoke all on function private.notification_health_allows(public.notifications,boolean) from public,anon,service_role;
grant execute on function private.notification_health_allows(public.notifications,boolean) to authenticated;
create function private.guard_health_notification_write() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='UPDATE' and (to_jsonb(new)-array['seen_at','read_at','updated_at'])=(to_jsonb(old)-array['seen_at','read_at','updated_at']) then return new; end if;
 if not private.notification_health_allows(new,false) then return null; end if;
 return new;
end $$;
revoke all on function private.guard_health_notification_write() from public,anon,authenticated,service_role;
create trigger trg_guard_health_notification_write before insert or update on public.notifications for each row execute function private.guard_health_notification_write();
create policy "Health notification consent read gate" on public.notifications as restrictive for select to authenticated using (private.notification_health_allows(notifications,true));

-- Queued push work must recheck the source when creating or advancing delivery.
-- There is no sending worker in this repository yet; future workers must recheck
-- immediately before sending and must not reuse an earlier eligibility result.
create function private.guard_health_push_write() returns trigger language plpgsql security definer set search_path='' as $$
declare n public.notifications%rowtype;
begin
 select * into n from public.notifications where id=new.notification_id;
 if not found or not private.notification_health_allows(n,false) then
  if tg_table_name='push_deliveries' and tg_op='UPDATE' then
   if old.status in ('receipt_ok','permanent','disabled','coalesced') then return null; end if;
   new.status:='disabled'; return new;
  end if;
  return null;
 end if;
 return new;
end $$;
revoke all on function private.guard_health_push_write() from public,anon,authenticated,service_role;
-- Clearing a nutrition target still removes it, but cannot return the old
-- health payload to a dietitian after sharing is no longer granted.
do $$
declare obj oid:=to_regprocedure('public.set_client_nutrition_target(uuid,integer,integer)'); src text; replacement text;
begin
 select prosrc into src from pg_proc where oid=obj and prosecdef;
 if src is null or position('    -- Clearing returns the removed row (or null when nothing was stored).' in src)=0 then raise exception 'Nutrition cleanup prerequisite/drift'; end if;
 replacement:=replace(src,'    -- Clearing returns the removed row (or null when nothing was stored).',
  '    if not private.health_consent_has(p_client_id,true) then return null; end if;');
 execute replace(pg_get_functiondef(obj),src,replacement);
end $$;

-- Bulk definer notification acknowledgements must not expose hidden counts.
do $$
declare sig text; obj oid; src text; replacement text;
begin
 for sig in values ('public.mark_notifications_seen(uuid[])'),('public.mark_all_notifications_read()') loop
  obj:=to_regprocedure(sig);
  select prosrc into src from pg_proc where oid=obj and prosecdef;
  if src is null or position('   where recipient_id = v_actor_id' in src)=0 then raise exception 'Notification bulk prerequisite/drift: %',sig; end if;
  replacement:=replace(src,'   where recipient_id = v_actor_id','   where recipient_id = v_actor_id and private.notification_health_allows(notifications,true)');
  if sig='public.mark_notifications_seen(uuid[])' then
   if position('        and n.recipient_id = v_actor_id' in src)=0 then raise exception 'Notification batch ownership prerequisite/drift'; end if;
   replacement:=replace(replacement,'        and n.recipient_id = v_actor_id','        and n.recipient_id = v_actor_id and private.notification_health_allows(n,true)');
  end if;
  execute replace(pg_get_functiondef(obj),src,replacement);
 end loop;
end $$;

-- Filter scheduled candidates and stop producers before reading profiles or
-- building health notification payloads. Original producer feature flags stay.
do $$
declare sig text; obj oid; src text; replacement text; marker text:=E'\nbegin\n'; insertion text;
begin
 for sig,insertion in values
  ('private.insert_activity_notification_once(uuid,text,text,text,text,uuid,uuid,uuid,uuid,date,timestamptz)',
   '  if not private.health_consent_has(private.health_record_client(''relationship'',p_dietitian_client_id),true) then return false; end if;'),
  ('private.notify_client_meal_plan_updated(uuid,uuid,date)',
   '  if not private.health_consent_has(p_client_id,true) then return false; end if;'),
  ('private.upsert_notification_aggregate(uuid,text,text,text,text,uuid,uuid,uuid,uuid,text,date,time without time zone,text,public.client_status,public.client_status,timestamptz)',
   '  if p_category<>''relationship'' and not private.health_consent_has(coalesce(private.health_record_client(''conversation'',p_conversation_id),private.health_record_client(''relationship'',p_dietitian_client_id),(select client_id from public.appointments where id=p_appointment_id)),true) and not (p_category=''appointment'' and p_conversation_id is null and p_dietitian_client_id is null and exists(select 1 from public.appointments where id=p_appointment_id and client_id is null)) then return null; end if;')
 loop
  obj:=to_regprocedure(sig);
  select prosrc into src from pg_proc where oid=obj and prosecdef;
  if src is null or position(marker in src)=0 then raise exception 'Producer entry prerequisite/drift: %',sig; end if;
  replacement:=overlay(src placing marker||insertion||E'\n' from position(marker in src) for length(marker));
  execute replace(pg_get_functiondef(obj),src,replacement);
 end loop;
 obj:=to_regprocedure('private.process_client_meal_inactivity_at(timestamptz)');
 select prosrc into src from pg_proc where oid=obj and prosecdef;
 if src is null or position('where dc.status = ''active''::public.client_status' in src)=0 then raise exception 'Inactivity prerequisite/drift'; end if;
 replacement:=replace(src,'where dc.status = ''active''::public.client_status','where private.health_consent_has(dc.client_id,true) and dc.status = ''active''::public.client_status');
 execute replace(pg_get_functiondef(obj),src,replacement);
end $$;

create trigger trg_guard_health_push_write before insert on private.push_occurrences for each row execute function private.guard_health_push_write();
create trigger trg_guard_health_push_write before insert or update on private.push_deliveries for each row execute function private.guard_health_push_write();
notify pgrst,'reload schema';
commit;
