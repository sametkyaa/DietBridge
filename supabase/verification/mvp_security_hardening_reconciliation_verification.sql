-- MVP-2 read-only postflight verification.
-- Run only after the reconciliation migration has been applied to the selected environment.

with expected_anon_tables(table_name) as (
  values
    ('activity_levels'), ('alcohol_statuses'), ('appointments'), ('blood_types'),
    ('body_measurements'), ('client_goals'), ('client_medical_conditions'),
    ('client_medications'), ('client_profiles'), ('daily_logs'),
    ('dietitian_clients'), ('dietitian_profiles'), ('meal_change_requests'),
    ('meal_plans'), ('meals'), ('measurements'), ('medical_conditions'),
    ('medications_catalog'), ('nutrition_types'), ('profiles')
),
expected_gate_tables(table_name) as (
  values
    ('appointments'), ('chat_attachments'), ('chat_conversations'),
    ('chat_messages'), ('chat_read_states'), ('chat_upload_intents'),
    ('client_medical_conditions'), ('client_medications'), ('client_profiles'),
    ('daily_logs'), ('dietitian_clients'), ('meal_change_requests'),
    ('meal_plans'), ('meals'), ('measurements')
),
checks as (
  select
    'FUNCTION-01 approval helper definition'::text as check_name,
    exists (
      select 1
      from pg_proc as p
      where p.oid = to_regprocedure('public.is_current_user_dietitian()')
        and p.prokind = 'f'
        and p.prorettype = 'boolean'::regtype
        and p.prosecdef
        and p.provolatile = 's'
        and pg_get_userbyid(p.proowner) = 'postgres'
        and p.proconfig @> array['search_path=pg_catalog, public']::text[]
        and lower(regexp_replace(p.prosrc, '[[:space:];]+', '', 'g')) =
          'selectexists(select1frompublic.profilesaspjoinpublic.dietitian_profilesasdpondp.user_id=p.idwherep.id=(selectauth.uid())andp.role=''dietitian''::public.user_roleanddp.verification_status=''approved''anddp.is_verifiedistrue)'
    ) as passed,
    'canonical caller/profile/role/approval EXISTS body and function metadata'::text as expected

  union all
  select
    'DATA-01 approval field consistency',
    not exists (
      select 1
      from public.dietitian_profiles as dp
      where (dp.verification_status = 'approved' and dp.is_verified is not true)
         or (dp.is_verified is true and dp.verification_status is distinct from 'approved')
    ),
    'approved iff is_verified is true; inconsistent rows require separate remediation'

  union all
  select
    'ROLE-01 explicit user role contract',
    2 = (
      select count(*)
      from pg_type as t
      join pg_namespace as n on n.oid = t.typnamespace
      join pg_enum as e on e.enumtypid = t.oid
      where n.nspname = 'public'
        and t.typname = 'user_role'
        and e.enumlabel in ('client', 'dietitian')
    )
    and 2 = (
      select count(*)
      from pg_type as t
      join pg_namespace as n on n.oid = t.typnamespace
      join pg_enum as e on e.enumtypid = t.oid
      where n.nspname = 'public'
        and t.typname = 'user_role'
    ),
    'public.user_role contains exactly client and dietitian'

  union all
  select
    'RELATIONSHIP-01 dietitian_clients schema contract',
    to_regtype('public.client_status') is not null
      and 3 = (
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
      )
      and exists (
        select 1
        from pg_type as t
        join pg_namespace as n on n.oid = t.typnamespace
        join pg_enum as e on e.enumtypid = t.oid
        where n.nspname = 'public'
          and t.typname = 'client_status'
          and e.enumlabel = 'active'
      )
      and 2 = (
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
      ),
    'UUID/NOT NULL participant FKs to profiles(id), client_status with active'

  union all
  select
    'RELATIONSHIP-02 daily_logs client key contract',
    exists (
      select 1
      from pg_attribute as a
      where a.attrelid = 'public.daily_logs'::regclass
        and a.attname = 'client_id'
        and a.atttypid = 'uuid'::regtype
        and a.attnotnull
        and not a.attisdropped
    ),
    'daily_logs.client_id is UUID and NOT NULL'

  union all
  select
    'FUNCTION-02 approval helper ACL',
    not has_function_privilege('anon', 'public.is_current_user_dietitian()', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.is_current_user_dietitian()', 'EXECUTE'),
    'anon/PUBLIC denied through effective ACL; authenticated preserved'

  union all
  select
    'FUNCTION-03 current role definition',
    exists (
      select 1
      from pg_proc as p
      where p.oid = to_regprocedure('public.current_user_role()')
        and p.prokind = 'f'
        and p.prorettype = 'public.user_role'::regtype
        and p.provolatile = 's'
        and p.prosecdef
        and pg_get_userbyid(p.proowner) = 'postgres'
        and p.proconfig @> array['search_path=pg_catalog, public']::text[]
        and lower(regexp_replace(p.prosrc, '[[:space:];]+', '', 'g')) =
          'selectrolefrompublic.profileswhereid=auth.uid()'
    ),
    'canonical caller-only profiles.role lookup and function metadata'

  union all
  select
    'FUNCTION-04 current role ACL',
    not has_function_privilege('anon', 'public.current_user_role()', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.current_user_role()', 'EXECUTE'),
    'anon/PUBLIC denied; authenticated retained only for restrictive RLS gates'

  union all
  select
    'FUNCTION-05 weight trigger direct ACL',
    not has_function_privilege('anon', 'public.sync_client_weight_to_measurements()', 'EXECUTE')
      and not has_function_privilege('authenticated', 'public.sync_client_weight_to_measurements()', 'EXECUTE')
      and exists (
        select 1
        from pg_proc as p
        where p.oid = to_regprocedure('public.sync_client_weight_to_measurements()')
          and p.prosecdef
          and p.prorettype = 'trigger'::regtype
          and p.proconfig @> array['search_path=pg_catalog, public']::text[]
      ),
    'direct app-role execution denied; trigger function contract preserved'

  union all
  select
    'FUNCTION-06 connection RPC dependency',
    exists (
      select 1
      from pg_proc as p
      where p.oid = to_regprocedure('public.request_client_connection_by_email(text)')
        and pg_get_functiondef(p.oid) ~ 'is_current_user_dietitian'
    ),
    'existing RPC still delegates approval to the canonical helper'

  union all
  select
    'FUNCTION-07 chat authorization helper',
    exists (
      select 1
      from pg_proc as p
      where p.oid = to_regprocedure('public.chat_has_active_relationship(uuid,uuid)')
        and p.prosecdef
        and p.prokind = 'f'
        and p.prorettype = 'boolean'::regtype
        and p.provolatile = 's'
        and pg_get_userbyid(p.proowner) = 'postgres'
        and p.proconfig @> array['search_path=pg_catalog, public']::text[]
        and lower(regexp_replace(p.prosrc, '[[:space:];]+', '', 'g')) =
          'selectexists(select1frompublic.dietitian_clientsasdcwheredc.dietitian_id=p_dietitian_idanddc.client_id=p_client_idanddc.status=''active''::public.client_statusand((selectauth.uid())=dc.client_idor((selectauth.uid())=dc.dietitian_idand(selectpublic.is_current_user_dietitian()))))'
    )
      and not has_function_privilege('anon', 'public.chat_has_active_relationship(uuid,uuid)', 'EXECUTE')
      and has_function_privilege('authenticated', 'public.chat_has_active_relationship(uuid,uuid)', 'EXECUTE'),
    'active client accepted; dietitian branch additionally approval-aware'

  union all
  select
    'RLS-01 restrictive approval gate coverage',
    not exists (
      select 1
      from expected_gate_tables as expected
      where 1 <> (
        select count(*)
        from pg_policies as policy
        where policy.schemaname = 'public'
          and policy.tablename = expected.table_name
          and policy.policyname = 'Approved dietitian authorization gate'
          and policy.permissive = 'RESTRICTIVE'
          and policy.cmd = 'ALL'
          and policy.roles = array['authenticated']::name[]
          and lower(regexp_replace(replace(replace(policy.qual, '"', ''), 'public.', ''), '[[:space:]]+', '', 'g')) =
              lower(regexp_replace(replace(replace(policy.with_check, '"', ''), 'public.', ''), '[[:space:]]+', '', 'g'))
          and lower(regexp_replace(replace(replace(policy.qual, '"', ''), 'public.', ''), '[[:space:]]+', '', 'g'))
              ~ '^\(*current_user_role\(\)=''client''::user_role\)*or\(*is_current_user_dietitian\(\)\)*$'
      )
    ),
    'each of 15 tables has exactly one authenticated RESTRICTIVE ALL gate: role = client OR approved dietitian; no negative allow'

  union all
  select
    'DAILY-01 policy identity and command',
    1 = (
      select count(*)
      from pg_policies
      where schemaname = 'public'
        and tablename = 'daily_logs'
        and policyname = 'Approved dietitians can view active client daily logs'
        and permissive = 'PERMISSIVE'
        and cmd = 'SELECT'
        and roles = array['authenticated']::name[]
    ),
    'one authenticated SELECT policy only'

  union all
  select
    'DAILY-02 policy predicate',
    exists (
      select 1
      from (
        select lower(
          regexp_replace(
            replace(replace(qual, '"', ''), 'public.', ''),
            '[[:space:]]+',
            '',
            'g'
          )
        ) as normalized_qual
        from pg_policies
        where schemaname = 'public'
          and tablename = 'daily_logs'
          and policyname = 'Approved dietitians can view active client daily logs'
      ) as policy
      where position('is_current_user_dietitian()' in policy.normalized_qual) > 0
        and policy.normalized_qual ~ 'exists\(select1fromdietitian_clients(as)?dcwhere'
        and policy.normalized_qual ~ 'dc\.dietitian_id=\(selectauth\.uid\(\)(asuid)?\)'
        and position('dc.client_id=daily_logs.client_id' in policy.normalized_qual) > 0
        and position('dc.status=''active''::client_status' in policy.normalized_qual) > 0
        and policy.normalized_qual !~ '(^|[^a-z])or([^a-z]|$)'
        and policy.normalized_qual !~ '(^|[^a-z])true([^a-z]|$)'
    ),
    'approved helper + caller dietitian + row client + active relationship'

  union all
  select
    'DAILY-03 client-own policies preserved',
    3 = (
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
    ),
    'canonical authenticated client-own SELECT/INSERT/UPDATE semantics remain'

  union all
  select
    'DAILY-04 no unexpected user-facing permissive policy',
    not exists (
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
    ),
    'no hidden user-facing permissive daily_logs access path exists'

  union all
  select
    'GRANT-01 explicit anon table deny matrix',
    not exists (
      select 1
      from expected_anon_tables as expected
      where has_table_privilege('anon', format('public.%I', expected.table_name), 'SELECT')
         or has_table_privilege('anon', format('public.%I', expected.table_name), 'INSERT')
         or has_table_privilege('anon', format('public.%I', expected.table_name), 'UPDATE')
         or has_table_privilege('anon', format('public.%I', expected.table_name), 'DELETE')
         or has_table_privilege('anon', format('public.%I', expected.table_name), 'TRUNCATE')
         or has_table_privilege('anon', format('public.%I', expected.table_name), 'REFERENCES')
         or has_table_privilege('anon', format('public.%I', expected.table_name), 'TRIGGER')
    ),
    'no effective anon privilege on the explicit 20-table matrix'

  union all
  select
    'GRANT-02 authenticated reads preserved',
    not exists (
      select 1
      from expected_anon_tables as expected
      where not has_table_privilege('authenticated', format('public.%I', expected.table_name), 'SELECT')
    ),
    'authenticated SELECT remains on all 20 tables; RLS remains the row boundary'

  union all
  select
    'GRAPHQL-01 application entrypoint deny',
    to_regprocedure('graphql_public.graphql(text,text,jsonb,jsonb)') is not null
      and not has_function_privilege('anon', 'graphql_public.graphql(text,text,jsonb,jsonb)', 'EXECUTE')
      and not has_function_privilege('authenticated', 'graphql_public.graphql(text,text,jsonb,jsonb)', 'EXECUTE')
      and has_function_privilege('service_role', 'graphql_public.graphql(text,text,jsonb,jsonb)', 'EXECUTE'),
    'anon/authenticated/PUBLIC denied; service_role preserved; extension retained'

  union all
  select
    'DEFAULT-01 future anon table/sequence deny',
    not exists (
      select 1
      from pg_default_acl as defaults
      join pg_roles as owner_role on owner_role.oid = defaults.defaclrole
      join pg_namespace as namespace on namespace.oid = defaults.defaclnamespace
      cross join lateral aclexplode(defaults.defaclacl) as privilege
      left join pg_roles as grantee_role on grantee_role.oid = privilege.grantee
      where owner_role.rolname = 'postgres'
        and namespace.nspname = 'public'
        and defaults.defaclobjtype in ('r', 'S')
        and grantee_role.rolname = 'anon'
    ),
    'postgres-owned future public tables and sequences do not default-grant anon'

  union all
  select
    'DEFAULT-02 future function execute deny',
    exists (
      select 1
      from pg_default_acl as defaults
      join pg_roles as owner_role on owner_role.oid = defaults.defaclrole
      join pg_namespace as namespace on namespace.oid = defaults.defaclnamespace
      where owner_role.rolname = 'postgres'
        and namespace.nspname = 'public'
        and defaults.defaclobjtype = 'f'
    )
    and not exists (
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
    ),
    'postgres-owned future public functions are not executable by PUBLIC/anon by default'
)
select check_name, passed, expected
from checks
order by check_name;

-- The result set is acceptable only when every row above reports passed = true.
