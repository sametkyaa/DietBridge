-- Keep the mobile RPC and profile-trigger calendar consistent with Web.
-- Idempotent: only the function-local TimeZone changes. Bodies, ownership,
-- signatures, grants, RLS, rows and constraints are untouched.
-- Production application requires separate approval.
begin;

do $preflight$
begin
  if to_regprocedure('public.save_my_current_weight(numeric)') is null
     or to_regprocedure('public.sync_client_weight_to_measurements()') is null then
    raise exception 'Expected mobile weight functions are missing.';
  end if;
  if (select prorettype from pg_proc where oid = 'public.save_my_current_weight(numeric)'::regprocedure)
       <> 'jsonb'::regtype
     or (select prorettype from pg_proc where oid = 'public.sync_client_weight_to_measurements()'::regprocedure)
       <> 'trigger'::regtype then
    raise exception 'Unexpected mobile weight function signatures.';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.client_profiles'::regclass
      and tgfoid = 'public.sync_client_weight_to_measurements()'::regprocedure
      and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'Expected client weight sync trigger is not active.';
  end if;
end
$preflight$;

alter function public.save_my_current_weight(numeric) set "TimeZone" = 'Europe/Istanbul';
alter function public.sync_client_weight_to_measurements() set "TimeZone" = 'Europe/Istanbul';

do $verify$
begin
  if exists (
    select 1 from pg_proc
    where oid in ('public.save_my_current_weight(numeric)'::regprocedure,
                  'public.sync_client_weight_to_measurements()'::regprocedure)
      and not coalesce(proconfig @> array['TimeZone=Europe/Istanbul']::text[], false)
  ) then
    raise exception 'Mobile weight timezone configuration failed.';
  end if;
end
$verify$;

commit;
