\set ON_ERROR_STOP on

begin read only;

do $$
declare
  v_kind_default text;
  v_bucket_public boolean;
  v_bucket_limit bigint;
  v_bucket_mimes text[];
  v_create_intent_definition text;
  v_record_validation_definition text;
  v_attachment_definition text;
  v_storage_insert_policy text;
begin
  if to_regclass('public.chat_upload_intents') is null
     or to_regclass('public.chat_attachments') is null
     or to_regclass('public.chat_image_cleanup_queue') is null then
    raise exception 'FAIL: CHAT_IMAGE_TABLES_EXIST';
  end if;

  select c.column_default
    into v_kind_default
    from information_schema.columns as c
    where c.table_schema = 'public'
      and c.table_name = 'chat_messages'
      and c.column_name = 'message_kind'
      and c.is_nullable = 'NO';
  if v_kind_default is null or v_kind_default not like '%text%' then
    raise exception 'FAIL: CHAT_IMAGE_MESSAGE_KIND_DEFAULT';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_upload_intents'::regclass
      and conname = 'chat_upload_intents_actor_client_key'
      and convalidated
  )
  or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_attachments'::regclass
      and conname = 'chat_attachments_message_id_key'
      and convalidated
  )
  or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_messages'::regclass
      and conname = 'chat_messages_message_kind_check'
      and convalidated
  )
  or not exists (
    select 1 from pg_constraint
      where conrelid = 'public.chat_upload_intents'::regclass
      and conname = 'chat_upload_intents_validation_shape_check'
      and convalidated
  )
  or not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_image_cleanup_queue'::regclass
      and conname = 'chat_image_cleanup_queue_path_check'
      and convalidated
  ) then
    raise exception 'FAIL: CHAT_IMAGE_CONSTRAINT_CONTRACT';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'chat_upload_intents'
      and indexname = 'chat_upload_intents_owner_status_expiry_idx'
  )
  or not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'chat_upload_intents'
      and indexname = 'chat_upload_intents_pending_expiry_idx'
  )
  or not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'chat_attachments'
      and indexname = 'chat_attachments_live_message_idx'
  )
  or not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'chat_image_cleanup_queue'
      and indexname = 'chat_image_cleanup_queue_available_idx'
  ) then
    raise exception 'FAIL: CHAT_IMAGE_INDEX_CONTRACT';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.chat_attachments'::regclass
      and tgname = 'trg_enforce_chat_attachment_contract'
      and not tgisinternal
  )
  or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.chat_upload_intents'::regclass
      and tgname = 'trg_queue_aborted_chat_image_intent'
      and not tgisinternal
  )
  or not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.chat_messages'::regclass
      and tgname = 'trg_queue_deleted_chat_image_attachment'
      and not tgisinternal
  ) then
    raise exception 'FAIL: CHAT_IMAGE_TRIGGER_CONTRACT';
  end if;

  if not exists (
    select 1 from pg_class
    where oid = 'public.chat_upload_intents'::regclass
      and relrowsecurity
  )
  or not exists (
    select 1 from pg_class
    where oid = 'public.chat_attachments'::regclass
      and relrowsecurity
  )
  or not exists (
    select 1 from pg_class
    where oid = 'public.chat_image_cleanup_queue'::regclass
      and relrowsecurity
  ) then
    raise exception 'FAIL: CHAT_IMAGE_RLS_ENABLED';
  end if;

  if has_table_privilege('authenticated', 'public.chat_upload_intents', 'INSERT')
     or has_table_privilege('authenticated', 'public.chat_upload_intents', 'UPDATE')
     or has_table_privilege('authenticated', 'public.chat_upload_intents', 'DELETE')
     or has_table_privilege('authenticated', 'public.chat_attachments', 'INSERT')
     or has_table_privilege('authenticated', 'public.chat_attachments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.chat_attachments', 'DELETE')
     or has_table_privilege('authenticated', 'public.chat_image_cleanup_queue', 'SELECT')
     or has_table_privilege('authenticated', 'public.chat_image_cleanup_queue', 'INSERT')
     or has_table_privilege('authenticated', 'public.chat_image_cleanup_queue', 'UPDATE')
     or has_table_privilege('authenticated', 'public.chat_image_cleanup_queue', 'DELETE') then
    raise exception 'FAIL: CHAT_IMAGE_DIRECT_DML_CLOSED';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_upload_intents'
      and policyname = 'chat_upload_intents_select_own'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  )
  or not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'chat_attachments'
      and policyname = 'chat_attachments_select_participant'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  )
  or exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename in ('chat_upload_intents', 'chat_attachments', 'chat_image_cleanup_queue')
      and cmd in ('INSERT', 'UPDATE', 'DELETE')
  ) then
    raise exception 'FAIL: CHAT_IMAGE_POLICY_SURFACE';
  end if;

  if to_regprocedure('public.create_chat_image_upload_intent(uuid,uuid,text)') is null
     or to_regprocedure('public.finalize_chat_image_message(uuid,text)') is null
     or to_regprocedure('public.abort_chat_image_upload(uuid)') is null
     or to_regprocedure('public.record_chat_image_validation(uuid,text,bigint,integer,integer)') is null
     or to_regprocedure('public.claim_chat_image_cleanup_batch(integer)') is null
     or to_regprocedure('public.complete_chat_image_cleanup(uuid)') is null then
    raise exception 'FAIL: CHAT_IMAGE_FUNCTIONS_EXIST';
  end if;

  select pg_get_functiondef('public.create_chat_image_upload_intent(uuid,uuid,text)'::regprocedure),
         pg_get_functiondef('public.record_chat_image_validation(uuid,text,bigint,integer,integer)'::regprocedure),
         pg_get_functiondef('public.enforce_chat_attachment_contract()'::regprocedure)
    into v_create_intent_definition, v_record_validation_definition,
         v_attachment_definition;
  if v_create_intent_definition not ilike '%p_expected_mime is distinct from ''image/jpeg''%'
     or v_create_intent_definition not ilike '%v_extension constant text := ''jpg''%'
     or v_create_intent_definition ilike '%image/png%'
     or v_create_intent_definition ilike '%image/webp%'
     or v_record_validation_definition not ilike '%p_validated_mime is distinct from ''image/jpeg''%'
     or v_record_validation_definition not ilike '%p_validated_width not between 1 and 2048%'
     or v_record_validation_definition not ilike '%p_validated_height not between 1 and 2048%'
     or v_record_validation_definition not ilike '%p_validated_width::bigint * p_validated_height::bigint > 4194304%'
     or v_record_validation_definition ilike '%image/png%'
     or v_record_validation_definition ilike '%image/webp%'
     or v_attachment_definition not ilike '%v_message_conversation_id is distinct from v_intent.conversation_id%'
     or v_attachment_definition not ilike '%v_message_sender_id is distinct from v_intent.created_by%'
     or v_attachment_definition not ilike '%v_message_client_message_id is distinct from v_intent.client_message_id%' then
    raise exception 'FAIL: CHAT_IMAGE_JPEG_ONLY_RPC_CONTRACT';
  end if;

  if has_function_privilege('authenticated', 'public.create_chat_image_upload_intent(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.finalize_chat_image_message(uuid,text)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.abort_chat_image_upload(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_chat_image_upload_intent(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finalize_chat_image_message(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.abort_chat_image_upload(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_chat_image_validation(uuid,text,bigint,integer,integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_chat_image_cleanup_batch(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_chat_image_cleanup(uuid)', 'EXECUTE') then
    raise exception 'FAIL: CHAT_IMAGE_DORMANT_GRANTS';
  end if;

  if not has_function_privilege('authenticated', 'public.send_chat_message(uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.delete_chat_message(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.mark_chat_conversation_delivered(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.mark_chat_conversation_read(uuid,uuid)', 'EXECUTE') then
    raise exception 'FAIL: TEXT_CHAT_RPC_REGRESSION';
  end if;

  select b.public, b.file_size_limit, b.allowed_mime_types
    into v_bucket_public, v_bucket_limit, v_bucket_mimes
    from storage.buckets as b
    where b.id = 'chat-images';
  if not found
     or v_bucket_public
     or v_bucket_limit is distinct from 4194304
     or v_bucket_mimes is distinct from array['image/jpeg']::text[] then
    raise exception 'FAIL: CHAT_IMAGE_BUCKET_CONTRACT';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'storage'
      and table_name = 'objects'
      and column_name = 'owner_id'
      and data_type = 'text'
  ) then
    raise exception 'FAIL: STORAGE_OWNER_ID_COLUMN';
  end if;

  select coalesce(with_check, '')
    into v_storage_insert_policy
    from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'chat_images_insert_pending_intent';
  if v_storage_insert_policy not ilike '%owner_id%'
     or v_storage_insert_policy not ilike '%auth.uid%::text%' then
    raise exception 'FAIL: STORAGE_OWNER_ID_POLICY';
  end if;

  if coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_upload_intents'::regclass
          and conname = 'chat_upload_intents_expected_mime_check')
     ), '') not ilike '%expected_mime = ''image/jpeg''%'
     or coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_upload_intents'::regclass
          and conname = 'chat_upload_intents_path_check')
     ), '') not ilike '%.jpg$%'
     or coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_upload_intents'::regclass
          and conname = 'chat_upload_intents_validation_shape_check')
     ), '') not ilike '%validated_mime = ''image/jpeg''%'
     or coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_upload_intents'::regclass
          and conname = 'chat_upload_intents_validation_shape_check')
     ), '') not ilike '%validated_width <= 2048%'
     or coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_upload_intents'::regclass
          and conname = 'chat_upload_intents_validation_shape_check')
     ), '') not ilike '%validated_height <= 2048%'
     or coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_upload_intents'::regclass
          and conname = 'chat_upload_intents_validation_shape_check')
     ), '') not ilike '%4194304%'
     or coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_attachments'::regclass
          and conname = 'chat_attachments_mime_check')
     ), '') not ilike '%mime_type = ''image/jpeg''%'
     or coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_attachments'::regclass
          and conname = 'chat_attachments_path_check')
     ), '') not ilike '%.jpg$%'
     or coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_attachments'::regclass
          and conname = 'chat_attachments_dimensions_check')
     ), '') not ilike '%width <= 2048%'
     or coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_attachments'::regclass
          and conname = 'chat_attachments_dimensions_check')
     ), '') not ilike '%height <= 2048%'
     or coalesce(pg_get_constraintdef(
       (select oid from pg_constraint
        where conrelid = 'public.chat_attachments'::regclass
          and conname = 'chat_attachments_dimensions_check')
     ), '') not ilike '%4194304%' then
    raise exception 'FAIL: CHAT_IMAGE_JPEG_ONLY_CONSTRAINTS';
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'chat_images_insert_pending_intent'
      and cmd = 'INSERT'
      and roles = array['authenticated']::name[]
  )
  or not exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'chat_images_select_live_attachment'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  )
  or exists (
    select 1 from pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname like 'chat_images_%'
      and (roles <> array['authenticated']::name[] or cmd in ('UPDATE', 'DELETE'))
  ) then
    raise exception 'FAIL: CHAT_IMAGE_STORAGE_POLICY_SURFACE';
  end if;

  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename in ('chat_upload_intents', 'chat_attachments', 'chat_image_cleanup_queue')
  )
  or not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'chat_messages'
  ) then
    raise exception 'FAIL: CHAT_IMAGE_REALTIME_SURFACE';
  end if;
end
$$;

rollback;

\echo CHAT_IMAGE_SECURITY_HARNESS_PASS
