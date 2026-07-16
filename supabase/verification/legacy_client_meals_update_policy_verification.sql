-- DietBridge staging-only, read-only verification for
-- 20260714010000_remove_legacy_client_meals_update_policy.sql.
-- Run the PRE snapshot before the migration and the POST snapshots after it.
-- No statement in this file changes data, policies, grants, or schema.

-- PRE: the exact legacy client UPDATE policy must appear with its full contract.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'meals'
  and policyname = 'Clients can update own meal completion';

-- PRE and POST: inventory all meals UPDATE/ALL policies. POST must retain only
-- the two reviewed dietitian UPDATE policies; no client-owned UPDATE path remains.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'meals'
  and cmd in ('UPDATE', 'ALL')
order by policyname;

-- PRE and POST: SELECT policies are preserved unchanged.
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'meals'
  and cmd in ('SELECT', 'ALL')
order by policyname;

-- PRE and POST: the completion RPC remains SECURITY DEFINER with its fixed
-- search_path and authenticated execute privilege.
select p.oid::regprocedure::text as signature,
       p.prosecdef as security_definer,
       p.proconfig as function_config,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'set_my_meal_completion'
  and pg_get_function_identity_arguments(p.oid) = 'p_meal_id uuid, p_is_eaten boolean';

-- PRE and POST: catalog-level routine execute grants for the RPC.
select routine_schema, routine_name, privilege_type, grantee
from information_schema.routine_privileges
where routine_schema = 'public'
  and routine_name = 'set_my_meal_completion'
order by grantee, privilege_type;

-- PRE and POST: RLS must remain enabled on public.meals.
select n.nspname as schema_name, c.relname as table_name, c.relrowsecurity as rls_enabled
from pg_class as c
join pg_namespace as n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname = 'meals';
