-- DietBridge production pre-policy reconciliation postflight.
-- READ ONLY: catalog checks only; the meal completion RPC is never invoked.

WITH
expected_functions(signature, expected_security_definer, expected_result, expected_body_md5, authenticated_execute) AS (
  VALUES
    ('public.handle_new_user()', true, 'trigger', '65164cc6aed446272beabf721d44bd93', false),
    ('public.protect_profile_system_fields()', false, 'trigger', 'd23346619753f0334ad8e518a6cf7628', false),
    ('public.save_my_current_weight(numeric)', true, 'jsonb', 'f7caf0c59ea4ea12d8b5558799564ada', true),
    ('public.set_profiles_updated_at()', false, 'trigger', '9b1889f56258bf9d6554213c05019c76', false),
    ('public.set_my_meal_completion(uuid,boolean)', true, 'boolean', '29ef449f3d82fbf463bbea6370eecf0f', true)
),
expected_policies(table_name, policy_name, command_code, using_required, check_required) AS (
  VALUES
    ('dietitian_profiles','Dietitians can select own profile','r',true,false),
    ('dietitian_profiles','Clients can select active dietitian profile','r',true,false),
    ('dietitian_profiles','Dietitians can create own pending profile','a',false,true),
    ('dietitian_profiles','Dietitians can update own non-system profile fields','w',true,true),
    ('appointments','Dietitians can select active client appointments','r',true,false),
    ('appointments','Clients can select own active appointments','r',true,false),
    ('appointments','Dietitians can create active client appointments','a',false,true),
    ('appointments','Dietitians can update active client appointments','w',true,true),
    ('appointments','Dietitians can delete active client appointments','d',true,false),
    ('chat_messages','Participants can select active relationship messages','r',true,false),
    ('chat_messages','Participants can send active relationship messages','a',false,true)
),
extra_policies(table_name, policy_name, command_code) AS (
  VALUES
    ('meal_plans','Users can select own meal plans','r'),
    ('meal_plans','Dietitians can view own meal plans','r'),
    ('meals','Users can select own meal rows','r'),
    ('meals','Dietitians can update own meal rows','w')
),
function_catalog AS (
  SELECT
    e.*,
    p.oid,
    p.proacl,
    p.proowner,
    p.prosecdef,
    pg_catalog.pg_get_function_result(p.oid) AS actual_result,
    r.rolname AS owner_name,
    pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10))) AS body_md5,
    pg_catalog.array_to_string(p.proconfig, ',') AS function_config
  FROM expected_functions AS e
  LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = to_regprocedure(e.signature)
  LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
),
policy_catalog AS (
  SELECT
    e.*,
    p.oid,
    p.polcmd,
    p.polpermissive,
    p.polroles,
    p.polqual IS NOT NULL AS using_present,
    p.polwithcheck IS NOT NULL AS check_present,
    ar.oid AS authenticated_oid
  FROM expected_policies AS e
  LEFT JOIN pg_catalog.pg_namespace AS n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS c
    ON c.relnamespace = n.oid
   AND c.relname = e.table_name
   AND c.relkind IN ('r','p')
  LEFT JOIN pg_catalog.pg_policy AS p
    ON p.polrelid = c.oid
   AND p.polname = e.policy_name
  LEFT JOIN pg_catalog.pg_roles AS ar ON ar.rolname = 'authenticated'
),
extra_policy_catalog AS (
  SELECT
    e.*,
    p.oid,
    p.polcmd,
    p.polroles,
    p.polqual IS NOT NULL AS using_present,
    ar.oid AS authenticated_oid
  FROM extra_policies AS e
  LEFT JOIN pg_catalog.pg_namespace AS n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS c
    ON c.relnamespace = n.oid
   AND c.relname = e.table_name
   AND c.relkind IN ('r','p')
  LEFT JOIN pg_catalog.pg_policy AS p
    ON p.polrelid = c.oid
   AND p.polname = e.policy_name
  LEFT JOIN pg_catalog.pg_roles AS ar ON ar.rolname = 'authenticated'
),
checks(sequence_no, check_group, check_id, object_name, status, is_match) AS (
  SELECT
    10,
    'FUNCTION',
    'FUNCTION_' || pg_catalog.upper(pg_catalog.replace(signature, 'public.', '')),
    signature,
    CASE
      WHEN oid IS NULL THEN 'MISSING'
      WHEN prosecdef <> expected_security_definer
        OR actual_result <> expected_result
        OR owner_name <> 'postgres'
        OR body_md5 <> expected_body_md5
        OR function_config <> 'search_path=pg_catalog, public'
        OR has_function_privilege('authenticated', oid, 'EXECUTE') <> authenticated_execute
        OR NOT has_function_privilege('service_role', oid, 'EXECUTE')
        OR has_function_privilege('anon', oid, 'EXECUTE')
        OR EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(coalesce(proacl, pg_catalog.acldefault('f', proowner))) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) THEN 'MISMATCH'
      ELSE 'MATCH'
    END,
    oid IS NOT NULL
      AND prosecdef = expected_security_definer
      AND actual_result = expected_result
      AND owner_name = 'postgres'
      AND body_md5 = expected_body_md5
      AND function_config = 'search_path=pg_catalog, public'
      AND has_function_privilege('authenticated', oid, 'EXECUTE') = authenticated_execute
      AND has_function_privilege('service_role', oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(coalesce(proacl, pg_catalog.acldefault('f', proowner))) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      )
  FROM function_catalog

  UNION ALL
  SELECT
    20,
    'CONSTRAINT',
    'VERIFICATION_CONSTRAINT',
    'public.dietitian_profiles.dietitian_profiles_verification_consistency_check',
    CASE
      WHEN con.oid IS NOT NULL
       AND con.contype = 'c'
       AND con.convalidated
       AND position('is_verified is not distinct from' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
       AND position('verification_status' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
       AND position('approved' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0 THEN 'MATCH'
      ELSE 'MISSING_OR_MISMATCH'
    END,
    con.oid IS NOT NULL
      AND con.contype = 'c'
      AND con.convalidated
      AND position('is_verified is not distinct from' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
      AND position('verification_status' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
      AND position('approved' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
  FROM (SELECT 1) AS seed
  LEFT JOIN pg_catalog.pg_constraint AS con
    ON con.conrelid = to_regclass('public.dietitian_profiles')
   AND con.conname = 'dietitian_profiles_verification_consistency_check'

  UNION ALL
  SELECT
    30,
    'RLS',
    'RLS_' || pg_catalog.upper(c.relname),
    'public.' || c.relname,
    CASE WHEN c.relrowsecurity THEN 'MATCH' ELSE 'MISMATCH' END,
    c.relrowsecurity
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('dietitian_profiles','appointments','chat_messages')

  UNION ALL
  SELECT
    40,
    'POLICY',
    'POLICY_' || pg_catalog.upper(pg_catalog.replace(policy_name, ' ', '_')),
    'public.' || table_name || '.' || policy_name,
    CASE
      WHEN oid IS NOT NULL
       AND polcmd = command_code
       AND polpermissive
       AND polroles = ARRAY[authenticated_oid]::oid[]
       AND using_present = using_required
       AND check_present = check_required THEN 'BASIC_MATCH'
      ELSE 'MISSING_OR_MISMATCH'
    END,
    oid IS NOT NULL
      AND polcmd = command_code
      AND polpermissive
      AND polroles = ARRAY[authenticated_oid]::oid[]
      AND using_present = using_required
      AND check_present = check_required
  FROM policy_catalog

  UNION ALL
  SELECT
    50,
    'LEGACY_POLICY',
    'LEGACY_POLICY',
    'public.meals.Clients can update own meal completion',
    CASE
      WHEN p.oid IS NOT NULL
       AND p.polcmd = 'w'
       AND p.polroles = ARRAY[ar.oid]::oid[]
       AND p.polqual IS NOT NULL
       AND p.polwithcheck IS NOT NULL THEN 'MATCH'
      ELSE 'MISSING_OR_MISMATCH'
    END,
    p.oid IS NOT NULL
      AND p.polcmd = 'w'
      AND p.polroles = ARRAY[ar.oid]::oid[]
      AND p.polqual IS NOT NULL
      AND p.polwithcheck IS NOT NULL
  FROM pg_catalog.pg_roles AS ar
  LEFT JOIN pg_catalog.pg_namespace AS n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS c ON c.relnamespace = n.oid AND c.relname = 'meals'
  LEFT JOIN pg_catalog.pg_policy AS p
    ON p.polrelid = c.oid
   AND p.polname = 'Clients can update own meal completion'
  WHERE ar.rolname = 'authenticated'

  UNION ALL
  SELECT
    60,
    'EXTRA_POLICY',
    'EXTRA_POLICY_' || pg_catalog.upper(pg_catalog.replace(policy_name, ' ', '_')),
    'public.' || table_name || '.' || policy_name,
    CASE
      WHEN oid IS NOT NULL
       AND polcmd = command_code
       AND polroles = ARRAY[authenticated_oid]::oid[]
       AND using_present THEN 'EXTRA_POLICY_MANUAL_REVIEW'
      ELSE 'MISSING_OR_MISMATCH'
    END,
    oid IS NOT NULL
      AND polcmd = command_code
      AND polroles = ARRAY[authenticated_oid]::oid[]
      AND using_present
  FROM extra_policy_catalog

  UNION ALL
  SELECT
    70,
    'HISTORY',
    'MIGRATION_HISTORY',
    'supabase_migrations.schema_migrations',
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'supabase_migrations')
       AND to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'UNCHANGED_MISSING'
      ELSE 'UNEXPECTED_PRESENT'
    END,
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'supabase_migrations')
      AND to_regclass('supabase_migrations.schema_migrations') IS NULL
),
gates(sequence_no, check_group, check_id, object_name, status, is_match) AS (
  SELECT * FROM checks

  UNION ALL
  SELECT
    900,
    'GATE',
    'RECONCILIATION_APPLIED_SUCCESSFULLY',
    'RECONCILIATION_APPLIED_SUCCESSFULLY',
    CASE WHEN pg_catalog.bool_and(is_match) THEN 'YES' ELSE 'NO' END,
    pg_catalog.bool_and(is_match)
  FROM checks

  UNION ALL
  SELECT
    901,
    'GATE',
    'RPC_READY_FOR_PRODUCTION_SMOKE_TEST',
    'RPC_READY_FOR_PRODUCTION_SMOKE_TEST',
    CASE WHEN pg_catalog.bool_and(is_match) THEN 'YES' ELSE 'NO' END,
    pg_catalog.bool_and(is_match)
  FROM checks
  WHERE check_group = 'FUNCTION'
    AND object_name = 'public.set_my_meal_completion(uuid,boolean)'

  UNION ALL
  SELECT
    902,
    'GATE',
    'LEGACY_POLICY_STILL_PRESENT',
    'LEGACY_POLICY_STILL_PRESENT',
    CASE WHEN pg_catalog.bool_and(is_match) THEN 'YES' ELSE 'NO' END,
    pg_catalog.bool_and(is_match)
  FROM checks
  WHERE check_group = 'LEGACY_POLICY'

  UNION ALL
  SELECT
    903,
    'GATE',
    'POLICY_REMOVAL_ALLOWED',
    'POLICY_REMOVAL_ALLOWED',
    'NO',
    false
)
SELECT check_id, object_name, status
FROM gates
ORDER BY sequence_no, check_id;
