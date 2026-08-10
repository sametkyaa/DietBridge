\set ON_ERROR_STOP on
\echo MEAL_PHOTO_SECURITY_HARNESS_START

begin;

create temporary table meal_photo_context (
  approved uuid, foreign_approved uuid, pending uuid, rejected uuid,
  client_id uuid, foreign_client uuid, plan_id uuid, meal_id uuid,
  referenced_path text, orphan_path text, foreign_orphan_path text,
  missing_path text, recipe_path text, claimed_id uuid
) on commit drop;
grant select on meal_photo_context to authenticated, anon;
grant select on meal_photo_context to service_role;

insert into meal_photo_context values (
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  gen_random_uuid(), gen_random_uuid(), gen_random_uuid(), gen_random_uuid(),
  null, null, null, null, null, null
);
update meal_photo_context set
  referenced_path = format('meal-plans/%s/%s/%s.jpg', client_id, approved, gen_random_uuid()),
  orphan_path = format('meal-plans/%s/%s/%s.webp', client_id, approved, gen_random_uuid()),
  foreign_orphan_path = format('meal-plans/%s/%s/%s.jpg', foreign_client, foreign_approved, gen_random_uuid()),
  missing_path = format('meal-plans/%s/%s/%s.png', client_id, approved, gen_random_uuid()),
  recipe_path = format('recipes/%s/%s/%s.webp', approved, gen_random_uuid(), gen_random_uuid());

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at
)
select user_id, gen_random_uuid(), 'authenticated', 'authenticated',
  'meal-photo-harness+' || fixture || '@example.invalid',
  '$2a$10$fixturefixturefixturefixturefixturefixturefixturefixture', now(),
  jsonb_build_object('provider', 'email', 'providers', jsonb_build_array('email')),
  jsonb_build_object('account_type', account_type, 'full_name', fixture), now(), now()
from meal_photo_context
cross join lateral (values
  (approved, 'approved', 'dietitian'),
  (foreign_approved, 'foreign-approved', 'dietitian'),
  (pending, 'pending', 'dietitian'),
  (rejected, 'rejected', 'dietitian'),
  (client_id, 'client', 'client'),
  (foreign_client, 'foreign-client', 'client')
) as fixture(user_id, fixture, account_type);

update public.dietitian_profiles as dp
set verification_status = fixture.status,
    is_verified = fixture.status = 'approved'
from meal_photo_context,
 lateral (values
   (approved, 'approved'), (foreign_approved, 'approved'),
   (pending, 'pending'), (rejected, 'rejected')
 ) as fixture(user_id, status)
where dp.user_id = fixture.user_id;

insert into public.dietitian_clients (dietitian_id, client_id, status)
select approved, client_id, 'pending'::public.client_status from meal_photo_context
union all
select foreign_approved, foreign_client, 'pending'::public.client_status from meal_photo_context;
update public.dietitian_clients set status = 'active'::public.client_status,
  accepted_at = now(), updated_at = now()
where (dietitian_id, client_id) in (
  select approved, client_id from meal_photo_context
  union all
  select foreign_approved, foreign_client from meal_photo_context
);

insert into public.meal_plans (id, client_id, dietitian_id, plan_date)
select plan_id, client_id, approved, current_date from meal_photo_context;
insert into public.meals (id, plan_id, type, title, photo_url, source)
select meal_id, plan_id, 'breakfast'::public.meal_type, 'Harness', referenced_path, 'manual'
from meal_photo_context;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'meal-photos', referenced_path, approved::text,
       jsonb_build_object('mimetype', 'image/jpeg', 'size', 1024)
from meal_photo_context;

-- Approved linked dietitian and linked client can read the referenced object.
set local role authenticated;
select set_config('request.jwt.claim.sub', approved::text, true) from meal_photo_context \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', approved::text, 'role', 'authenticated')::text, true) from meal_photo_context \gset
do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'meal-photos') <> 1 then
    raise exception 'FAIL: APPROVED_DIETITIAN_READ';
  end if;
end $$;
reset role;

set local role authenticated;
select set_config('request.jwt.claim.sub', client_id::text, true) from meal_photo_context \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', client_id::text, 'role', 'authenticated')::text, true) from meal_photo_context \gset
do $$ begin
  if (select count(*) from storage.objects where bucket_id = 'meal-photos') <> 1 then
    raise exception 'FAIL: LINKED_CLIENT_READ';
  end if;
end $$;
reset role;

-- Foreign/pending/rejected/anon actors see no protected object.
set local role authenticated;
select set_config('request.jwt.claim.sub', foreign_approved::text, true) from meal_photo_context \gset
do $$ begin if exists (select 1 from storage.objects where bucket_id = 'meal-photos') then raise exception 'FAIL: FOREIGN_READ'; end if; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', pending::text, true) from meal_photo_context \gset
do $$ begin if exists (select 1 from storage.objects where bucket_id = 'meal-photos') then raise exception 'FAIL: PENDING_READ'; end if; end $$;
reset role;
set local role authenticated;
select set_config('request.jwt.claim.sub', rejected::text, true) from meal_photo_context \gset
do $$ begin if exists (select 1 from storage.objects where bucket_id = 'meal-photos') then raise exception 'FAIL: REJECTED_READ'; end if; end $$;
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true) \gset
do $$ begin if exists (select 1 from storage.objects where bucket_id = 'meal-photos') then raise exception 'FAIL: ANON_READ'; end if; end $$;
reset role;

-- Trigger queues only a replaced canonical meal path; recipe paths are ignored.
update public.meals set photo_url = (select recipe_path from meal_photo_context)
where id = (select meal_id from meal_photo_context);
do $$ begin
  if (select count(*) from public.meal_photo_cleanup_queue where reason = 'replaced') <> 1 then
    raise exception 'FAIL: CANONICAL_REPLACEMENT_QUEUE';
  end if;
end $$;
delete from public.meals where id = (select meal_id from meal_photo_context);
do $$ begin
  if (select count(*) from public.meal_photo_cleanup_queue) <> 1 then
    raise exception 'FAIL: RECIPE_PATH_IGNORED';
  end if;
end $$;

-- Cleanup-only enqueue survives approval/relationship loss but remains owner-only.
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'meal-photos', orphan_path, approved::text,
       jsonb_build_object('mimetype', 'image/webp', 'size', 1024)
from meal_photo_context;
insert into storage.objects (bucket_id, name, owner_id, metadata)
select 'meal-photos', foreign_orphan_path, approved::text,
       jsonb_build_object('mimetype', 'image/jpeg', 'size', 1024)
from meal_photo_context;
update public.dietitian_clients set status = 'removed'::public.client_status,
  removed_at = now(), updated_at = now()
where dietitian_id = (select approved from meal_photo_context)
  and client_id = (select client_id from meal_photo_context);
update public.dietitian_profiles set verification_status = 'rejected', is_verified = false
where user_id = (select approved from meal_photo_context);
set local role authenticated;
select set_config('request.jwt.claim.sub', approved::text, true) from meal_photo_context \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', approved::text, 'role', 'authenticated')::text, true) from meal_photo_context \gset
select public.enqueue_my_unreferenced_meal_photo_cleanup(orphan_path) from meal_photo_context;
select public.enqueue_my_unreferenced_meal_photo_cleanup(orphan_path) from meal_photo_context;
do $$ begin
  if public.get_my_meal_photo_cleanup_status() < 1 then
    raise exception 'FAIL: DEAPPROVED_OWNER_STATUS';
  end if;
end $$;
reset role;
do $$ begin
  if (select count(*) from public.meal_photo_cleanup_queue as q
      where q.object_path = (select orphan_path from meal_photo_context)
        and q.completed_at is null) <> 1 then
    raise exception 'FAIL: ORPHAN_ENQUEUE_IDEMPOTENT';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', foreign_approved::text, true) from meal_photo_context \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', foreign_approved::text, 'role', 'authenticated')::text, true) from meal_photo_context \gset
do $$ begin
  begin
    perform public.enqueue_my_unreferenced_meal_photo_cleanup(
      (select foreign_orphan_path from meal_photo_context)
    );
    raise exception 'FAIL: FOREIGN_OWNER_ENQUEUE_ALLOWED';
  exception when sqlstate '42501' then null;
  end;
end $$;
reset role;

-- SECURITY DEFINER worker boundaries reject authenticated JWTs even if ACLs drift.
grant execute on function public.claim_meal_photo_cleanup_batch(integer) to authenticated;
grant execute on function public.complete_meal_photo_cleanup(uuid) to authenticated;
set local role authenticated;
select set_config('request.jwt.claim.sub', approved::text, true) from meal_photo_context \gset
select set_config('request.jwt.claims', jsonb_build_object('sub', approved::text, 'role', 'authenticated')::text, true) from meal_photo_context \gset
do $$ begin
  begin
    perform public.claim_meal_photo_cleanup_batch(1);
    raise exception 'FAIL: AUTHENTICATED_JWT_CLAIM_ALLOWED';
  exception when sqlstate '42501' then null;
  end;
  begin
    perform public.complete_meal_photo_cleanup(gen_random_uuid());
    raise exception 'FAIL: AUTHENTICATED_JWT_COMPLETE_ALLOWED';
  exception when sqlstate '42501' then null;
  end;
end $$;
reset role;
revoke execute on function public.claim_meal_photo_cleanup_batch(integer) from authenticated;
revoke execute on function public.complete_meal_photo_cleanup(uuid) from authenticated;

-- Worker claims pending paths with retries. Completion fails while metadata exists.
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true) \gset
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \gset
select cleanup_id as claimed_id from public.claim_meal_photo_cleanup_batch(10)
where object_path = (select orphan_path from meal_photo_context) \gset
select public.complete_meal_photo_cleanup(:'claimed_id'::uuid);
reset role;
update meal_photo_context set claimed_id = :'claimed_id'::uuid;
do $$ begin
  if exists (select 1 from public.meal_photo_cleanup_queue as q
      where q.id = (select claimed_id from meal_photo_context) and q.completed_at is not null) then
    raise exception 'FAIL: COMPLETE_WHILE_OBJECT_EXISTS';
  end if;
end $$;

-- An already-absent object is safe and idempotent for the worker to complete.
select private.enqueue_meal_photo_cleanup(missing_path, 'failed_save')
from meal_photo_context;
set local role service_role;
select set_config('request.jwt.claim.role', 'service_role', true) \gset
select set_config('request.jwt.claims', '{"role":"service_role"}', true) \gset
select cleanup_id as missing_claimed_id from public.claim_meal_photo_cleanup_batch(10)
where object_path = (select missing_path from meal_photo_context) \gset
select public.complete_meal_photo_cleanup(:'missing_claimed_id'::uuid);
reset role;
do $$ begin
  if not exists (select 1 from public.meal_photo_cleanup_queue as q
      where q.object_path = (select missing_path from meal_photo_context)
        and q.completed_at is not null) then
    raise exception 'FAIL: COMPLETE_AFTER_DELETE';
  end if;
end $$;

\echo PASS: APPROVED_DIETITIAN_READ
\echo PASS: LINKED_CLIENT_READ
\echo PASS: FOREIGN_PENDING_REJECTED_ANON_DENIED
\echo PASS: CANONICAL_TRIGGER_RECIPE_IGNORE
\echo PASS: ORPHAN_ENQUEUE_IDEMPOTENT
\echo PASS: DEAPPROVED_OWNER_CLEANUP_FOREIGN_DENIED
\echo PASS: WORKER_INTERNAL_SERVICE_ROLE_AUTHORIZATION
\echo PASS: SERVICE_ROLE_CLAIM_COMPLETE
rollback;
\echo MEAL_PHOTO_SECURITY_HARNESS_PASS
