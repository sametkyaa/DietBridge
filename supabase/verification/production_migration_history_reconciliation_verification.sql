-- DietBridge production migration contract reconciliation.
-- READ ONLY: every executable statement starts with WITH or SELECT.
-- Run in the production SQL Editor only during the separately approved 3E-2C-2B step.
-- Results intentionally omit row data, URLs, keys, full function bodies and project refs.

-- STATEMENT 01: migration tracking presence
-- Exact history rows cannot be read safely when the
-- relation may not exist without dynamic SQL. A present table therefore opens a separate
-- MANUAL_REVIEW gate; a missing table is reported without raising a relation error.
WITH history_catalog AS (
  SELECT
    EXISTS (
      SELECT 1
      FROM pg_catalog.pg_namespace AS n
      WHERE n.nspname = 'supabase_migrations'
    ) AS schema_exists,
    to_regclass('supabase_migrations.schema_migrations') AS history_relation
)
SELECT
  'S01'::text AS statement_id,
  'HISTORY'::text AS migration_version,
  'HISTORY-SCHEMA-01'::text AS check_id,
  'schema'::text AS object_type,
  'supabase_migrations'::text AS object_name,
  CASE WHEN schema_exists THEN 'MATCH' ELSE 'MISSING' END::text AS status,
  'schema exists'::text AS expected_summary,
  CASE WHEN schema_exists THEN 'present' ELSE 'missing' END::text AS actual_summary
FROM history_catalog
UNION ALL
SELECT
  'S01',
  'HISTORY',
  'HISTORY-TABLE-01',
  'table',
  'supabase_migrations.schema_migrations',
  CASE WHEN history_relation IS NOT NULL THEN 'MATCH' ELSE 'MISSING' END,
  'history table exists',
  CASE WHEN history_relation IS NOT NULL THEN 'present' ELSE 'missing' END
FROM history_catalog
UNION ALL
SELECT
  'S01',
  'HISTORY',
  'HISTORY-ROWS-01',
  'migration_history',
  'version inventory',
  CASE WHEN history_relation IS NULL THEN 'MISSING' ELSE 'MANUAL_REVIEW' END,
  'exact count and version list after table existence is confirmed',
  CASE
    WHEN history_relation IS NULL THEN 'not available because history table is missing'
    ELSE 'run the separately approved guarded version SELECT; no dynamic SQL is used here'
  END
FROM history_catalog
ORDER BY check_id;

-- STATEMENT 02: critical table and column contracts
WITH expected_columns (
  migration_version, table_name, column_name, expected_type, expected_not_null,
  default_required, expected_default_fragment
) AS (
  VALUES
    ('20260713000001','profiles','id','uuid',true,false,NULL),
    ('20260713000001','profiles','email','text',false,false,NULL),
    ('20260713000001','profiles','role','user_role',false,true,'client'),
    ('20260713000001','profiles','updated_at','timestamp with time zone',true,true,'now'),
    ('20260713000001','client_profiles','user_id','uuid',true,false,NULL),
    ('20260713000001','client_profiles','current_weight','numeric',false,false,NULL),
    ('20260713000001','client_profiles','updated_at','timestamp with time zone',true,true,'now'),
    ('20260713000001','dietitian_profiles','user_id','uuid',true,false,NULL),
    ('20260713000001','dietitian_profiles','is_verified','boolean',false,true,'false'),
    ('20260713000001','dietitian_profiles','verification_status','text',true,true,'pending'),
    ('20260713000001','dietitian_clients','dietitian_id','uuid',true,false,NULL),
    ('20260713000001','dietitian_clients','client_id','uuid',true,false,NULL),
    ('20260713000001','dietitian_clients','status','client_status',true,true,'pending'),
    ('20260713000001','meal_plans','id','uuid',true,true,'gen_random_uuid'),
    ('20260713000001','meal_plans','client_id','uuid',false,false,NULL),
    ('20260713000001','meal_plans','dietitian_id','uuid',false,false,NULL),
    ('20260713000001','meals','id','uuid',true,true,'gen_random_uuid'),
    ('20260713000001','meals','plan_id','uuid',false,false,NULL),
    ('20260713000001','meals','is_eaten','boolean',false,true,'false'),
    ('20260713000001','meals','time','time without time zone',false,false,NULL),
    ('20260713000001','meals','sort_order','integer',false,true,'0'),
    ('20260713000001','measurements','client_id','uuid',true,false,NULL),
    ('20260713000001','measurements','measured_at','date',true,true,'current_date'),
    ('20260713000001','daily_logs','client_id','uuid',false,false,NULL),
    ('20260713000001','daily_logs','date','date',true,false,NULL),
    ('20260713000001','chat_messages','sender_id','uuid',false,false,NULL),
    ('20260713000001','chat_messages','receiver_id','uuid',false,false,NULL),
    ('20260713000001','chat_messages','message_text','text',true,false,NULL),
    ('20260713000001','appointments','dietitian_id','uuid',false,false,NULL),
    ('20260713000001','appointments','client_id','uuid',false,false,NULL),
    ('20260713000001','appointments','date','date',true,false,NULL),
    ('20260713000001','appointments','time','time without time zone',true,false,NULL)
), actual_columns AS (
  SELECT
    c.relname AS table_name,
    a.attname AS column_name,
    a.attnotnull,
    replace(a.atttypid::pg_catalog.regtype::text, 'public.', '') AS actual_type,
    pg_get_expr(ad.adbin, ad.adrelid) AS default_expression
  FROM pg_catalog.pg_namespace AS n
  JOIN pg_catalog.pg_class AS c ON c.relnamespace = n.oid AND c.relkind IN ('r','p')
  JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
  LEFT JOIN pg_catalog.pg_attrdef AS ad ON ad.adrelid = c.oid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public'
)
SELECT
  'S02'::text AS statement_id,
  e.migration_version,
  'COLUMN-' || upper(e.table_name) || '-' || upper(e.column_name) AS check_id,
  'column'::text AS object_type,
  'public.' || e.table_name || '.' || e.column_name AS object_name,
  CASE
    WHEN a.column_name IS NULL THEN 'MISSING'
    WHEN a.actual_type <> e.expected_type
      OR a.attnotnull <> e.expected_not_null
      OR (e.default_required AND a.default_expression IS NULL)
      OR (e.expected_default_fragment IS NOT NULL
          AND position(lower(e.expected_default_fragment) IN lower(coalesce(a.default_expression,''))) = 0)
      THEN 'MISMATCH'
    ELSE 'MATCH'
  END::text AS status,
  'type=' || e.expected_type || '; not_null=' || e.expected_not_null::text
    || '; default=' || coalesce(e.expected_default_fragment,'none') AS expected_summary,
  CASE
    WHEN a.column_name IS NULL THEN 'missing'
    ELSE 'type=' || a.actual_type || '; not_null=' || a.attnotnull::text
      || '; default=' || CASE WHEN a.default_expression IS NULL THEN 'none' ELSE 'present' END
  END::text AS actual_summary
FROM expected_columns AS e
LEFT JOIN actual_columns AS a USING (table_name, column_name)
ORDER BY e.table_name, e.column_name;

-- STATEMENT 03: primary key, foreign key, unique and check constraints
WITH expected_constraints (
  migration_version, table_name, constraint_name, constraint_type, required_fragment
) AS (
  VALUES
    ('20260713000001','profiles','profiles_pkey','p','primary key (id)'),
    ('20260713000001','profiles','profiles_email_key','u','unique (email)'),
    ('20260713000001','profiles','profiles_id_fkey','f','on delete cascade'),
    ('20260713000001','client_profiles','client_profiles_pkey','p','primary key (user_id)'),
    ('20260713000001','client_profiles','client_profiles_user_id_fkey','f','on delete cascade'),
    ('20260713000001','dietitian_profiles','dietitian_profiles_pkey','p','primary key (user_id)'),
    ('20260713000001','dietitian_profiles','dietitian_profiles_user_id_fkey','f','on delete cascade'),
    ('20260713000001','dietitian_profiles','dietitian_profiles_verification_status_check','c','verification_status'),
    ('20260713010100','dietitian_profiles','dietitian_profiles_verification_consistency_check','c','is_verified'),
    ('20260713000001','dietitian_clients','dietitian_clients_pkey','p','primary key (id)'),
    ('20260713000001','dietitian_clients','dietitian_clients_dietitian_id_fkey','f','foreign key (dietitian_id)'),
    ('20260713000001','dietitian_clients','dietitian_clients_client_id_fkey','f','foreign key (client_id)'),
    ('20260713000001','dietitian_clients','dietitian_clients_status_check','c','status'),
    ('20260713000001','meal_plans','meal_plans_pkey','p','primary key (id)'),
    ('20260713000001','meal_plans','meal_plans_client_id_fkey','f','foreign key (client_id)'),
    ('20260713000001','meal_plans','meal_plans_dietitian_id_fkey','f','foreign key (dietitian_id)'),
    ('20260713000001','meals','meals_pkey','p','primary key (id)'),
    ('20260713000001','meals','meals_plan_id_fkey','f','on delete cascade'),
    ('20260713000001','measurements','measurements_pkey','p','primary key (id)'),
    ('20260713000001','measurements','measurements_client_id_fkey','f','on delete cascade'),
    ('20260713000001','measurements','measurements_positive_values_check','c','weight'),
    ('20260713000001','daily_logs','daily_logs_pkey','p','primary key (id)'),
    ('20260713000001','daily_logs','daily_logs_client_id_date_key','u','unique (client_id, date)'),
    ('20260713000001','daily_logs','daily_logs_client_id_fkey','f','foreign key (client_id)'),
    ('20260713000001','chat_messages','chat_messages_pkey','p','primary key (id)'),
    ('20260713000001','chat_messages','chat_messages_sender_id_fkey','f','foreign key (sender_id)'),
    ('20260713000001','chat_messages','chat_messages_receiver_id_fkey','f','foreign key (receiver_id)'),
    ('20260713000001','appointments','appointments_pkey','p','primary key (id)'),
    ('20260713000001','appointments','appointments_dietitian_id_fkey','f','foreign key (dietitian_id)'),
    ('20260713000001','appointments','appointments_client_id_fkey','f','foreign key (client_id)')
), actual_constraints AS (
  SELECT
    c.relname AS table_name,
    con.conname AS constraint_name,
    con.contype::text AS constraint_type,
    pg_get_constraintdef(con.oid, true) AS definition
  FROM pg_catalog.pg_constraint AS con
  JOIN pg_catalog.pg_class AS c ON c.oid = con.conrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
)
SELECT
  'S03'::text AS statement_id,
  e.migration_version,
  'CONSTRAINT-' || upper(e.constraint_name) AS check_id,
  'constraint'::text AS object_type,
  'public.' || e.table_name || '.' || e.constraint_name AS object_name,
  CASE
    WHEN a.constraint_name IS NULL THEN 'MISSING'
    WHEN a.constraint_type <> e.constraint_type
      OR position(lower(e.required_fragment) IN lower(a.definition)) = 0 THEN 'MISMATCH'
    ELSE 'MATCH'
  END::text AS status,
  'type=' || e.constraint_type || '; contains reviewed contract fragment' AS expected_summary,
  CASE WHEN a.constraint_name IS NULL THEN 'missing'
       ELSE 'type=' || a.constraint_type || '; reviewed fragment=' ||
         CASE WHEN position(lower(e.required_fragment) IN lower(a.definition)) > 0 THEN 'present' ELSE 'absent' END
  END::text AS actual_summary
FROM expected_constraints AS e
LEFT JOIN actual_constraints AS a USING (table_name, constraint_name)
ORDER BY e.table_name, e.constraint_name;

-- STATEMENT 04: critical index contracts
WITH expected_indexes (migration_version, index_name, table_name, required_fragment) AS (
  VALUES
    ('20260713000001','dietitian_clients_dietitian_client_unique','dietitian_clients','dietitian_id'),
    ('20260713000001','one_pending_or_active_dietitian_per_client','dietitian_clients','status'),
    ('20260713000001','measurements_client_date_unique','measurements','measured_at'),
    ('20260713000001','idx_meals_plan_id_sort_order','meals','sort_order'),
    ('20260713000001','idx_meals_plan_id_time','meals','time')
), actual_indexes AS (
  SELECT
    i.indexname AS index_name,
    i.tablename AS table_name,
    i.indexdef AS definition
  FROM pg_catalog.pg_indexes AS i
  WHERE i.schemaname = 'public'
)
SELECT
  'S04'::text AS statement_id,
  e.migration_version,
  'INDEX-' || upper(e.index_name) AS check_id,
  'index'::text AS object_type,
  'public.' || e.index_name AS object_name,
  CASE
    WHEN a.index_name IS NULL THEN 'MISSING'
    WHEN a.table_name <> e.table_name
      OR position(lower(e.required_fragment) IN lower(a.definition)) = 0 THEN 'MISMATCH'
    ELSE 'MATCH'
  END::text AS status,
  'index on public.' || e.table_name || ' containing reviewed column/predicate' AS expected_summary,
  CASE WHEN a.index_name IS NULL THEN 'missing' ELSE 'present; reviewed fragment=' ||
    CASE WHEN position(lower(e.required_fragment) IN lower(a.definition)) > 0 THEN 'present' ELSE 'absent' END END AS actual_summary
FROM expected_indexes AS e
LEFT JOIN actual_indexes AS a USING (index_name)
ORDER BY e.index_name;

-- STATEMENT 05: RLS enablement
WITH expected_rls (migration_version, table_name) AS (
  VALUES
    ('20260713000001','profiles'),
    ('20260713000001','client_profiles'),
    ('20260713010300','dietitian_profiles'),
    ('20260713000001','dietitian_clients'),
    ('20260713000001','meal_plans'),
    ('20260713000001','meals'),
    ('20260713000001','measurements'),
    ('20260713000001','daily_logs'),
    ('20260713010300','chat_messages'),
    ('20260713010300','appointments')
), actual_tables AS (
  SELECT c.relname AS table_name, c.relrowsecurity
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
)
SELECT
  'S05'::text AS statement_id,
  e.migration_version,
  'RLS-' || upper(e.table_name) AS check_id,
  'table_rls'::text AS object_type,
  'public.' || e.table_name AS object_name,
  CASE WHEN a.table_name IS NULL THEN 'MISSING'
       WHEN NOT a.relrowsecurity THEN 'MISMATCH'
       ELSE 'MATCH' END::text AS status,
  'RLS enabled'::text AS expected_summary,
  CASE WHEN a.table_name IS NULL THEN 'table missing'
       WHEN a.relrowsecurity THEN 'enabled' ELSE 'disabled' END::text AS actual_summary
FROM expected_rls AS e
LEFT JOIN actual_tables AS a USING (table_name)
ORDER BY e.table_name;

-- STATEMENT 06: function signature and security contracts
WITH expected_functions (
  migration_version, signature, return_type, security_definer, search_path_fragment,
  auth_uid_required, owner_check_required, only_is_eaten_required
) AS (
  VALUES
    ('20260713010200','public.handle_new_user()','trigger',true,'pg_catalog, public',false,false,false),
    ('20260713010000','public.protect_profile_system_fields()','trigger',false,'pg_catalog, public',true,true,false),
    ('20260713010000','public.set_profiles_updated_at()','trigger',false,'pg_catalog, public',false,false,false),
    ('20260713010000','public.save_my_current_weight(numeric)','jsonb',true,'pg_catalog, public',true,true,false),
    ('20260713010400','public.set_my_meal_completion(uuid,boolean)','boolean',true,'pg_catalog, public',true,true,true)
), function_catalog AS (
  SELECT
    e.*,
    to_regprocedure(e.signature) AS function_oid
  FROM expected_functions AS e
), function_details AS (
  SELECT
    f.*,
    p.prosecdef,
    p.prorettype::pg_catalog.regtype::text AS actual_return_type,
    coalesce(array_to_string(p.proconfig, ','),'') AS configuration,
    r.rolname AS owner_name,
    lower(pg_get_functiondef(p.oid)) AS function_definition
  FROM function_catalog AS f
  LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = f.function_oid
  LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
)
SELECT
  'S06'::text AS statement_id,
  migration_version,
  'FUNCTION-' || upper(replace(replace(signature,'public.',''),'()','')) AS check_id,
  'function'::text AS object_type,
  signature AS object_name,
  CASE
    WHEN function_oid IS NULL THEN 'MISSING'
    WHEN actual_return_type <> return_type
      OR prosecdef <> security_definer
      OR position(search_path_fragment IN replace(configuration,'search_path=','')) = 0
      OR owner_name <> 'postgres'
      OR (auth_uid_required AND position('auth.uid()' IN function_definition) = 0)
      OR (owner_check_required AND position('auth.uid()' IN function_definition) = 0)
      OR (only_is_eaten_required AND (
           position('set is_eaten' IN function_definition) = 0
           OR position('set title' IN function_definition) > 0
           OR position('set plan_id' IN function_definition) > 0
           OR position('set calories' IN function_definition) > 0
         ))
      THEN 'MISMATCH'
    ELSE 'MATCH'
  END::text AS status,
  'signature/return/security/search_path/owner and reviewed body invariants match' AS expected_summary,
  CASE WHEN function_oid IS NULL THEN 'missing' ELSE
    'return=' || actual_return_type
    || '; security_definer=' || prosecdef::text
    || '; fixed_search_path=' || (position(search_path_fragment IN replace(configuration,'search_path=','')) > 0)::text
    || '; owner_expected=' || (owner_name = 'postgres')::text
    || '; contains_auth_uid_check=' || (position('auth.uid()' IN function_definition) > 0)::text
    || '; contains_owner_check=' || (position('auth.uid()' IN function_definition) > 0)::text
    || '; updates_only_is_eaten=' ||
      (only_is_eaten_required AND position('set is_eaten' IN function_definition) > 0
       AND position('set title' IN function_definition) = 0
       AND position('set plan_id' IN function_definition) = 0
       AND position('set calories' IN function_definition) = 0)::text
  END::text AS actual_summary
FROM function_details
ORDER BY signature;

-- STATEMENT 07: trigger contracts
WITH expected_triggers (
  migration_version, schema_name, table_name, trigger_name, function_signature,
  expected_row, expected_before, expected_insert, expected_update
) AS (
  VALUES
    ('20260713010500','auth','users','on_auth_user_created','public.handle_new_user()',true,false,true,false),
    ('20260713000001','public','profiles','trg_profiles_updated_at','public.set_profiles_updated_at()',true,true,false,true),
    ('20260713000001','public','profiles','trg_protect_profile_system_fields','public.protect_profile_system_fields()',true,true,false,true)
), actual_triggers AS (
  SELECT
    n.nspname AS schema_name,
    c.relname AS table_name,
    t.tgname AS trigger_name,
    t.tgfoid,
    t.tgtype::integer AS trigger_type,
    t.tgenabled,
    pg_get_triggerdef(t.oid, true) AS definition
  FROM pg_catalog.pg_trigger AS t
  JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE NOT t.tgisinternal
)
SELECT
  'S07'::text AS statement_id,
  e.migration_version,
  'TRIGGER-' || upper(e.trigger_name) AS check_id,
  'trigger'::text AS object_type,
  e.schema_name || '.' || e.table_name || '.' || e.trigger_name AS object_name,
  CASE
    WHEN a.trigger_name IS NULL THEN 'MISSING'
    WHEN a.tgenabled = 'D'
      OR a.tgfoid <> to_regprocedure(e.function_signature)
      OR ((a.trigger_type & 1) = 1) <> e.expected_row
      OR ((a.trigger_type & 2) = 2) <> e.expected_before
      OR ((a.trigger_type & 4) = 4) <> e.expected_insert
      OR ((a.trigger_type & 16) = 16) <> e.expected_update
      THEN 'MISMATCH'
    ELSE 'MATCH'
  END::text AS status,
  'enabled; timing/event/row/function target match'::text AS expected_summary,
  CASE WHEN a.trigger_name IS NULL THEN 'missing' ELSE
    'enabled=' || (a.tgenabled <> 'D')::text
    || '; function_target=' || (a.tgfoid = to_regprocedure(e.function_signature))::text
    || '; definition_checked=true'
  END::text AS actual_summary
FROM expected_triggers AS e
LEFT JOIN actual_triggers AS a USING (schema_name, table_name, trigger_name)
ORDER BY e.schema_name, e.table_name, e.trigger_name;

-- STATEMENT 08: critical policy inventory
-- Deliberately avoids expected-policy joins, view-based policy expansion and predicate decompilation.
SELECT
  'S08'::text AS statement_id,
  n.nspname::text AS schema_name,
  c.relname::text AS table_name,
  p.polname::text AS policy_name,
  CASE p.polcmd
    WHEN 'r' THEN 'SELECT'
    WHEN 'a' THEN 'INSERT'
    WHEN 'w' THEN 'UPDATE'
    WHEN 'd' THEN 'DELETE'
    WHEN '*' THEN 'ALL'
    ELSE 'UNKNOWN'
  END::text AS command,
  (p.polroles = ARRAY[authenticated_role.oid]::oid[]) AS authenticated_only,
  (p.polqual IS NOT NULL) AS using_present,
  (p.polwithcheck IS NOT NULL) AS with_check_present,
  'MANUAL_REVIEW'::text AS status
FROM pg_catalog.pg_policy AS p
JOIN pg_catalog.pg_class AS c ON c.oid = p.polrelid
JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_catalog.pg_roles AS authenticated_role
  ON authenticated_role.rolname = 'authenticated'
WHERE n.nspname = 'public'
  AND c.relname IN (
    'profiles',
    'client_profiles',
    'dietitian_profiles',
    'dietitian_clients',
    'meal_plans',
    'meals',
    'measurements',
    'daily_logs',
    'appointments',
    'chat_messages'
  )
ORDER BY n.nspname, c.relname, p.polname;

-- STATEMENT 09: function execute privileges
-- has_function_privilege returns only booleans;
-- no key, token or role credential is read.
WITH expected_privileges (
  migration_version, signature, role_name, expected_execute
) AS (
  VALUES
    ('20260713010000','public.save_my_current_weight(numeric)','authenticated',true),
    ('20260713010000','public.save_my_current_weight(numeric)','anon',false),
    ('20260713010000','public.save_my_current_weight(numeric)','PUBLIC',false),
    ('20260713010000','public.save_my_current_weight(numeric)','service_role',true),
    ('20260713010400','public.set_my_meal_completion(uuid,boolean)','authenticated',true),
    ('20260713010400','public.set_my_meal_completion(uuid,boolean)','anon',false),
    ('20260713010400','public.set_my_meal_completion(uuid,boolean)','PUBLIC',false),
    ('20260713010400','public.set_my_meal_completion(uuid,boolean)','service_role',true)
), privilege_catalog AS (
  SELECT
    e.*,
    p.oid AS function_oid,
    p.proacl,
    CASE
      WHEN e.role_name = 'PUBLIC' THEN 0::oid
      ELSE r.oid
    END AS grantee_oid
  FROM expected_privileges AS e
  LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = to_regprocedure(e.signature)
  LEFT JOIN pg_catalog.pg_roles AS r ON r.rolname = e.role_name
), privilege_results AS (
  SELECT
    p.*,
    CASE
      WHEN p.function_oid IS NULL THEN false
      WHEN p.proacl IS NULL THEN true
      ELSE EXISTS (
        SELECT 1
        FROM pg_catalog.aclexplode(p.proacl) AS x
        WHERE x.grantee = p.grantee_oid
          AND x.privilege_type = 'EXECUTE'
      )
    END AS actual_execute
  FROM privilege_catalog AS p
)
SELECT
  'S09'::text AS statement_id,
  migration_version,
  'EXECUTE-' || upper(replace(replace(signature,'public.',''),'()','')) || '-' || upper(role_name) AS check_id,
  'function_privilege'::text AS object_type,
  signature || ' -> ' || role_name AS object_name,
  CASE
    WHEN function_oid IS NULL THEN 'MISSING'
    WHEN actual_execute <> expected_execute THEN 'MISMATCH'
    ELSE 'MATCH'
  END::text AS status,
  'execute=' || expected_execute::text AS expected_summary,
  CASE WHEN function_oid IS NULL THEN 'function missing'
       ELSE 'execute=' || actual_execute::text END::text AS actual_summary
FROM privilege_results
ORDER BY signature, role_name;

-- STATEMENT 10: default privilege contracts
-- The prelude revoke is superseded by the baseline
-- default-privilege statements, so its historical application cannot be proven from final state.
WITH default_acl_state AS (
  SELECT
    d.defaclobjtype,
    r.rolname AS grantee,
    x.privilege_type
  FROM pg_catalog.pg_default_acl AS d
  JOIN pg_catalog.pg_namespace AS n ON n.oid = d.defaclnamespace AND n.nspname = 'public'
  CROSS JOIN LATERAL pg_catalog.aclexplode(d.defaclacl) AS x
  JOIN pg_catalog.pg_roles AS r ON r.oid = x.grantee
)
SELECT
  'S10'::text AS statement_id,
  '20260713000000'::text AS migration_version,
  'DEFAULT-PRIVILEGES-PRELUDE-HISTORY'::text AS check_id,
  'default_privilege'::text AS object_type,
  'public tables for anon/authenticated'::text AS object_name,
  'NOT_APPLICABLE'::text AS status,
  'historical revoke executed before baseline restore'::text AS expected_summary,
  'final state is superseded by baseline grants; application cannot be inferred'::text AS actual_summary
UNION ALL
SELECT
  'S10',
  '20260713000001',
  'DEFAULT-PRIVILEGES-BASELINE-TABLES',
  'default_privilege',
  'public tables for anon/authenticated',
  CASE WHEN (
    SELECT count(DISTINCT grantee || ':' || privilege_type)
    FROM default_acl_state
    WHERE defaclobjtype = 'r'
      AND grantee IN ('anon','authenticated')
      AND privilege_type IN ('DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE')
  ) = 14
  THEN 'MATCH' ELSE 'MISSING' END,
  'baseline table defaults recorded for API roles',
  CASE WHEN (
    SELECT count(DISTINCT grantee || ':' || privilege_type)
    FROM default_acl_state
    WHERE defaclobjtype = 'r'
      AND grantee IN ('anon','authenticated')
      AND privilege_type IN ('DELETE','INSERT','REFERENCES','SELECT','TRIGGER','TRUNCATE','UPDATE')
  ) = 14
  THEN 'present' ELSE 'missing' END
UNION ALL
SELECT
  'S10',
  '20260713000001',
  'DEFAULT-PRIVILEGES-BASELINE-FUNCTIONS',
  'default_privilege',
  'public functions for anon/authenticated',
  CASE WHEN (
    SELECT count(DISTINCT grantee || ':' || privilege_type)
    FROM default_acl_state
    WHERE defaclobjtype = 'f'
      AND grantee IN ('anon','authenticated')
      AND privilege_type = 'EXECUTE'
  ) = 2
  THEN 'MATCH' ELSE 'MISSING' END,
  'baseline function defaults recorded for API roles',
  CASE WHEN (
    SELECT count(DISTINCT grantee || ':' || privilege_type)
    FROM default_acl_state
    WHERE defaclobjtype = 'f'
      AND grantee IN ('anon','authenticated')
      AND privilege_type = 'EXECUTE'
  ) = 2
  THEN 'present' ELSE 'missing' END;

-- STATEMENT 11: legacy policy dependency gate
-- Expected production result is NO until
-- the RPC exists and every security/privilege/body invariant below is true.
WITH rpc AS (
  SELECT
    p.oid,
    p.prosecdef,
    p.proacl,
    coalesce(array_to_string(p.proconfig, ','),'') AS configuration,
    lower(pg_get_functiondef(p.oid)) AS definition
  FROM pg_catalog.pg_proc AS p
  WHERE p.oid = to_regprocedure('public.set_my_meal_completion(uuid,boolean)')
), readiness AS (
  SELECT
    EXISTS (SELECT 1 FROM rpc) AS rpc_exists,
    coalesce((SELECT prosecdef FROM rpc),false) AS security_definer,
    coalesce((SELECT position('pg_catalog, public' IN replace(configuration,'search_path=','')) > 0 FROM rpc),false) AS fixed_search_path,
    coalesce(has_function_privilege('authenticated', to_regprocedure('public.set_my_meal_completion(uuid,boolean)'), 'EXECUTE'),false) AS authenticated_execute,
    coalesce(has_function_privilege('anon', to_regprocedure('public.set_my_meal_completion(uuid,boolean)'), 'EXECUTE'),false) AS anon_execute,
    coalesce((SELECT CASE WHEN proacl IS NULL THEN true ELSE EXISTS (
      SELECT 1 FROM pg_catalog.aclexplode(proacl) AS x
      WHERE x.grantee = 0::oid AND x.privilege_type = 'EXECUTE'
    ) END FROM rpc),false) AS public_execute,
    coalesce((SELECT position('auth.uid()' IN definition) > 0 FROM rpc),false) AS contains_auth_uid_check,
    coalesce((SELECT position('mp.client_id = v_user_id' IN definition) > 0 FROM rpc),false) AS contains_owner_check,
    coalesce((SELECT
      position('set is_eaten' IN definition) > 0
      AND position('set title' IN definition) = 0
      AND position('set plan_id' IN definition) = 0
      AND position('set calories' IN definition) = 0
      FROM rpc),false) AS updates_only_is_eaten
)
SELECT
  'S11'::text AS statement_id,
  '20260714010000'::text AS migration_version,
  'RPC_READY_FOR_POLICY_REMOVAL'::text AS check_id,
  'dependency_gate'::text AS object_type,
  'public.set_my_meal_completion(uuid,boolean)'::text AS object_name,
  CASE WHEN NOT rpc_exists THEN 'MISSING'
  WHEN rpc_exists
    AND security_definer
    AND fixed_search_path
    AND authenticated_execute
    AND NOT anon_execute
    AND NOT public_execute
    AND contains_auth_uid_check
    AND contains_owner_check
    AND updates_only_is_eaten
    THEN 'MATCH' ELSE 'MISMATCH' END::text AS status,
  'RPC_READY_FOR_POLICY_REMOVAL=YES only when every reviewed invariant matches'::text AS expected_summary,
  'RPC_READY_FOR_POLICY_REMOVAL=' || CASE WHEN rpc_exists
    AND security_definer
    AND fixed_search_path
    AND authenticated_execute
    AND NOT anon_execute
    AND NOT public_execute
    AND contains_auth_uid_check
    AND contains_owner_check
    AND updates_only_is_eaten
    THEN 'YES' ELSE 'NO' END::text AS actual_summary
FROM readiness;
