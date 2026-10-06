-- Faz 2 / 1: meal change request security.
--
-- Before this migration a client could (a) open a request against any
-- dietitian id and (b) change the status of its own request, because the
-- update policy allowed both parties to write every column.
--
-- After this migration:
--   * a client may only INSERT a pending, unreviewed request addressed to its
--     own ACTIVE dietitian (the shape the store mobile build already sends);
--   * nobody updates or deletes rows directly; the decision is taken only
--     through public.review_meal_change_request by the addressed, approved
--     dietitian while the relationship is still active;
--   * review metadata (reviewed_at, reviewed_by, response_note) is written by
--     the server only.
begin;

do $preflight$
begin
  if to_regclass('public.meal_change_requests') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regprocedure('public.current_user_role()') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null then
    raise exception 'Meal change request security prerequisites are missing.';
  end if;

  if to_regprocedure('public.review_meal_change_request(uuid,text,text)') is not null then
    raise exception 'review_meal_change_request already exists; inspect schema drift before applying this migration.';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'meal_change_requests'
       and column_name in ('reviewed_at', 'reviewed_by', 'response_note')
  ) then
    raise exception 'Meal change request review columns already exist; inspect schema drift.';
  end if;
end
$preflight$;

alter table public.meal_change_requests
  add column reviewed_at timestamptz,
  add column reviewed_by uuid references public.profiles(id) on delete set null,
  add column response_note text;

alter table public.meal_change_requests
  add constraint meal_change_requests_response_note_length_check
    check (response_note is null or char_length(btrim(response_note)) between 1 and 1000),
  add constraint meal_change_requests_review_consistency_check
    check (
      (status in ('pending', 'cancelled') and reviewed_at is null and reviewed_by is null and response_note is null)
      or (status in ('approved', 'rejected') and reviewed_at is not null)
    ) not valid;

-- Rows decided before this migration may lack reviewed_at; the constraint is
-- enforced for every new write and validated only when history allows it.
do $validate$
begin
  if not exists (
    select 1 from public.meal_change_requests
     where status in ('approved', 'rejected')
  ) then
    alter table public.meal_change_requests
      validate constraint meal_change_requests_review_consistency_check;
  end if;
end
$validate$;

drop policy if exists "meal_change_requests_update_parties" on public.meal_change_requests;
drop policy if exists "meal_change_requests_insert_client" on public.meal_change_requests;

create policy "meal_change_requests_insert_client_active_dietitian"
  on public.meal_change_requests
  for insert
  to authenticated
  with check (
    (select auth.uid()) = client_id
    and (select public.current_user_role()) = 'client'::public.user_role
    and dietitian_id is not null
    and status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
    and response_note is null
    and exists (
      select 1
        from public.dietitian_clients as dc
       where dc.client_id = (select auth.uid())
         and dc.dietitian_id = meal_change_requests.dietitian_id
         and dc.status = 'active'::public.client_status
    )
  );

-- Defense in depth: without an UPDATE/DELETE policy RLS already denies these,
-- the privileges are removed as well so a future permissive policy cannot
-- silently re-open status writes.
revoke update, delete, truncate on table public.meal_change_requests from anon, authenticated;
revoke all on table public.meal_change_requests from anon;

create function public.review_meal_change_request(
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

  select r.*
    into v_request
    from public.meal_change_requests as r
   where r.id = p_request_id
   for update;

  -- A missing row and a foreign row are indistinguishable to the caller.
  if not found or v_request.dietitian_id is distinct from v_actor_id then
    raise exception 'Meal change request access denied.' using errcode = '42501';
  end if;

  if not exists (
    select 1
      from public.dietitian_clients as dc
     where dc.dietitian_id = v_actor_id
       and dc.client_id = v_request.client_id
       and dc.status = 'active'::public.client_status
  ) then
    raise exception 'An active dietitian-client relationship is required.' using errcode = '42501';
  end if;

  if v_request.status is distinct from 'pending' then
    raise exception 'Meal change request is no longer pending.' using errcode = 'P0001';
  end if;

  update public.meal_change_requests as r
     set status = p_decision,
         reviewed_at = now(),
         reviewed_by = v_actor_id,
         response_note = v_note
   where r.id = v_request.id
     and r.status = 'pending'
  returning r.* into v_result;

  if not found then
    raise exception 'Meal change request decision could not be applied.' using errcode = 'P0001';
  end if;

  return v_result;
end
$function$;

alter function public.review_meal_change_request(uuid, text, text) owner to postgres;
revoke all on function public.review_meal_change_request(uuid, text, text) from public, anon, service_role;
grant execute on function public.review_meal_change_request(uuid, text, text) to authenticated;

create index if not exists meal_change_requests_dietitian_pending_idx
  on public.meal_change_requests (dietitian_id, created_at desc, id desc)
  where status = 'pending';

do $postflight$
begin
  if exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename = 'meal_change_requests'
       and permissive = 'PERMISSIVE'
       and cmd in ('UPDATE', 'DELETE', 'ALL')
  ) then
    raise exception 'meal_change_requests must not expose a direct UPDATE/DELETE policy.';
  end if;

  if has_table_privilege('authenticated', 'public.meal_change_requests', 'UPDATE')
     or has_table_privilege('authenticated', 'public.meal_change_requests', 'DELETE')
     or has_table_privilege('anon', 'public.meal_change_requests', 'SELECT') then
    raise exception 'meal_change_requests privileges are too broad.';
  end if;

  if has_function_privilege('anon', 'public.review_meal_change_request(uuid,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.review_meal_change_request(uuid,text,text)', 'EXECUTE') then
    raise exception 'review_meal_change_request ACL is incorrect.';
  end if;
end
$postflight$;

commit;
