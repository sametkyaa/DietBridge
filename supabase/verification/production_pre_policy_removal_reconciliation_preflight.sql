-- DietBridge production pre-policy reconciliation preflight.
-- READ ONLY: this file performs catalog and aggregate checks only.
-- It intentionally returns no application rows, identifiers, function bodies or secrets.

WITH
required_tables(table_name) AS (
  VALUES
    ('profiles'),
    ('dietitian_profiles'),
    ('appointments'),
    ('chat_messages'),
    ('meals'),
    ('meal_plans')
),
required_functions(signature, expected_security_definer, expected_result, canonical_body_md5, allowed_body_md5s, allowed_preflight_paths) AS (
  VALUES
    ('public.handle_new_user()', true, 'trigger', '65164cc6aed446272beabf721d44bd93', ARRAY['e3cafd1cb6ee0f6fb78542d22b8984ba','65164cc6aed446272beabf721d44bd93']::text[], ARRAY['search_path=public, pg_temp','search_path=pg_catalog, public']::text[]),
    ('public.protect_profile_system_fields()', false, 'trigger', 'd23346619753f0334ad8e518a6cf7628', ARRAY['d23346619753f0334ad8e518a6cf7628']::text[], ARRAY['search_path=public','search_path=pg_catalog, public']::text[]),
    ('public.save_my_current_weight(numeric)', true, 'jsonb', 'f7caf0c59ea4ea12d8b5558799564ada', ARRAY['f7caf0c59ea4ea12d8b5558799564ada']::text[], ARRAY['search_path=public, pg_temp','search_path=pg_catalog, public']::text[]),
    ('public.set_profiles_updated_at()', false, 'trigger', '9b1889f56258bf9d6554213c05019c76', ARRAY['9b1889f56258bf9d6554213c05019c76']::text[], ARRAY['search_path=public','search_path=pg_catalog, public']::text[])
),
required_triggers(schema_name, table_name, trigger_name, function_signature) AS (
  VALUES
    ('auth','users','on_auth_user_created','public.handle_new_user()'),
    ('public','profiles','trg_profiles_updated_at','public.set_profiles_updated_at()'),
    ('public','profiles','trg_protect_profile_system_fields','public.protect_profile_system_fields()')
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
    rf.*,
    p.oid,
    p.prosecdef,
    pg_catalog.pg_get_function_result(p.oid) AS actual_result,
    r.rolname AS owner_name,
    pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10))) AS body_md5,
    pg_catalog.array_to_string(p.proconfig, ',') AS function_config
  FROM required_functions AS rf
  LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = to_regprocedure(rf.signature)
  LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
),
trigger_catalog AS (
  SELECT
    rt.*,
    t.oid,
    t.tgenabled,
    t.tgfoid
  FROM required_triggers AS rt
  LEFT JOIN pg_catalog.pg_namespace AS n ON n.nspname = rt.schema_name
  LEFT JOIN pg_catalog.pg_class AS c
    ON c.relnamespace = n.oid
   AND c.relname = rt.table_name
  LEFT JOIN pg_catalog.pg_trigger AS t
    ON t.tgrelid = c.oid
   AND t.tgname = rt.trigger_name
   AND NOT t.tgisinternal
),
policy_catalog AS (
  SELECT
    ep.*,
    p.oid,
    p.polcmd,
    p.polpermissive,
    p.polroles,
    p.polqual IS NOT NULL AS using_present,
    p.polwithcheck IS NOT NULL AS check_present,
    ar.oid AS authenticated_oid
  FROM expected_policies AS ep
  LEFT JOIN pg_catalog.pg_namespace AS n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS c
    ON c.relnamespace = n.oid
   AND c.relname = ep.table_name
   AND c.relkind IN ('r','p')
  LEFT JOIN pg_catalog.pg_policy AS p
    ON p.polrelid = c.oid
   AND p.polname = ep.policy_name
  LEFT JOIN pg_catalog.pg_roles AS ar ON ar.rolname = 'authenticated'
),
extra_policy_catalog AS (
  SELECT
    ep.*,
    p.oid,
    p.polcmd,
    p.polroles,
    p.polqual IS NOT NULL AS using_present,
    p.polwithcheck IS NOT NULL AS check_present,
    ar.oid AS authenticated_oid
  FROM extra_policies AS ep
  LEFT JOIN pg_catalog.pg_namespace AS n ON n.nspname = 'public'
  LEFT JOIN pg_catalog.pg_class AS c
    ON c.relnamespace = n.oid
   AND c.relname = ep.table_name
   AND c.relkind IN ('r','p')
  LEFT JOIN pg_catalog.pg_policy AS p
    ON p.polrelid = c.oid
   AND p.polname = ep.policy_name
  LEFT JOIN pg_catalog.pg_roles AS ar ON ar.rolname = 'authenticated'
),
rpc_catalog AS (
  SELECT
    p.oid,
    p.proacl,
    p.proowner,
    p.prosecdef,
    pg_catalog.pg_get_function_result(p.oid) AS actual_result,
    r.rolname AS owner_name,
    pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10))) AS body_md5,
    pg_catalog.array_to_string(p.proconfig, ',') AS function_config
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
  WHERE p.oid = to_regprocedure('public.set_my_meal_completion(uuid,boolean)')
),
checks(sequence_no, check_id, object_name, status, is_safe) AS (
  SELECT
    10,
    'REQUIRED_TABLE_' || pg_catalog.upper(table_name),
    'public.' || table_name,
    CASE WHEN to_regclass('public.' || table_name) IS NULL THEN 'MISSING' ELSE 'MATCH' END,
    to_regclass('public.' || table_name) IS NOT NULL
  FROM required_tables

  UNION ALL
  SELECT
    20,
    'REQUIRED_FUNCTION_' || pg_catalog.upper(pg_catalog.replace(signature, 'public.', '')),
    signature,
    CASE
      WHEN oid IS NULL THEN 'MISSING'
      WHEN prosecdef <> expected_security_definer
        OR actual_result <> expected_result
        OR owner_name <> 'postgres'
        OR NOT (body_md5 = ANY (allowed_body_md5s))
        OR NOT (function_config = ANY (allowed_preflight_paths)) THEN 'MISMATCH'
      WHEN body_md5 = canonical_body_md5
       AND function_config = 'search_path=pg_catalog, public' THEN 'MATCH'
      ELSE 'EXPECTED_FUNCTION_DRIFT'
    END,
    oid IS NOT NULL
      AND prosecdef = expected_security_definer
      AND actual_result = expected_result
      AND owner_name = 'postgres'
      AND body_md5 = ANY (allowed_body_md5s)
      AND function_config = ANY (allowed_preflight_paths)
  FROM function_catalog

  UNION ALL
  SELECT
    30,
    'REQUIRED_TRIGGER_' || pg_catalog.upper(trigger_name),
    schema_name || '.' || table_name || '.' || trigger_name,
    CASE
      WHEN oid IS NULL THEN 'MISSING'
      WHEN tgenabled = 'D' OR tgfoid <> to_regprocedure(function_signature) THEN 'MISMATCH'
      ELSE 'MATCH'
    END,
    oid IS NOT NULL AND tgenabled <> 'D' AND tgfoid = to_regprocedure(function_signature)
  FROM trigger_catalog

  UNION ALL
  SELECT
    40,
    'VERIFICATION_CONSTRAINT',
    'public.dietitian_profiles.dietitian_profiles_verification_consistency_check',
    CASE
      WHEN con.oid IS NULL THEN 'EXPECTED_MISSING'
      WHEN con.convalidated
       AND position('is_verified is not distinct from' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
       AND position('verification_status' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
       AND position('approved' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0 THEN 'MATCH'
      ELSE 'MISMATCH'
    END,
    con.oid IS NULL OR (
      con.convalidated
      AND position('is_verified is not distinct from' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
      AND position('verification_status' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
      AND position('approved' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
    )
  FROM (SELECT 1) AS seed
  LEFT JOIN pg_catalog.pg_constraint AS con
    ON con.conrelid = to_regclass('public.dietitian_profiles')
   AND con.conname = 'dietitian_profiles_verification_consistency_check'

  UNION ALL
  SELECT
    41,
    'VERIFICATION_DATA_CONSISTENCY',
    'public.dietitian_profiles aggregate only',
    CASE WHEN count(*) = 0 THEN 'MATCH' ELSE 'BLOCKED_' || count(*)::text || '_ROWS' END,
    count(*) = 0
  FROM public.dietitian_profiles
  WHERE verification_status IS NULL
     OR verification_status NOT IN ('pending', 'approved', 'rejected')
     OR is_verified IS DISTINCT FROM (verification_status = 'approved')

  UNION ALL
  SELECT
    42,
    'APPOINTMENT_OWNERSHIP_DATA',
    'public.appointments aggregate only',
    CASE WHEN count(*) = 0 THEN 'MATCH' ELSE 'BLOCKED_' || count(*)::text || '_ROWS' END,
    count(*) = 0
  FROM public.appointments
  WHERE dietitian_id IS NULL OR client_id IS NULL

  UNION ALL
  SELECT
    50,
    'RLS_' || pg_catalog.upper(c.relname),
    'public.' || c.relname,
    CASE WHEN c.relrowsecurity THEN 'MATCH' ELSE 'EXPECTED_DISABLED' END,
    true
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('dietitian_profiles','appointments','chat_messages')

  UNION ALL
  SELECT
    60,
    'EXPECTED_POLICY_' || pg_catalog.upper(pg_catalog.replace(policy_name, ' ', '_')),
    'public.' || table_name || '.' || policy_name,
    CASE
      WHEN oid IS NULL THEN 'EXPECTED_MISSING'
      WHEN polcmd = command_code
       AND polpermissive
       AND polroles = ARRAY[authenticated_oid]::oid[]
       AND using_present = using_required
       AND check_present = check_required THEN 'BASIC_MATCH_MAIN_SQL_RECHECKS_PREDICATE'
      ELSE 'MISMATCH'
    END,
    oid IS NULL OR (
      polcmd = command_code
      AND polpermissive
      AND polroles = ARRAY[authenticated_oid]::oid[]
      AND using_present = using_required
      AND check_present = check_required
    )
  FROM policy_catalog

  UNION ALL
  SELECT
    70,
    'EXTRA_POLICY_' || pg_catalog.upper(pg_catalog.replace(policy_name, ' ', '_')),
    'public.' || table_name || '.' || policy_name,
    CASE
      WHEN oid IS NOT NULL
       AND polcmd = command_code
       AND polroles = ARRAY[authenticated_oid]::oid[]
       AND using_present THEN 'EXTRA_POLICY_MANUAL_REVIEW'
      ELSE 'MISMATCH'
    END,
    oid IS NOT NULL
      AND polcmd = command_code
      AND polroles = ARRAY[authenticated_oid]::oid[]
      AND using_present
  FROM extra_policy_catalog

  UNION ALL
  SELECT
    80,
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
    90,
    'MEAL_COMPLETION_RPC',
    'public.set_my_meal_completion(uuid,boolean)',
    CASE
      WHEN oid IS NULL THEN 'EXPECTED_MISSING'
      WHEN prosecdef
       AND actual_result = 'boolean'
       AND owner_name = 'postgres'
       AND body_md5 = '29ef449f3d82fbf463bbea6370eecf0f'
       AND function_config = 'search_path=pg_catalog, public'
       AND has_function_privilege('authenticated', oid, 'EXECUTE')
       AND has_function_privilege('service_role', oid, 'EXECUTE')
       AND NOT has_function_privilege('anon', oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(coalesce(proacl, pg_catalog.acldefault('f', proowner))) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN 'MATCH'
      ELSE 'MISMATCH'
    END,
    oid IS NULL OR (
      prosecdef
      AND actual_result = 'boolean'
      AND owner_name = 'postgres'
      AND body_md5 = '29ef449f3d82fbf463bbea6370eecf0f'
      AND function_config = 'search_path=pg_catalog, public'
      AND has_function_privilege('authenticated', oid, 'EXECUTE')
      AND has_function_privilege('service_role', oid, 'EXECUTE')
      AND NOT has_function_privilege('anon', oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(coalesce(proacl, pg_catalog.acldefault('f', proowner))) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      )
    )
  FROM (SELECT 1) AS seed
  LEFT JOIN rpc_catalog ON true

  UNION ALL
  SELECT
    91,
    'MEALS_PLAN_FK',
    'public.meals.meals_plan_id_fkey',
    CASE WHEN EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('public.meals')
        AND conname = 'meals_plan_id_fkey'
        AND contype = 'f'
    ) THEN 'MATCH' ELSE 'MISSING' END,
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = to_regclass('public.meals')
        AND conname = 'meals_plan_id_fkey'
        AND contype = 'f'
    )

  UNION ALL
  SELECT
    100,
    'MIGRATION_HISTORY',
    'supabase_migrations.schema_migrations',
    CASE
      WHEN NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'supabase_migrations')
       AND to_regclass('supabase_migrations.schema_migrations') IS NULL THEN 'EXPECTED_MISSING'
      ELSE 'UNEXPECTED_PRESENT'
    END,
    NOT EXISTS (SELECT 1 FROM pg_catalog.pg_namespace WHERE nspname = 'supabase_migrations')
      AND to_regclass('supabase_migrations.schema_migrations') IS NULL
),
results(sequence_no, check_id, object_name, status) AS (
  SELECT sequence_no, check_id, object_name, status
  FROM checks

  UNION ALL

  SELECT
    999,
    'FINAL_GATE',
    'RECONCILIATION_READY',
    CASE WHEN pg_catalog.bool_and(is_safe) THEN 'YES' ELSE 'NO' END
  FROM checks
)
SELECT check_id, object_name, status
FROM results
ORDER BY sequence_no, check_id;
