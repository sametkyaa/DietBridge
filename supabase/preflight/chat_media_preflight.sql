-- READ ONLY. Refresh backup/restore evidence separately before any production write.
-- Expected production function bodies observed on 2026-10-12; re-review any drift.
with expected(signature,body_md5) as (values
 ('public.enforce_chat_message_contract()','3292235a55ee8078b785bfd8af630da1'),
 ('public.enforce_chat_attachment_contract()','b74c0605b0d2d3e9458c5d084696d1b5'),
 ('public.finalize_chat_image_message(uuid,text)','ec6f0525f186dfa02158cc39b0c7c778'),
 ('public.queue_deleted_chat_image_attachment()','2240b248343e7969d51ac54f364dfb07'),
 ('public.queue_aborted_chat_image_intent()','ba9627abd39ba8541fb785f958316a4e'),
 ('public.prepare_client_account_deletion(uuid,jsonb)','8b63bb1731e27fb2fa627ca7704d095d')
)
select signature,body_md5 expected_md5,md5(p.prosrc) observed_md5,
 coalesce(md5(p.prosrc)=body_md5,false) as matches
from expected e left join pg_proc p on p.oid=to_regprocedure(e.signature);

select to_regclass('private.chat_media_settings') is null as settings_absent,
 not exists(select 1 from storage.buckets where id='chat-media') as bucket_absent,
 to_regprocedure('public.create_chat_media_upload_intent(uuid,uuid,text,text,bigint)') is null as rpc_absent;

select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies
where (schemaname='public' and tablename in('chat_messages','chat_read_states','chat_upload_intents','chat_attachments'))
 or (schemaname='storage' and tablename='objects') order by schemaname,tablename,policyname;

select conrelid::regclass as relation,conname,pg_get_constraintdef(oid) as definition
from pg_constraint where conrelid in('public.chat_messages'::regclass,'public.chat_upload_intents'::regclass,
 'public.chat_attachments'::regclass,'public.chat_image_cleanup_queue'::regclass,
 'public.client_account_deletion_storage_manifest'::regclass) order by conrelid::regclass::text,conname;

select id,public,file_size_limit,allowed_mime_types from storage.buckets where id in('chat-images','chat-media');
select * from private.health_consent_settings;
