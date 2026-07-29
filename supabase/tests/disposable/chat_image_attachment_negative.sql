\set ON_ERROR_STOP on

begin;

insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, raw_user_meta_data)
values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'authenticated', 'authenticated', 'image-negative-dietitian@example.test', 'fixture', now(), '{"account_type":"dietitian","full_name":"Image Negative Dietitian"}'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'authenticated', 'authenticated', 'image-negative-client-one@example.test', 'fixture', now(), '{"account_type":"client","full_name":"Image Negative Client One"}'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'authenticated', 'authenticated', 'image-negative-client-two@example.test', 'fixture', now(), '{"account_type":"client","full_name":"Image Negative Client Two"}');

insert into public.dietitian_clients (id, dietitian_id, client_id, status, requested_at, accepted_at)
values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'pending', now(), null),
  ('22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'pending', now(), null);

update public.dietitian_clients
   set status = 'active', accepted_at = now()
 where id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222');

insert into public.chat_conversations (id, dietitian_client_id, dietitian_id, client_id)
values
  ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
  ('44444444-4444-4444-8444-444444444444', '22222222-2222-4222-8222-222222222222', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc');

insert into public.chat_upload_intents (
  id, conversation_id, created_by, client_message_id, bucket_id, object_path,
  expected_mime, max_bytes, status, expires_at, validated_mime,
  validated_byte_size, validated_width, validated_height, validated_at,
  finalized_at
)
values
  ('55555555-5555-4555-8555-555555555555', '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '66666666-6666-4666-8666-666666666666', 'chat-images', 'pending/55555555-5555-4555-8555-555555555555/77777777-7777-4777-8777-777777777777.jpg', 'image/jpeg', 4194304, 'finalized', now() + interval '1 hour', 'image/jpeg', 100, 10, 10, now(), now()),
  ('88888888-8888-4888-8888-888888888888', '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '99999999-9999-4999-8999-999999999999', 'chat-images', 'pending/88888888-8888-4888-8888-888888888888/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg', 'image/jpeg', 4194304, 'finalized', now() + interval '1 hour', 'image/jpeg', 100, 10, 10, now(), now()),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccd', 'chat-images', 'pending/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc/cccccccc-cccc-4ccc-8ccc-cccccccccccd.jpg', 'image/jpeg', 4194304, 'finalized', now() + interval '1 hour', 'image/jpeg', 100, 10, 10, now(), now()),
  ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'chat-images', 'pending/dddddddd-dddd-4ddd-8ddd-dddddddddddd/ffffffff-ffff-4fff-8fff-ffffffffffff.jpg', 'image/jpeg', 4194304, 'finalized', now() + interval '1 hour', 'image/jpeg', 100, 10, 10, now(), now());

insert into public.chat_messages (id, conversation_id, sender_id, receiver_id, client_message_id, message_kind)
values
  ('12121212-1212-4121-8121-121212121212', '44444444-4444-4444-8444-444444444444', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '13131313-1313-4131-8131-131313131313', 'image'),
  ('14141414-1414-4141-8141-141414141414', '33333333-3333-4333-8333-333333333333', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '15151515-1515-4151-8151-151515151515', 'image'),
  ('16161616-1616-4161-8161-161616161616', '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '17171717-1717-4171-8171-171717171717', 'image');

insert into public.chat_image_cleanup_queue (intent_id, bucket_id, object_path, reason, available_at)
values ('55555555-5555-4555-8555-555555555555', 'chat-images', 'pending/55555555-5555-4555-8555-555555555555/77777777-7777-4777-8777-777777777777.jpg', 'aborted_intent', now());

do $$
begin
  begin
    insert into public.chat_attachments (message_id, intent_id, bucket_id, object_path, mime_type, byte_size, width, height)
    values ('12121212-1212-4121-8121-121212121212', '55555555-5555-4555-8555-555555555555', 'chat-images', 'pending/55555555-5555-4555-8555-555555555555/77777777-7777-4777-8777-777777777777.jpg', 'image/jpeg', 100, 10, 10);
    raise exception 'cross-conversation attachment insert was accepted';
  exception when others then
    if sqlerrm = 'cross-conversation attachment insert was accepted' then raise; end if;
  end;

  begin
    insert into public.chat_attachments (message_id, intent_id, bucket_id, object_path, mime_type, byte_size, width, height)
    values ('14141414-1414-4141-8141-141414141414', '88888888-8888-4888-8888-888888888888', 'chat-images', 'pending/88888888-8888-4888-8888-888888888888/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.jpg', 'image/jpeg', 100, 10, 10);
    raise exception 'wrong-sender attachment insert was accepted';
  exception when others then
    if sqlerrm = 'wrong-sender attachment insert was accepted' then raise; end if;
  end;

  begin
    insert into public.chat_attachments (message_id, intent_id, bucket_id, object_path, mime_type, byte_size, width, height)
    values ('16161616-1616-4161-8161-161616161616', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', 'chat-images', 'pending/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc/cccccccc-cccc-4ccc-8ccc-cccccccccccd.jpg', 'image/jpeg', 100, 10, 10);
    raise exception 'wrong-client-message attachment insert was accepted';
  exception when others then
    if sqlerrm = 'wrong-client-message attachment insert was accepted' then raise; end if;
  end;
end
$$;

rollback;

\echo CHAT_IMAGE_ATTACHMENT_NEGATIVE_PASS
