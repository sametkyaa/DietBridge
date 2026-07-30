begin;

do $$
begin
  if to_regprocedure('public.create_chat_image_upload_intent(uuid,uuid,text)') is null
     or to_regprocedure('public.finalize_chat_image_message(uuid,text)') is null
     or to_regprocedure('public.abort_chat_image_upload(uuid)') is null
     or to_regprocedure('public.record_chat_image_validation(uuid,text,bigint,integer,integer)') is null
     or to_regprocedure('public.claim_chat_image_cleanup_batch(integer)') is null
     or to_regprocedure('public.complete_chat_image_cleanup(uuid)') is null then
    raise exception 'Chat image RPC activation prerequisites are missing.';
  end if;
end
$$;

revoke all on function public.create_chat_image_upload_intent(uuid, uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.finalize_chat_image_message(uuid, text)
  from public, anon, authenticated, service_role;
revoke all on function public.abort_chat_image_upload(uuid)
  from public, anon, authenticated, service_role;

grant execute on function public.create_chat_image_upload_intent(uuid, uuid, text) to authenticated;
grant execute on function public.finalize_chat_image_message(uuid, text) to authenticated;
grant execute on function public.abort_chat_image_upload(uuid) to authenticated;

do $$
begin
  if not has_function_privilege('authenticated', 'public.create_chat_image_upload_intent(uuid,uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.finalize_chat_image_message(uuid,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.abort_chat_image_upload(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.create_chat_image_upload_intent(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.finalize_chat_image_message(uuid,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.abort_chat_image_upload(uuid)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.create_chat_image_upload_intent(uuid,uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.finalize_chat_image_message(uuid,text)', 'EXECUTE')
     or has_function_privilege('service_role', 'public.abort_chat_image_upload(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.record_chat_image_validation(uuid,text,bigint,integer,integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.record_chat_image_validation(uuid,text,bigint,integer,integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.record_chat_image_validation(uuid,text,bigint,integer,integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.claim_chat_image_cleanup_batch(integer)', 'EXECUTE')
     or has_function_privilege('anon', 'public.claim_chat_image_cleanup_batch(integer)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.claim_chat_image_cleanup_batch(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.complete_chat_image_cleanup(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.complete_chat_image_cleanup(uuid)', 'EXECUTE')
     or not has_function_privilege('service_role', 'public.complete_chat_image_cleanup(uuid)', 'EXECUTE') then
    raise exception 'Chat image RPC activation postcondition failed.';
  end if;
end
$$;

commit;
