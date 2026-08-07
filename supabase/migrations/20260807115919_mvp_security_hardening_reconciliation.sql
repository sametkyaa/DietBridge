-- MVP-2 forward-only reconciliation for production drift.
-- This migration intentionally leaves Auth configuration and pg_graphql installation untouched.

begin;

do $preflight$
declare
  v_table text;
  v_gate_tables constant text[] := array[
    'appointments',
    'chat_attachments',
    'chat_conversations',
    'chat_messages',
    'chat_read_states',
    'chat_upload_intents',
    'client_medical_conditions',
    'client_medications',
    'client_profiles',
    'daily_logs',
    'dietitian_clients',
    'meal_change_requests',
    'meal_plans',
    'meals',
    'measurements'
  ];
begin
  if to_regprocedure('public.current_user_role()') is null
     or to_regprocedure('public.is_current_user_dietitian()') is null
     or to_regprocedure('public.sync_client_weight_to_measurements()') is null
     or to_regprocedure('public.request_client_connection_by_email(text)') is null
     or to_regprocedure('public.chat_has_active_relationship(uuid,uuid)') is null
     or to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') is null then
    raise exception 'MVP-2 function precondition failed: an expected signature is missing.';
  end if;

  if to_regclass('public.profiles') is null
     or to_regclass('public.dietitian_profiles') is null
     or to_regclass('public.dietitian_clients') is null
     or to_regclass('public.daily_logs') is null then
    raise exception 'MVP-2 relation precondition failed: an authorization relation is missing.';
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dietitian_profiles'
      and column_name = 'verification_status'
      and data_type = 'text'
  )
  or not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'dietitian_profiles'
      and column_name = 'is_verified'
      and data_type = 'boolean'
  ) then
    raise exception 'MVP-2 approval precondition failed: canonical verification columns are missing.';
  end if;

  if to_regtype('public.client_status') is null
     or (
       select count(*)
       from pg_attribute as a
       where a.attrelid = 'public.dietitian_clients'::regclass
         and a.attnum > 0
         and not a.attisdropped
         and a.attnotnull
         and (
           (a.attname in ('dietitian_id', 'client_id') and a.atttypid = 'uuid'::regtype)
           or (a.attname = 'status' and a.atttypid = to_regtype('public.client_status'))
         )
     ) <> 3
     or not exists (
       select 1
       from pg_type as t
       join pg_namespace as n on n.oid = t.typnamespace
       join pg_enum as e on e.enumtypid = t.oid
       where n.nspname = 'public'
         and t.typname = 'client_status'
         and e.enumlabel = 'active'
     ) then
    raise exception 'MVP-2 relationship precondition failed: dietitian_clients UUID/status columns or active client_status value changed.';
  end if;

  if (
    select count(*)
    from pg_constraint as con
    where con.conrelid = 'public.dietitian_clients'::regclass
      and con.contype = 'f'
      and con.confrelid = 'public.profiles'::regclass
      and con.conkey in (
        array[(
          select a.attnum
          from pg_attribute as a
          where a.attrelid = 'public.dietitian_clients'::regclass
            and a.attname = 'dietitian_id'
            and not a.attisdropped
        )],
        array[(
          select a.attnum
          from pg_attribute as a
          where a.attrelid = 'public.dietitian_clients'::regclass
            and a.attname = 'client_id'
            and not a.attisdropped
        )]
      )
      and con.confkey = array[(
        select a.attnum
        from pg_attribute as a
        where a.attrelid = 'public.profiles'::regclass
          and a.attname = 'id'
          and not a.attisdropped
      )]
  ) <> 2 then
    raise exception 'MVP-2 relationship precondition failed: dietitian_clients foreign keys to profiles(id) changed.';
  end if;

  if not exists (
    select 1
    from pg_attribute as a
    where a.attrelid = 'public.daily_logs'::regclass
      and a.attname = 'client_id'
      and a.atttypid = 'uuid'::regtype
      and a.attnotnull
      and not a.attisdropped
  ) then
    raise exception 'MVP-2 daily_logs precondition failed: client_id UUID/NOT NULL contract changed.';
  end if;

  if (
    select count(*)
    from pg_type as t
    join pg_namespace as n on n.oid = t.typnamespace
    join pg_enum as e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'user_role'
  ) <> 2
  or not exists (
    select 1
    from pg_type as t
    join pg_namespace as n on n.oid = t.typnamespace
    join pg_enum as e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'user_role'
      and e.enumlabel = 'client'
  )
  or not exists (
    select 1
    from pg_type as t
    join pg_namespace as n on n.oid = t.typnamespace
    join pg_enum as e on e.enumtypid = t.oid
    where n.nspname = 'public'
      and t.typname = 'user_role'
      and e.enumlabel = 'dietitian'
  ) then
    raise exception 'MVP-2 role precondition failed: public.user_role must contain exactly client and dietitian.';
  end if;

  if exists (
    select 1
    from public.dietitian_profiles as dp
    where (dp.verification_status = 'approved' and dp.is_verified is not true)
       or (dp.is_verified is true and dp.verification_status is distinct from 'approved')
  ) then
    raise exception 'MVP-2 approval data precondition failed: verification_status and is_verified are inconsistent; run a separate reviewed remediation before this migration.';
  end if;

  if not exists (
    select 1
    from pg_proc as p
    where p.oid = 'public.is_current_user_dietitian()'::regprocedure
      and p.prosecdef
      and p.prorettype = 'boolean'::regtype
  )
  or not exists (
    select 1
    from pg_proc as p
    where p.oid = 'public.current_user_role()'::regprocedure
      and p.prokind = 'f'
      and p.prosecdef
      and p.provolatile = 's'
      and p.prorettype = 'public.user_role'::regtype
      and pg_get_userbyid(p.proowner) = 'postgres'
  )
  or not exists (
    select 1
    from pg_proc as p
    where p.oid = 'public.sync_client_weight_to_measurements()'::regprocedure
      and p.prosecdef
      and p.prorettype = 'trigger'::regtype
  ) then
    raise exception 'MVP-2 function precondition failed: expected SECURITY DEFINER/trigger contract changed.';
  end if;

  if not exists (
    select 1
    from pg_proc as p
    where p.oid = 'public.request_client_connection_by_email(text)'::regprocedure
      and pg_get_functiondef(p.oid) ~ 'is_current_user_dietitian'
  ) then
    raise exception 'MVP-2 RPC precondition failed: connection request no longer depends on the canonical helper.';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_logs'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and (
        (
          policyname = 'Users can view own daily logs'
          and cmd = 'SELECT'
          and lower(regexp_replace(replace(qual, '"', ''), '[[:space:]]+', '', 'g')) = '(auth.uid()=client_id)'
          and with_check is null
        )
        or (
          policyname = 'Users can insert own daily logs'
          and cmd = 'INSERT'
          and qual is null
          and lower(regexp_replace(replace(with_check, '"', ''), '[[:space:]]+', '', 'g')) = '(auth.uid()=client_id)'
        )
        or (
          policyname = 'Users can update own daily logs'
          and cmd = 'UPDATE'
          and lower(regexp_replace(replace(qual, '"', ''), '[[:space:]]+', '', 'g')) = '(auth.uid()=client_id)'
          and lower(regexp_replace(replace(with_check, '"', ''), '[[:space:]]+', '', 'g')) = '(auth.uid()=client_id)'
        )
      )
  ) <> 3 then
    raise exception 'MVP-2 policy precondition failed: canonical client-own daily_logs policy semantics changed.';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_logs'
      and permissive = 'PERMISSIVE'
      and roles && array['public', 'anon', 'authenticated']::name[]
      and policyname not in (
        'Users can view own daily logs',
        'Users can insert own daily logs',
        'Users can update own daily logs'
      )
  ) then
    raise exception 'MVP-2 policy precondition failed: an unexpected user-facing permissive daily_logs policy requires separate reconciliation.';
  end if;

  foreach v_table in array v_gate_tables loop
    if to_regclass(format('public.%I', v_table)) is null then
      raise exception 'MVP-2 policy precondition failed: public.% is missing.', v_table;
    end if;

    if not exists (
      select 1
      from pg_class as c
      join pg_namespace as n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relname = v_table
        and c.relrowsecurity
    ) then
      raise exception 'MVP-2 policy precondition failed: RLS is not enabled on public.%.', v_table;
    end if;

    if exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and policyname = 'Approved dietitian authorization gate'
    ) then
      raise exception 'MVP-2 policy precondition failed: authorization gate already exists on public.%.', v_table;
    end if;
  end loop;

end
$preflight$;

-- Canonical caller-role lookup from the production baseline. No profile yields NULL.
create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select role
  from public.profiles
  where id = auth.uid()
$function$;

-- Canonical approved-dietitian authorization. auth.uid() null and missing rows fail closed.
create or replace function public.is_current_user_dietitian()
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.profiles as p
    join public.dietitian_profiles as dp on dp.user_id = p.id
    where p.id = (select auth.uid())
      and p.role = 'dietitian'::public.user_role
      and dp.verification_status = 'approved'
      and dp.is_verified is true
  );
$function$;

alter function public.sync_client_weight_to_measurements() set search_path = pg_catalog, public;

revoke all on function public.current_user_role() from public, anon, authenticated;
grant execute on function public.current_user_role() to authenticated, service_role;

revoke all on function public.is_current_user_dietitian() from public, anon, authenticated;
grant execute on function public.is_current_user_dietitian() to authenticated, service_role;

revoke all on function public.sync_client_weight_to_measurements() from public, anon, authenticated;
grant execute on function public.sync_client_weight_to_measurements() to service_role;

-- Chat RPCs already depend on this helper. Add approval only on the dietitian side;
-- the linked client keeps active-relationship access.
create or replace function public.chat_has_active_relationship(
  p_dietitian_id uuid,
  p_client_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $function$
  select exists (
    select 1
    from public.dietitian_clients as dc
    where dc.dietitian_id = p_dietitian_id
      and dc.client_id = p_client_id
      and dc.status = 'active'::public.client_status
      and (
        (select auth.uid()) = dc.client_id
        or (
          (select auth.uid()) = dc.dietitian_id
          and (select public.is_current_user_dietitian())
        )
      )
  );
$function$;

revoke all on function public.chat_has_active_relationship(uuid, uuid) from public, anon, authenticated;
grant execute on function public.chat_has_active_relationship(uuid, uuid) to authenticated, service_role;

-- Existing policies are permissive. The restrictive gate explicitly allows only
-- client accounts or approved dietitians; NULL and future roles fail closed.
do $policies$
declare
  v_table text;
begin
  foreach v_table in array array[
    'appointments',
    'chat_attachments',
    'chat_conversations',
    'chat_messages',
    'chat_read_states',
    'chat_upload_intents',
    'client_medical_conditions',
    'client_medications',
    'client_profiles',
    'daily_logs',
    'dietitian_clients',
    'meal_change_requests',
    'meal_plans',
    'meals',
    'measurements'
  ] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.current_user_role() = %L::public.user_role or public.is_current_user_dietitian()) with check (public.current_user_role() = %L::public.user_role or public.is_current_user_dietitian())',
      'Approved dietitian authorization gate',
      v_table,
      'client',
      'client'
    );
  end loop;
end
$policies$;

create policy "Approved dietitians can view active client daily logs"
on public.daily_logs
for select
to authenticated
using (
  (select public.is_current_user_dietitian())
  and exists (
    select 1
    from public.dietitian_clients as dc
    where dc.dietitian_id = (select auth.uid())
      and dc.client_id = daily_logs.client_id
      and dc.status = 'active'::public.client_status
  )
);

-- No Web/Mobile pre-auth caller was found for these production-exposed tables.
-- Keep existing authenticated/service_role grants; remove only the anonymous role.
revoke all privileges on table
  public.activity_levels,
  public.alcohol_statuses,
  public.appointments,
  public.blood_types,
  public.body_measurements,
  public.client_goals,
  public.client_medical_conditions,
  public.client_medications,
  public.client_profiles,
  public.daily_logs,
  public.dietitian_clients,
  public.dietitian_profiles,
  public.meal_change_requests,
  public.meal_plans,
  public.meals,
  public.measurements,
  public.medical_conditions,
  public.medications_catalog,
  public.nutrition_types,
  public.profiles
from anon;

-- Future objects in the application schema are anonymous-deny by default.
-- Authenticated/service_role defaults remain unchanged to avoid breaking app flows.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon;

-- Disable only the unused GraphQL entrypoint for application roles. Do not drop pg_graphql.
revoke execute on function graphql_public.graphql(text, text, jsonb, jsonb)
from public, anon, authenticated;
grant execute on function graphql_public.graphql(text, text, jsonb, jsonb) to service_role;

do $postflight$
declare
  v_table text;
  v_qual text;
  v_check text;
  v_gate_tables constant text[] := array[
    'appointments',
    'chat_attachments',
    'chat_conversations',
    'chat_messages',
    'chat_read_states',
    'chat_upload_intents',
    'client_medical_conditions',
    'client_medications',
    'client_profiles',
    'daily_logs',
    'dietitian_clients',
    'meal_change_requests',
    'meal_plans',
    'meals',
    'measurements'
  ];
  v_anon_tables constant text[] := array[
    'activity_levels', 'alcohol_statuses', 'appointments', 'blood_types',
    'body_measurements', 'client_goals', 'client_medical_conditions',
    'client_medications', 'client_profiles', 'daily_logs', 'dietitian_clients',
    'dietitian_profiles', 'meal_change_requests', 'meal_plans', 'meals',
    'measurements', 'medical_conditions', 'medications_catalog',
    'nutrition_types', 'profiles'
  ];
begin
  if not exists (
    select 1
    from pg_proc as p
    where p.oid = 'public.current_user_role()'::regprocedure
      and p.prokind = 'f'
      and p.prorettype = 'public.user_role'::regtype
      and p.provolatile = 's'
      and p.prosecdef
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig @> array['search_path=pg_catalog, public']::text[]
      and lower(regexp_replace(p.prosrc, '[[:space:];]+', '', 'g')) =
        'selectrolefrompublic.profileswhereid=auth.uid()'
  ) then
    raise exception 'MVP-2 postcondition failed: current_user_role is not canonical.';
  end if;

  if not exists (
    select 1
    from pg_proc as p
    where p.oid = 'public.is_current_user_dietitian()'::regprocedure
      and p.prokind = 'f'
      and p.prorettype = 'boolean'::regtype
      and p.provolatile = 's'
      and p.prosecdef
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig @> array['search_path=pg_catalog, public']::text[]
      and lower(regexp_replace(p.prosrc, '[[:space:];]+', '', 'g')) =
        'selectexists(select1frompublic.profilesaspjoinpublic.dietitian_profilesasdpondp.user_id=p.idwherep.id=(selectauth.uid())andp.role=''dietitian''::public.user_roleanddp.verification_status=''approved''anddp.is_verifiedistrue)'
  ) then
    raise exception 'MVP-2 postcondition failed: approval helper is not canonical.';
  end if;

  if not exists (
    select 1
    from pg_proc as p
    where p.oid = 'public.chat_has_active_relationship(uuid,uuid)'::regprocedure
      and p.prokind = 'f'
      and p.prorettype = 'boolean'::regtype
      and p.provolatile = 's'
      and p.prosecdef
      and pg_get_userbyid(p.proowner) = 'postgres'
      and p.proconfig @> array['search_path=pg_catalog, public']::text[]
      and lower(regexp_replace(p.prosrc, '[[:space:];]+', '', 'g')) =
        'selectexists(select1frompublic.dietitian_clientsasdcwheredc.dietitian_id=p_dietitian_idanddc.client_id=p_client_idanddc.status=''active''::public.client_statusand((selectauth.uid())=dc.client_idor((selectauth.uid())=dc.dietitian_idand(selectpublic.is_current_user_dietitian()))))'
  ) then
    raise exception 'MVP-2 postcondition failed: chat active-relationship helper is not canonical.';
  end if;

  if has_function_privilege('anon', 'public.current_user_role()', 'EXECUTE')
     or has_function_privilege('anon', 'public.is_current_user_dietitian()', 'EXECUTE')
     or has_function_privilege('anon', 'public.sync_client_weight_to_measurements()', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.sync_client_weight_to_measurements()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.current_user_role()', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.is_current_user_dietitian()', 'EXECUTE')
     or has_function_privilege('anon', 'public.chat_has_active_relationship(uuid,uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.chat_has_active_relationship(uuid,uuid)', 'EXECUTE') then
    raise exception 'MVP-2 postcondition failed: function ACL matrix is inconsistent.';
  end if;

  foreach v_table in array v_gate_tables loop
    if (
      select count(*)
      from pg_policies
      where schemaname = 'public'
        and tablename = v_table
        and policyname = 'Approved dietitian authorization gate'
        and permissive = 'RESTRICTIVE'
        and cmd = 'ALL'
        and roles = array['authenticated']::name[]
    ) <> 1 then
      raise exception 'MVP-2 postcondition failed: authorization gate structure on public.% changed.', v_table;
    end if;

    select
      lower(regexp_replace(replace(replace(qual, '"', ''), 'public.', ''), '[[:space:]]+', '', 'g')),
      lower(regexp_replace(replace(replace(with_check, '"', ''), 'public.', ''), '[[:space:]]+', '', 'g'))
      into v_qual, v_check
    from pg_policies
    where schemaname = 'public'
      and tablename = v_table
      and policyname = 'Approved dietitian authorization gate';

    if v_qual is distinct from v_check
       or v_qual !~ '^\(*current_user_role\(\)=''client''::user_role\)*or\(*is_current_user_dietitian\(\)\)*$' then
      raise exception 'MVP-2 postcondition failed: authorization gate expression on public.% is not exactly client OR approved dietitian.', v_table;
    end if;
  end loop;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_logs'
      and policyname = 'Approved dietitians can view active client daily logs'
      and permissive = 'PERMISSIVE'
      and cmd = 'SELECT'
      and roles = array['authenticated']::name[]
  ) <> 1 then
    raise exception 'MVP-2 postcondition failed: daily_logs dietitian policy structure is not canonical.';
  end if;

  select lower(
    regexp_replace(
      replace(replace(qual, '"', ''), 'public.', ''),
      '[[:space:]]+',
      '',
      'g'
    )
  )
    into v_qual
  from pg_policies
  where schemaname = 'public'
    and tablename = 'daily_logs'
    and policyname = 'Approved dietitians can view active client daily logs';

  if position('is_current_user_dietitian()' in v_qual) = 0
     or v_qual !~ 'exists\(select1fromdietitian_clients(as)?dcwhere'
     or v_qual !~ 'dc\.dietitian_id=\(selectauth\.uid\(\)(asuid)?\)'
     or position('dc.client_id=daily_logs.client_id' in v_qual) = 0
     or position('dc.status=''active''::client_status' in v_qual) = 0
     or v_qual ~ '(^|[^a-z])or([^a-z]|$)'
     or v_qual ~ '(^|[^a-z])true([^a-z]|$)' then
    raise exception 'MVP-2 postcondition failed: daily_logs dietitian SELECT predicate is not canonical.';
  end if;

  if (
    select count(*)
    from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_logs'
      and permissive = 'PERMISSIVE'
      and roles = array['authenticated']::name[]
      and (
        (
          policyname = 'Users can view own daily logs'
          and cmd = 'SELECT'
          and lower(regexp_replace(replace(qual, '"', ''), '[[:space:]]+', '', 'g')) = '(auth.uid()=client_id)'
          and with_check is null
        )
        or (
          policyname = 'Users can insert own daily logs'
          and cmd = 'INSERT'
          and qual is null
          and lower(regexp_replace(replace(with_check, '"', ''), '[[:space:]]+', '', 'g')) = '(auth.uid()=client_id)'
        )
        or (
          policyname = 'Users can update own daily logs'
          and cmd = 'UPDATE'
          and lower(regexp_replace(replace(qual, '"', ''), '[[:space:]]+', '', 'g')) = '(auth.uid()=client_id)'
          and lower(regexp_replace(replace(with_check, '"', ''), '[[:space:]]+', '', 'g')) = '(auth.uid()=client_id)'
        )
      )
  ) <> 3 then
    raise exception 'MVP-2 postcondition failed: client-own daily_logs policies were not preserved.';
  end if;

  if exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'daily_logs'
      and permissive = 'PERMISSIVE'
      and roles && array['public', 'anon', 'authenticated']::name[]
      and policyname not in (
        'Users can view own daily logs',
        'Users can insert own daily logs',
        'Users can update own daily logs',
        'Approved dietitians can view active client daily logs'
      )
  ) then
    raise exception 'MVP-2 postcondition failed: an unexpected user-facing permissive daily_logs policy exists.';
  end if;

  foreach v_table in array v_anon_tables loop
    if has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
       or has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
       or has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
       or has_table_privilege('anon', format('public.%I', v_table), 'DELETE')
       or has_table_privilege('anon', format('public.%I', v_table), 'TRUNCATE')
       or has_table_privilege('anon', format('public.%I', v_table), 'REFERENCES')
       or has_table_privilege('anon', format('public.%I', v_table), 'TRIGGER') then
      raise exception 'MVP-2 postcondition failed: anon still has public.% privileges.', v_table;
    end if;

    if not has_table_privilege('authenticated', format('public.%I', v_table), 'SELECT') then
      raise exception 'MVP-2 postcondition failed: authenticated SELECT was not preserved on public.%.', v_table;
    end if;
  end loop;

  if exists (
    select 1
    from pg_default_acl as defaults
    join pg_roles as owner_role on owner_role.oid = defaults.defaclrole
    join pg_namespace as namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) as privilege
    join pg_roles as grantee_role on grantee_role.oid = privilege.grantee
    where owner_role.rolname = 'postgres'
      and namespace.nspname = 'public'
      and defaults.defaclobjtype in ('r', 'S')
      and grantee_role.rolname = 'anon'
  ) then
    raise exception 'MVP-2 postcondition failed: postgres public table/sequence defaults still grant anon privileges.';
  end if;

  if not exists (
    select 1
    from pg_default_acl as defaults
    join pg_roles as owner_role on owner_role.oid = defaults.defaclrole
    join pg_namespace as namespace on namespace.oid = defaults.defaclnamespace
    where owner_role.rolname = 'postgres'
      and namespace.nspname = 'public'
      and defaults.defaclobjtype = 'f'
  )
  or exists (
    select 1
    from pg_default_acl as defaults
    join pg_roles as owner_role on owner_role.oid = defaults.defaclrole
    join pg_namespace as namespace on namespace.oid = defaults.defaclnamespace
    cross join lateral aclexplode(defaults.defaclacl) as privilege
    left join pg_roles as grantee_role on grantee_role.oid = privilege.grantee
    where owner_role.rolname = 'postgres'
      and namespace.nspname = 'public'
      and defaults.defaclobjtype = 'f'
      and privilege.privilege_type = 'EXECUTE'
      and (privilege.grantee = 0 or grantee_role.rolname = 'anon')
  ) then
    raise exception 'MVP-2 postcondition failed: postgres public function defaults still grant PUBLIC/anon execute.';
  end if;

  if has_function_privilege('anon', 'graphql_public.graphql(text,text,jsonb,jsonb)', 'EXECUTE')
     or has_function_privilege('authenticated', 'graphql_public.graphql(text,text,jsonb,jsonb)', 'EXECUTE')
     or not has_function_privilege('service_role', 'graphql_public.graphql(text,text,jsonb,jsonb)', 'EXECUTE') then
    raise exception 'MVP-2 postcondition failed: GraphQL entrypoint ACL is inconsistent.';
  end if;
end
$postflight$;

commit;
