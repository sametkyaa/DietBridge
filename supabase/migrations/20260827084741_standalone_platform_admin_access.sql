-- MVP-13 standalone Product Admin authorization.
-- This migration changes only the existing Admin entitlement helper.
-- Product roles, verification state, Product RLS, and the historical Admin
-- schema remain independent and immutable.

begin;

do $preflight$
begin
  if to_regclass('public.platform_admins') is null
     or to_regclass('public.dietitian_verification_audit') is null
     or to_regprocedure('private.calculate_dietitian_application_completeness(uuid)') is null
     or to_regprocedure('public.is_current_user_platform_admin()') is null
     or to_regprocedure('public.admin_get_verification_summary()') is null
     or to_regprocedure('public.admin_list_dietitian_applications(text,text,integer,integer)') is null
     or to_regprocedure('public.admin_get_dietitian_application(uuid)') is null
     or to_regprocedure('public.admin_get_dietitian_verification_history(uuid)') is null
     or to_regprocedure('public.admin_approve_dietitian(uuid)') is null
     or to_regprocedure('public.admin_reject_dietitian(uuid,text)') is null then
    raise exception 'Standalone Product Admin prerequisites are missing.';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'storage'
      and tablename = 'objects'
      and policyname = 'Platform admins can view dietitian diplomas'
      and cmd = 'SELECT'
  ) then
    raise exception 'Standalone Product Admin diploma Storage policy is missing.';
  end if;
end
$preflight$;

create or replace function public.is_current_user_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.platform_admins as entitlement
    where (select auth.uid()) is not null
      and entitlement.user_id = (select auth.uid())
      and entitlement.revoked_at is null
  );
$function$;

alter function public.is_current_user_platform_admin() owner to postgres;
revoke all on function public.is_current_user_platform_admin() from public, anon, authenticated, service_role;
grant execute on function public.is_current_user_platform_admin() to authenticated;

commit;
