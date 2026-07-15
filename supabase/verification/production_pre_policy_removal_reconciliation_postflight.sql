-- DietBridge production pre-policy reconciliation postflight.
-- READ ONLY: catalog checks only; the meal completion RPC is never invoked.

WITH
expected_functions(signature, expected_security_definer, expected_result, body_contract, allowed_body_md5s, authenticated_execute) AS (
  VALUES
    ('public.handle_new_user()', true, 'trigger', 'handle_new_user', ARRAY[]::text[], false),
    ('public.protect_profile_system_fields()', false, 'trigger', 'allowed_hash', ARRAY['d23346619753f0334ad8e518a6cf7628']::text[], false),
    ('public.save_my_current_weight(numeric)', true, 'jsonb', 'allowed_hash', ARRAY['f7caf0c59ea4ea12d8b5558799564ada']::text[], true),
    ('public.set_profiles_updated_at()', false, 'trigger', 'allowed_hash', ARRAY['9b1889f56258bf9d6554213c05019c76']::text[], false),
    ('public.set_my_meal_completion(uuid,boolean)', true, 'boolean', 'meal_completion', ARRAY[]::text[], true)
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
    coalesce(CASE e.body_contract
      WHEN 'handle_new_user' THEN
        position('new.raw_user_meta_data ->> ''account_type''' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('new.raw_user_meta_data ->> ''role''' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('v_account_type = ''client''' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('v_account_type = ''dietitian''' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('errcode = ''22023''' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('insert into public.profiles' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('insert into public.client_profiles' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('insert into public.dietitian_profiles' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('values (new.id, false, ''pending'', null, null)' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('on conflict (id) do nothing' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('on conflict (user_id) do nothing' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('return new' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
      WHEN 'meal_completion' THEN
        position('v_user_id uuid := auth.uid()' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('update public.meals as m' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('set is_eaten = p_is_eaten' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND pg_catalog.regexp_count(pg_catalog.lower(coalesce(p.prosrc, '')), '\mset\M') = 1
        AND position('from public.meal_plans as mp' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('mp.id = m.plan_id' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('mp.client_id = v_user_id' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('v_updated_count <> 1' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
        AND position('return true' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
      WHEN 'allowed_hash' THEN
        pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10))) = ANY (e.allowed_body_md5s)
      ELSE false
    END, false) AS body_contract_matches,
    coalesce(
      pg_catalog.cardinality(coalesce(p.proconfig, ARRAY[]::text[])) = 1
      AND 'search_path=pg_catalog, public' = ANY (coalesce(p.proconfig, ARRAY[]::text[]))
      AND (
        SELECT count(*)
        FROM pg_catalog.unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS config(value)
        WHERE config.value LIKE 'search_path=%'
      ) = 1,
      false
    ) AS search_path_matches
  FROM expected_functions AS e
  LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = to_regprocedure(e.signature)
  LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
),
verification_sync_function_catalog AS (
  SELECT
    p.oid,
    p.proacl,
    p.proowner,
    p.prosecdef,
    pg_catalog.pg_get_function_result(p.oid) AS actual_result,
    r.rolname AS owner_name,
    position('new.verification_status not in (''pending'', ''approved'', ''rejected'')' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
      AND position('new.verified_at is distinct from old.verified_at' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
      AND position('new.rejection_reason is distinct from old.rejection_reason' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
      AND position('new.is_verified := (new.verification_status = ''approved'')' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
      AND position('return new' IN pg_catalog.lower(coalesce(p.prosrc, ''))) > 0
      AND position('approved_at' IN pg_catalog.lower(coalesce(p.prosrc, ''))) = 0 AS body_contract_matches,
    coalesce(
      pg_catalog.cardinality(coalesce(p.proconfig, ARRAY[]::text[])) = 1
      AND 'search_path=pg_catalog, public' = ANY (coalesce(p.proconfig, ARRAY[]::text[]))
      AND (
        SELECT count(*)
        FROM pg_catalog.unnest(coalesce(p.proconfig, ARRAY[]::text[])) AS config(value)
        WHERE config.value LIKE 'search_path=%'
      ) = 1,
      false
    ) AS search_path_matches
  FROM (SELECT 1) AS seed
  LEFT JOIN pg_catalog.pg_proc AS p
    ON p.oid = to_regprocedure('public.sync_dietitian_verification_fields()')
  LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
),
verification_sync_trigger_catalog AS (
  SELECT
    t.oid,
    t.tgenabled,
    t.tgtype,
    t.tgfoid
  FROM (SELECT 1) AS seed
  LEFT JOIN pg_catalog.pg_trigger AS t
    ON t.tgrelid = to_regclass('public.dietitian_profiles')
   AND t.tgname = 'trg_sync_dietitian_verification_fields'
   AND NOT t.tgisinternal
),
verification_data AS (
  SELECT count(*) AS inconsistent_count
  FROM public.dietitian_profiles
  WHERE verification_status IS NULL
     OR verification_status NOT IN ('pending', 'approved', 'rejected')
     OR is_verified IS DISTINCT FROM (verification_status = 'approved')
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
        OR NOT body_contract_matches
        OR NOT search_path_matches
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
      AND body_contract_matches
      AND search_path_matches
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
    15,
    'VERIFICATION_CONSISTENCY',
    'VERIFICATION_SYNC_FUNCTION',
    'public.sync_dietitian_verification_fields()',
    CASE
      WHEN oid IS NOT NULL
       AND NOT prosecdef
       AND actual_result = 'trigger'
       AND owner_name = 'postgres'
       AND body_contract_matches
       AND search_path_matches
       AND NOT has_function_privilege('anon', oid, 'EXECUTE')
       AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')
       AND NOT EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(coalesce(proacl, pg_catalog.acldefault('f', proowner))) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN 'MATCH'
      ELSE 'MISSING_OR_MISMATCH'
    END,
    oid IS NOT NULL
      AND NOT prosecdef
      AND actual_result = 'trigger'
      AND owner_name = 'postgres'
      AND body_contract_matches
      AND search_path_matches
      AND NOT has_function_privilege('anon', oid, 'EXECUTE')
      AND NOT has_function_privilege('authenticated', oid, 'EXECUTE')
      AND NOT EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(coalesce(proacl, pg_catalog.acldefault('f', proowner))) AS acl
        WHERE acl.grantee = 0
          AND acl.privilege_type = 'EXECUTE'
      )
  FROM verification_sync_function_catalog

  UNION ALL
  SELECT
    16,
    'VERIFICATION_CONSISTENCY',
    'VERIFICATION_SYNC_TRIGGER',
    'public.dietitian_profiles.trg_sync_dietitian_verification_fields',
    CASE
      WHEN oid IS NOT NULL
       AND tgenabled <> 'D'
       AND tgtype = 23
       AND tgfoid = to_regprocedure('public.sync_dietitian_verification_fields()') THEN 'MATCH'
      ELSE 'MISSING_OR_MISMATCH'
    END,
    oid IS NOT NULL
      AND tgenabled <> 'D'
      AND tgtype = 23
      AND tgfoid = to_regprocedure('public.sync_dietitian_verification_fields()')
  FROM verification_sync_trigger_catalog

  UNION ALL
  SELECT
    17,
    'VERIFICATION_CONSISTENCY',
    'VERIFICATION_DATA_CONSISTENCY',
    'public.dietitian_profiles aggregate only',
    CASE WHEN inconsistent_count = 0 THEN 'MATCH' ELSE 'MISMATCH_' || inconsistent_count::text || '_ROWS' END,
    inconsistent_count = 0
  FROM verification_data

  UNION ALL
  SELECT
    20,
    'VERIFICATION_CONSISTENCY',
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
    899,
    'GATE',
    'VERIFICATION_CONSISTENCY_CONTRACT',
    'VERIFICATION_CONSISTENCY_CONTRACT',
    CASE WHEN pg_catalog.bool_and(is_match) THEN 'YES' ELSE 'NO' END,
    pg_catalog.bool_and(is_match)
  FROM checks
  WHERE check_group = 'VERIFICATION_CONSISTENCY'

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
