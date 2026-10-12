-- READ ONLY. Run only after the approved migration. Inspect results; do not infer runtime acceptance.
select enabled as generic_media_enabled from private.chat_media_settings where singleton;
select id,public,file_size_limit,allowed_mime_types from storage.buckets where id in('chat-images','chat-media');
select table_name,column_name,data_type,is_nullable,column_default from information_schema.columns
where table_schema='public' and ((table_name='chat_upload_intents' and column_name in('media_kind','file_name','declared_byte_size'))
 or (table_name='chat_attachments' and column_name='file_name')) order by table_name,column_name;
select signature,to_regprocedure(signature) is not null as exists,
 case when to_regprocedure(signature) is null then null else has_function_privilege('anon',signature,'execute') end as anon_execute,
 case when to_regprocedure(signature) is null then null else has_function_privilege('authenticated',signature,'execute') end as authenticated_execute,
 case when to_regprocedure(signature) is null then null else has_function_privilege('service_role',signature,'execute') end as service_execute
from (values ('public.get_chat_media_capabilities()'),
 ('public.create_chat_media_upload_intent(uuid,uuid,text,text,bigint)'),
 ('public.finalize_chat_media_message(uuid,text)'),
 ('public.record_chat_media_validation(uuid,text,bigint)')) s(signature);
select tgname,pg_get_triggerdef(oid) as definition from pg_trigger
where tgrelid in('public.chat_messages'::regclass,'public.chat_upload_intents'::regclass)
 and tgname in('trg_chat_message_rate','trg_chat_attachment_rate');
select indexname,indexdef from pg_indexes where schemaname='public'
 and indexname in('chat_messages_sender_rate_idx','chat_upload_intents_sender_rate_idx');
select schemaname,tablename,policyname,permissive,cmd,qual,with_check from pg_policies
where (schemaname='public' and tablename in('chat_read_states','chat_attachments'))
 or (schemaname='storage' and policyname like 'chat_media_%') order by schemaname,tablename,policyname;
select conrelid::regclass as relation,conname,pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid in('public.chat_messages'::regclass,'public.chat_upload_intents'::regclass,
 'public.chat_attachments'::regclass,'public.chat_image_cleanup_queue'::regclass,
 'public.client_account_deletion_storage_manifest'::regclass) order by conrelid::regclass::text,conname;
select * from private.health_consent_settings;
