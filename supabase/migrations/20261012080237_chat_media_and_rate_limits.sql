-- Additive media support. Existing JPEG RPCs, consent guards and receipts stay intact.
-- One-time migration; fails on unexpected prerequisite drift. Production requires approval.
begin;

create table private.chat_media_settings (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false
);
insert into private.chat_media_settings values(true,false);
alter table private.chat_media_settings enable row level security;
revoke all on private.chat_media_settings from public,anon,authenticated,service_role;

-- A sender must be able to observe the peer's receipt. Keep access confined
-- to both members of an active conversation; the consent read gate remains.
drop policy "Chat participants can select read states" on public.chat_read_states;
create policy "Chat participants can select read states" on public.chat_read_states for select to authenticated
 using(exists(select 1 from public.chat_conversations c where c.id=chat_read_states.conversation_id
  and chat_read_states.user_id in(c.client_id,c.dietitian_id)
  and public.chat_has_active_relationship(c.dietitian_id,c.client_id)));

alter table public.chat_upload_intents add column media_kind text not null default 'image',
 add column file_name text, add column declared_byte_size bigint;
alter table public.chat_attachments add column file_name text;
drop policy chat_attachments_select_participant on public.chat_attachments;
create policy chat_attachments_select_participant on public.chat_attachments for select to authenticated
 using(deleted_at is null and exists(select 1 from public.chat_messages m
  join public.chat_conversations c on c.id=m.conversation_id where m.id=chat_attachments.message_id
  and m.message_kind in('image','video','file') and m.deleted_at is null
  and public.chat_has_active_relationship(c.dietitian_id,c.client_id)));

create function private.chat_media_mime_limit(p_mime text) returns bigint
language sql immutable set search_path='' as $$
 select case when p_mime in ('video/mp4','video/quicktime','video/webm') then 20971520::bigint
 when p_mime in ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv') then 10485760::bigint end;
$$;
create function private.chat_media_extension(p_mime text) returns text
language sql immutable set search_path='' as $$
 select case p_mime when 'video/mp4' then 'mp4' when 'video/quicktime' then 'mov' when 'video/webm' then 'webm'
 when 'application/pdf' then 'pdf' when 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' then 'docx'
 when 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' then 'xlsx' when 'text/plain' then 'txt' when 'text/csv' then 'csv' end;
$$;
revoke all on function private.chat_media_mime_limit(text),private.chat_media_extension(text) from public,anon,authenticated,service_role;

alter table public.chat_messages drop constraint chat_messages_message_kind_check,
 add constraint chat_messages_message_kind_check check(message_kind in ('text','image','video','file'));
-- Preserve the current canonical shape definition, widening only the live/tombstone kind predicates.
do $$ declare definition text; begin
 select pg_get_constraintdef(oid) into definition from pg_constraint where conrelid='public.chat_messages'::regclass and conname='chat_messages_canonical_shape_check';
 if definition is null or position('message_kind = ''image''' in definition)=0 then raise exception 'Canonical chat shape drift'; end if;
 definition:=replace(definition,'(message_kind = ''image''::text)','(message_kind = ANY (ARRAY[''image''::text,''video''::text,''file''::text]))');
 definition:=replace(definition,'ARRAY[''text''::text, ''image''::text]','ARRAY[''text''::text, ''image''::text, ''video''::text, ''file''::text]');
 alter table public.chat_messages drop constraint chat_messages_canonical_shape_check;
 execute 'alter table public.chat_messages add constraint chat_messages_canonical_shape_check '||definition;
end $$;

alter table public.chat_upload_intents
 drop constraint chat_upload_intents_bucket_check, drop constraint chat_upload_intents_path_check,
 drop constraint chat_upload_intents_expected_mime_check, drop constraint chat_upload_intents_max_bytes_check,
 drop constraint chat_upload_intents_validation_shape_check,
 add constraint chat_upload_intents_media_check check ((
  (media_kind='image' and bucket_id='chat-images' and expected_mime='image/jpeg' and max_bytes=4194304
   and object_path ~ '^pending/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' and file_name is null and declared_byte_size is null)
  or (media_kind in ('video','file') and bucket_id='chat-media'
   and max_bytes=private.chat_media_mime_limit(expected_mime) and max_bytes is not null
   and (media_kind='video')=(expected_mime like 'video/%')
   and object_path ~ ('^pending/[0-9a-f-]{36}/[0-9a-f-]{36}\.'||private.chat_media_extension(expected_mime)||'$')
   and file_name is not null and char_length(file_name) between 1 and 120 and file_name !~ '[[:cntrl:]/\\]'
   and lower(file_name) like '%.'||private.chat_media_extension(expected_mime)
   and declared_byte_size between 1 and max_bytes)) is true),
 add constraint chat_upload_intents_validation_shape_check check (
  num_nonnulls(validated_mime,validated_byte_size,validated_width,validated_height,validated_at)=0
  or (num_nonnulls(validated_mime,validated_byte_size,validated_width,validated_height,validated_at)=5
   and validated_mime=expected_mime and validated_byte_size between 1 and max_bytes
   and ((media_kind='image' and validated_width between 1 and 2048 and validated_height between 1 and 2048
    and validated_width::bigint*validated_height<=4194304)
    or (media_kind in ('video','file') and validated_width=0 and validated_height=0 and validated_byte_size=declared_byte_size))));

alter table public.chat_attachments drop constraint chat_attachments_bucket_check,
 drop constraint chat_attachments_path_check, drop constraint chat_attachments_mime_check,
 drop constraint chat_attachments_byte_size_check, drop constraint chat_attachments_dimensions_check,
 add constraint chat_attachments_media_check check ((
  (bucket_id='chat-images' and mime_type='image/jpeg' and byte_size between 1 and 4194304
   and width between 1 and 2048 and height between 1 and 2048 and width::bigint*height<=4194304
   and object_path ~ '^pending/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$' and file_name is null)
  or (bucket_id='chat-media' and private.chat_media_mime_limit(mime_type) is not null
   and byte_size between 1 and private.chat_media_mime_limit(mime_type) and width=0 and height=0
   and object_path ~ ('^pending/[0-9a-f-]{36}/[0-9a-f-]{36}\.'||private.chat_media_extension(mime_type)||'$')
   and file_name is not null and char_length(file_name) between 1 and 120 and file_name !~ '[[:cntrl:]/\\]')) is true);

-- Widen only exact known contract markers; preserve health guards, ACLs and all ownership checks.
do $$ declare sig text; src text; changed text; definition text; begin
 foreach sig in array array['public.enforce_chat_message_contract()','public.enforce_chat_attachment_contract()','public.queue_deleted_chat_image_attachment()','public.queue_aborted_chat_image_intent()'] loop
  select prosrc into src from pg_proc where oid=to_regprocedure(sig);
  changed:=replace(src,E'\r\n',E'\n');
  if sig='public.enforce_chat_message_contract()' then changed:=replace(changed,'''text'', ''image''','''text'', ''image'', ''video'', ''file''');
  elsif sig='public.enforce_chat_attachment_contract()' then
   changed:=replace(changed,'v_message_kind <> ''image''','v_message_kind not in (''image'',''video'',''file'')');
   changed:=replace(changed,'or v_intent.validated_height is distinct from new.height','or v_intent.validated_height is distinct from new.height'||E'\n     or v_intent.media_kind is distinct from v_message_kind\n     or v_intent.file_name is distinct from new.file_name');
   changed:=replace(changed,'new.created_at'||E'\n       )','new.created_at, new.file_name'||E'\n       )');
   changed:=replace(changed,'old.created_at'||E'\n       )','old.created_at, old.file_name'||E'\n       )');
  elsif sig='public.queue_aborted_chat_image_intent()' then
   -- Let an already-running broker finish before claiming an aborted object.
   changed:=replace(changed,'''aborted_intent'','||E'\n      now()', '''aborted_intent'','||E'\n      now() + case when new.media_kind=''image'' then interval ''0 minutes'' else interval ''10 minutes'' end');
  else changed:=replace(changed,'old.message_kind = ''image''','old.message_kind in (''image'',''video'',''file'')'); end if;
  if changed is null or changed=replace(src,E'\r\n',E'\n') then raise exception 'Chat contract prerequisite drift: %',sig; end if;
  if sig='public.enforce_chat_attachment_contract()' and
   (position('new.created_at, new.file_name' in changed)=0 or position('v_intent.file_name is distinct from new.file_name' in changed)=0)
   then raise exception 'Attachment contract prerequisite drift'; end if;
  definition:=pg_get_functiondef(to_regprocedure(sig)); execute replace(definition,src,changed);
 end loop;
end $$;

alter table public.chat_image_cleanup_queue drop constraint chat_image_cleanup_queue_bucket_check,
 drop constraint chat_image_cleanup_queue_path_check,
 add constraint chat_image_cleanup_queue_media_path_check check (
 (bucket_id='chat-images' and object_path ~ '^pending/[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$')
 or (bucket_id='chat-media' and object_path ~ '^pending/[0-9a-f-]{36}/[0-9a-f-]{36}\.(mp4|mov|webm|pdf|docx|xlsx|txt|csv)$'));

create function private.guard_chat_rate_limit() returns trigger
language plpgsql security definer set search_path='' as $$
declare actor uuid; counts integer; reserved bigint; begin
 if tg_table_name='chat_messages' then actor:=new.sender_id; else actor:=new.created_by; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text,984211));
 if tg_table_name='chat_messages' then
  if exists(select 1 from public.chat_messages m where m.sender_id=actor and m.client_message_id=new.client_message_id) then return new; end if;
  select count(*) into counts from public.chat_messages m where m.sender_id=actor and m.created_at>statement_timestamp()-interval '1 minute';
  if counts>=30 then raise exception 'CHAT_RATE_LIMIT: minute messages' using errcode='22023'; end if;
  select count(*) into counts from public.chat_messages m where m.sender_id=actor and m.created_at>statement_timestamp()-interval '1 hour';
  if counts>=200 then raise exception 'CHAT_RATE_LIMIT: hourly messages' using errcode='22023'; end if;
 else
  select count(*) into counts from public.chat_upload_intents i where i.created_by=actor and i.created_at>statement_timestamp()-interval '1 minute';
  if counts>=5 then raise exception 'CHAT_RATE_LIMIT: minute attachments' using errcode='22023'; end if;
  select count(*),coalesce(sum(coalesce(i.declared_byte_size,i.max_bytes)),0) into counts,reserved
   from public.chat_upload_intents i where i.created_by=actor and i.created_at>statement_timestamp()-interval '1 hour';
  if counts>=30 or reserved+coalesce(new.declared_byte_size,new.max_bytes)>104857600 then raise exception 'CHAT_RATE_LIMIT: hourly attachments' using errcode='22023'; end if;
  select coalesce(sum(coalesce(i.declared_byte_size,i.max_bytes)),0) into reserved
   from public.chat_upload_intents i where i.created_by=actor and i.created_at>statement_timestamp()-interval '1 day';
  if reserved+coalesce(new.declared_byte_size,new.max_bytes)>314572800 then raise exception 'CHAT_RATE_LIMIT: daily bytes' using errcode='22023'; end if;
 end if;
 return new;
end $$;
revoke all on function private.guard_chat_rate_limit() from public,anon,authenticated,service_role;
create trigger trg_chat_message_rate before insert on public.chat_messages for each row execute function private.guard_chat_rate_limit();
create trigger trg_chat_attachment_rate before insert on public.chat_upload_intents for each row execute function private.guard_chat_rate_limit();
create index chat_messages_sender_rate_idx on public.chat_messages(sender_id,created_at);
create index chat_upload_intents_sender_rate_idx on public.chat_upload_intents(created_by,created_at);

create function public.get_chat_media_capabilities() returns jsonb
language sql security definer set search_path='' as $$
 select jsonb_build_object('enabled',auth.uid() is not null and enabled,'image_max_bytes',4194304,
 'video_max_bytes',20971520,'file_max_bytes',10485760,'hourly_max_bytes',104857600)
 from private.chat_media_settings where singleton;
$$;

create function public.create_chat_media_upload_intent(p_conversation_id uuid,p_client_message_id uuid,p_mime text,p_file_name text,p_byte_size bigint)
returns public.chat_upload_intents language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); result public.chat_upload_intents; extension text:=private.chat_media_extension(p_mime); kind text; begin
 if actor is null or not exists(select 1 from private.chat_media_settings where singleton and enabled) then raise exception 'CHAT_MEDIA_UNAVAILABLE' using errcode='42501'; end if;
 perform private.require_health_record('conversation',p_conversation_id,true);
 if not exists(select 1 from public.chat_conversations c where c.id=p_conversation_id and actor in(c.dietitian_id,c.client_id)
  and public.chat_has_active_relationship(c.dietitian_id,c.client_id)) then raise exception 'Chat access denied' using errcode='42501'; end if;
 if p_client_message_id is null or extension is null or p_byte_size is null or p_byte_size not between 1 and private.chat_media_mime_limit(p_mime)
  or p_file_name is null or char_length(p_file_name) not between 1 and 120 or p_file_name ~ '[[:cntrl:]/\\]'
  or lower(p_file_name) not like '%.'||extension then raise exception 'Invalid media descriptor' using errcode='22023'; end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(actor::text||p_client_message_id::text,984212));
 select * into result from public.chat_upload_intents where created_by=actor and client_message_id=p_client_message_id;
 if found then
  if result.conversation_id<>p_conversation_id or result.expected_mime<>p_mime or result.file_name<>p_file_name or result.declared_byte_size<>p_byte_size
   then raise exception 'Media idempotency conflict' using errcode='22023'; end if;
  return result;
 end if;
 kind:=case when p_mime like 'video/%' then 'video' else 'file' end;
 insert into public.chat_upload_intents(conversation_id,created_by,client_message_id,bucket_id,object_path,expected_mime,max_bytes,expires_at,media_kind,file_name,declared_byte_size)
 values(p_conversation_id,actor,p_client_message_id,'chat-media','pending/'||gen_random_uuid()||'/'||gen_random_uuid()||'.'||extension,
 p_mime,private.chat_media_mime_limit(p_mime),now()+interval '15 minutes',kind,p_file_name,p_byte_size) returning * into result;
 return result;
end $$;

create function public.record_chat_media_validation(p_intent_id uuid,p_mime text,p_byte_size bigint)
returns boolean language plpgsql security definer set search_path='' as $$
declare intent public.chat_upload_intents; begin
 if (auth.jwt()->>'role') is distinct from 'service_role' then raise exception 'Validation service required' using errcode='42501'; end if;
 select * into intent from public.chat_upload_intents where id=p_intent_id for update;
 if not exists(select 1 from private.chat_media_settings where singleton and enabled) or not found or intent.media_kind not in ('video','file') or intent.status<>'pending' or intent.expires_at<=now()
  or p_mime is distinct from intent.expected_mime or p_byte_size is distinct from intent.declared_byte_size then raise exception 'Invalid media validation' using errcode='22023'; end if;
 if not exists(select 1 from public.chat_conversations c join public.dietitian_clients dc on dc.id=c.dietitian_client_id
  where c.id=intent.conversation_id and dc.status='active' and dc.dietitian_id=c.dietitian_id and dc.client_id=c.client_id
  and private.health_consent_has(c.client_id,true)) then raise exception 'Chat access denied' using errcode='42501'; end if;
 update public.chat_upload_intents set validated_mime=p_mime,validated_byte_size=p_byte_size,validated_width=0,validated_height=0,validated_at=now() where id=p_intent_id;
 return true;
end $$;

-- Clone the current finalize implementation to preserve idempotency, notifications,
-- relation and health checks. The original JPEG endpoint remains JPEG-only.
do $$ declare src text; changed text; definition text; begin
 select prosrc into src from pg_proc where oid='public.finalize_chat_image_message(uuid,text)'::regprocedure;
 if position('private.require_health_record' in src)=0 or position('private.upsert_notification_aggregate' in src)=0
  or position('v_caption, ''image'', now()' in src)=0 then raise exception 'Finalize prerequisite drift'; end if;
 changed:=replace(replace(src,E'\r\n',E'\n'),'v_existing.message_kind <> ''image''','v_existing.message_kind <> v_intent.media_kind');
 changed:=regexp_replace(changed,E'\\mbegin\\M', E'begin\n  if not exists(select 1 from private.chat_media_settings where singleton and enabled) then raise exception ''Chat media unavailable.'' using errcode=''42501''; end if;', 'i');
 changed:=replace(changed,'v_caption, ''image'', now()','v_caption, v_intent.media_kind, now()');
 -- Media objects are broker-owned; authenticated callers cannot insert them.
 changed:=replace(changed,'v_object_owner is distinct from v_actor_id::text','v_object_owner is not null');
 changed:=replace(changed,'byte_size, width, height'||E'\n','byte_size, width, height, file_name'||E'\n');
 changed:=replace(changed,'v_intent.validated_width, v_intent.validated_height'||E'\n','v_intent.validated_width, v_intent.validated_height, v_intent.file_name'||E'\n');
 changed:=replace(changed,'if not found then'||E'\n    raise exception ''Chat access denied.''',
 'if not found or v_intent.media_kind not in (''video'',''file'') then'||E'\n    raise exception ''Chat access denied.''');
 if position('byte_size, width, height, file_name' in changed)=0 or position('v_intent.validated_height, v_intent.file_name' in changed)=0
  or position('v_intent.media_kind not in' in changed)=0 or position('v_object_owner is not null' in changed)=0 then raise exception 'Media finalize prerequisite drift'; end if;
 definition:=replace(pg_get_functiondef('public.finalize_chat_image_message(uuid,text)'::regprocedure),'public.finalize_chat_image_message','public.finalize_chat_media_message');
 execute replace(definition,src,changed);
 -- Prevent a new generic intent from entering the existing JPEG endpoint.
 changed:=replace(replace(src,E'\r\n',E'\n'),'if not found then'||E'\n    raise exception ''Chat access denied.''','if not found or v_intent.media_kind <> ''image'' then'||E'\n    raise exception ''Chat access denied.''');
 execute replace(pg_get_functiondef('public.finalize_chat_image_message(uuid,text)'::regprocedure),src,changed);
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('chat-media','chat-media',false,20971520,array['video/mp4','video/quicktime','video/webm','application/pdf',
'application/vnd.openxmlformats-officedocument.wordprocessingml.document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','text/plain','text/csv']);

create function private.chat_media_object_allowed(p_path text,p_read boolean) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); intent public.chat_upload_intents; client uuid; dietitian uuid; begin
 if actor is null then return false; end if;
 select i.* into intent from public.chat_upload_intents i where i.bucket_id='chat-media' and i.object_path=p_path;
 if not found then return false; end if;
 select c.client_id,c.dietitian_id into client,dietitian from public.chat_conversations c where c.id=intent.conversation_id;
 if actor not in(client,dietitian) or not public.chat_has_active_relationship(dietitian,client)
  or not private.health_record_read_allows('conversation',intent.conversation_id) then return false; end if;
 if p_read then return exists(select 1 from public.chat_attachments a join public.chat_messages m on m.id=a.message_id
  where a.intent_id=intent.id and a.deleted_at is null and m.deleted_at is null and m.message_kind in('video','file')); end if;
 perform private.require_health_record('conversation',intent.conversation_id,true);
 return intent.created_by=actor and intent.status='pending' and intent.validated_at is null and intent.expires_at>now()
  and exists(select 1 from private.chat_media_settings where singleton and enabled);
end $$;
revoke all on function private.chat_media_object_allowed(text,boolean) from public,anon,service_role;
grant execute on function private.chat_media_object_allowed(text,boolean) to authenticated;
create policy chat_media_select_live on storage.objects for select to authenticated
 using(bucket_id='chat-media' and private.chat_media_object_allowed(name,true));
-- Restrictive guards prevent unrelated permissive owner policies from widening this bucket.
create policy chat_media_insert_guard on storage.objects as restrictive for insert to authenticated
 with check(bucket_id<>'chat-media');
create policy chat_media_read_guard on storage.objects as restrictive for select to authenticated
 using(bucket_id<>'chat-media' or private.chat_media_object_allowed(name,true));
create policy chat_media_no_update on storage.objects as restrictive for update to authenticated
 using(bucket_id<>'chat-media') with check(bucket_id<>'chat-media');
create policy chat_media_no_delete on storage.objects as restrictive for delete to authenticated using(bucket_id<>'chat-media');

revoke all on function public.get_chat_media_capabilities(),public.create_chat_media_upload_intent(uuid,uuid,text,text,bigint),
 public.finalize_chat_media_message(uuid,text),public.record_chat_media_validation(uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.get_chat_media_capabilities(),public.create_chat_media_upload_intent(uuid,uuid,text,text,bigint),public.finalize_chat_media_message(uuid,text) to authenticated;
grant execute on function public.record_chat_media_validation(uuid,text,bigint) to service_role;

-- Account deletion persists an exact manifest before removing chat rows.
alter table public.client_account_deletion_storage_manifest drop constraint client_account_deletion_manifest_bucket_check;
alter table public.client_account_deletion_storage_manifest add constraint client_account_deletion_manifest_bucket_check
 check(bucket_id in('avatars','meal-completion-photos','chat-images','chat-media'));
do $$ declare src text; changed text; pattern text; begin
 select prosrc into src from pg_proc where oid='public.prepare_client_account_deletion(uuid,jsonb)'::regprocedure;
 if position('elsif v_bucket_id = ''chat-images'' then' in src)=0 then raise exception 'Account deletion prerequisite drift'; end if;
 changed:=replace(src,'elsif v_bucket_id = ''chat-images'' then','elsif v_bucket_id in (''chat-images'',''chat-media'') then');
 pattern:='^pending/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
 changed:=replace(changed,''''||pattern||E'\\.jpg$'||'''',quote_literal(pattern)||' || case when v_bucket_id=''chat-images'' then '||quote_literal(E'\\.jpg$')||' else '||quote_literal(E'\\.(mp4|mov|webm|pdf|docx|xlsx|txt|csv)$')||' end');
 if changed=src or position('case when v_bucket_id=' in changed)=0 then raise exception 'Account deletion path prerequisite drift'; end if;
 execute replace(pg_get_functiondef('public.prepare_client_account_deletion(uuid,jsonb)'::regprocedure),src,changed);
end $$;
notify pgrst, 'reload schema';
commit;
