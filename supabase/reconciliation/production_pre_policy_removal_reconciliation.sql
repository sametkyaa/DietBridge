-- DietBridge production pre-policy reconciliation package.
-- MANUAL EXECUTION ONLY after the separately approved read-only preflight returns YES.
-- This package is intentionally outside supabase/migrations and does not touch migration history.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Fail fast before any canonical change.
DO $preconditions$
DECLARE
  v_count bigint;
  v_function record;
  v_policy record;
  v_actual record;
  v_expression text;
  v_fragment text;
BEGIN
  IF to_regclass('public.profiles') IS NULL
     OR to_regclass('public.dietitian_profiles') IS NULL
     OR to_regclass('public.appointments') IS NULL
     OR to_regclass('public.chat_messages') IS NULL
     OR to_regclass('public.meals') IS NULL
     OR to_regclass('public.meal_plans') IS NULL THEN
    RAISE EXCEPTION 'Required public table contract is missing; reconciliation stopped.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES
      ('public.handle_new_user()'),
      ('public.protect_profile_system_fields()'),
      ('public.save_my_current_weight(numeric)'),
      ('public.set_profiles_updated_at()'),
      ('public.is_current_user_dietitian()')
    ) AS required(signature)
    WHERE to_regprocedure(required.signature) IS NULL
  ) THEN
    RAISE EXCEPTION 'Required function signature is missing; reconciliation stopped.';
  END IF;

  FOR v_function IN
    SELECT *
    FROM (VALUES
      ('public.handle_new_user()', true, 'trigger', ARRAY['e3cafd1cb6ee0f6fb78542d22b8984ba','65164cc6aed446272beabf721d44bd93']::text[], ARRAY['search_path=public, pg_temp','search_path=pg_catalog, public']::text[]),
      ('public.protect_profile_system_fields()', false, 'trigger', ARRAY['d23346619753f0334ad8e518a6cf7628']::text[], ARRAY['search_path=public','search_path=pg_catalog, public']::text[]),
      ('public.save_my_current_weight(numeric)', true, 'jsonb', ARRAY['f7caf0c59ea4ea12d8b5558799564ada']::text[], ARRAY['search_path=public, pg_temp','search_path=pg_catalog, public']::text[]),
      ('public.set_profiles_updated_at()', false, 'trigger', ARRAY['9b1889f56258bf9d6554213c05019c76']::text[], ARRAY['search_path=public','search_path=pg_catalog, public']::text[])
    ) AS expected(signature, security_definer, result_type, allowed_body_md5s, allowed_paths)
  LOOP
    SELECT
      p.prosecdef,
      pg_catalog.pg_get_function_result(p.oid) AS result_type,
      r.rolname AS owner_name,
      pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10))) AS body_md5,
      p.proconfig
    INTO STRICT v_actual
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
    WHERE p.oid = to_regprocedure(v_function.signature);

    IF v_actual.prosecdef <> v_function.security_definer
       OR v_actual.result_type <> v_function.result_type
       OR v_actual.owner_name <> 'postgres'
       OR NOT (v_actual.body_md5 = ANY (v_function.allowed_body_md5s))
       OR pg_catalog.cardinality(coalesce(v_actual.proconfig, ARRAY[]::text[])) <> 1
       OR NOT EXISTS (
         SELECT 1
         FROM pg_catalog.unnest(coalesce(v_actual.proconfig, ARRAY[]::text[])) AS config(value)
         WHERE config.value = ANY (v_function.allowed_paths)
       ) THEN
      RAISE EXCEPTION 'Unexpected function drift for %; reconciliation stopped.', v_function.signature;
    END IF;
  END LOOP;

  IF to_regprocedure('public.sync_dietitian_verification_fields()') IS NOT NULL THEN
    SELECT
      p.oid,
      p.proacl,
      p.proowner,
      p.prosecdef,
      pg_catalog.pg_get_function_result(p.oid) AS result_type,
      r.rolname AS owner_name,
      pg_catalog.lower(p.prosrc) AS body_text,
      p.proconfig
    INTO STRICT v_actual
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
    WHERE p.oid = to_regprocedure('public.sync_dietitian_verification_fields()');

    IF v_actual.prosecdef
       OR v_actual.result_type <> 'trigger'
       OR v_actual.owner_name <> 'postgres'
       OR position('new.verification_status not in (''pending'', ''approved'', ''rejected'')' IN v_actual.body_text) = 0
       OR position('new.verified_at is distinct from old.verified_at' IN v_actual.body_text) = 0
       OR position('new.rejection_reason is distinct from old.rejection_reason' IN v_actual.body_text) = 0
       OR position('new.is_verified := (new.verification_status = ''approved'')' IN v_actual.body_text) = 0
       OR position('return new' IN v_actual.body_text) = 0
       OR position('approved_at' IN v_actual.body_text) > 0
       OR pg_catalog.cardinality(coalesce(v_actual.proconfig, ARRAY[]::text[])) <> 1
       OR NOT ('search_path=pg_catalog, public' = ANY (coalesce(v_actual.proconfig, ARRAY[]::text[])))
       OR (
         SELECT count(*)
         FROM pg_catalog.unnest(coalesce(v_actual.proconfig, ARRAY[]::text[])) AS config(value)
         WHERE config.value LIKE 'search_path=%'
       ) <> 1
       OR has_function_privilege('anon', v_actual.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', v_actual.oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(coalesce(v_actual.proacl, pg_catalog.acldefault('f', v_actual.proowner))) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Existing verification sync function differs from the canonical contract; reconciliation stopped.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = to_regclass('public.dietitian_profiles')
      AND tgname = 'trg_sync_dietitian_verification_fields'
      AND NOT tgisinternal
  ) AND NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = to_regclass('public.dietitian_profiles')
      AND tgname = 'trg_sync_dietitian_verification_fields'
      AND NOT tgisinternal
      AND tgenabled <> 'D'
      AND tgtype = 23
      AND tgfoid = to_regprocedure('public.sync_dietitian_verification_fields()')
  ) THEN
    RAISE EXCEPTION 'Existing verification sync trigger differs from the canonical contract; reconciliation stopped.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = to_regclass('public.meals')
      AND conname = 'meals_plan_id_fkey'
      AND contype = 'f'
  ) THEN
    RAISE EXCEPTION 'Required meals plan ownership constraint is missing; reconciliation stopped.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS t
    JOIN pg_catalog.pg_class AS c ON c.oid = t.tgrelid
    JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'auth'
      AND c.relname = 'users'
      AND t.tgname = 'on_auth_user_created'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
      AND t.tgfoid = to_regprocedure('public.handle_new_user()')
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS t
    WHERE t.tgrelid = to_regclass('public.profiles')
      AND t.tgname = 'trg_profiles_updated_at'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
      AND t.tgfoid = to_regprocedure('public.set_profiles_updated_at()')
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger AS t
    WHERE t.tgrelid = to_regclass('public.profiles')
      AND t.tgname = 'trg_protect_profile_system_fields'
      AND NOT t.tgisinternal
      AND t.tgenabled <> 'D'
      AND t.tgfoid = to_regprocedure('public.protect_profile_system_fields()')
  ) THEN
    RAISE EXCEPTION 'Required trigger contract is missing or drifted; reconciliation stopped.';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.dietitian_profiles
  WHERE verification_status IS NULL
     OR verification_status NOT IN ('pending', 'approved', 'rejected')
     OR is_verified IS DISTINCT FROM (verification_status = 'approved');

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Verification consistency check found % incompatible rows; no row was changed.', v_count;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.appointments
  WHERE dietitian_id IS NULL OR client_id IS NULL;

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Appointment ownership check found % incompatible rows; no row was changed.', v_count;
  END IF;

  SELECT count(*)
  INTO v_count
  FROM pg_catalog.pg_constraint AS con
  WHERE con.conrelid = to_regclass('public.dietitian_profiles')
    AND con.conname = 'dietitian_profiles_verification_consistency_check'
    AND con.contype = 'c'
    AND con.convalidated
    AND position('is_verified is not distinct from' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
    AND position('verification_status' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
    AND position('approved' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = to_regclass('public.dietitian_profiles')
      AND conname = 'dietitian_profiles_verification_consistency_check'
  ) AND v_count <> 1 THEN
    RAISE EXCEPTION 'Verification consistency constraint exists with unexpected semantics; reconciliation stopped.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace
    WHERE nspname = 'supabase_migrations'
  ) OR to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration history state differs from the audited starting contract; reconciliation stopped.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS p
    JOIN pg_catalog.pg_roles AS r ON r.rolname = 'authenticated'
    WHERE p.polrelid = to_regclass('public.meals')
      AND p.polname = 'Clients can update own meal completion'
      AND p.polcmd = 'w'
      AND p.polroles = ARRAY[r.oid]::oid[]
      AND p.polqual IS NOT NULL
      AND p.polwithcheck IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Required legacy client meal completion policy is missing or drifted; reconciliation stopped.';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM (VALUES
    ('meal_plans','Users can select own meal plans','r'),
    ('meal_plans','Dietitians can view own meal plans','r'),
    ('meals','Users can select own meal rows','r'),
    ('meals','Dietitians can update own meal rows','w')
  ) AS expected(table_name, policy_name, command_code)
  JOIN pg_catalog.pg_class AS c
    ON c.oid = to_regclass('public.' || expected.table_name)
  JOIN pg_catalog.pg_policy AS p
    ON p.polrelid = c.oid
   AND p.polname = expected.policy_name
   AND p.polcmd = expected.command_code
   AND p.polqual IS NOT NULL
  JOIN pg_catalog.pg_roles AS r
    ON r.rolname = 'authenticated'
   AND p.polroles = ARRAY[r.oid]::oid[];

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Extra policy inventory differs from the audited starting contract; reconciliation stopped.';
  END IF;

  IF to_regprocedure('public.set_my_meal_completion(uuid,boolean)') IS NOT NULL THEN
    SELECT
      p.oid,
      p.proacl,
      p.proowner,
      p.prosecdef,
      pg_catalog.pg_get_function_result(p.oid) AS result_type,
      r.rolname AS owner_name,
      pg_catalog.lower(p.prosrc) AS body_text,
      p.proconfig
    INTO STRICT v_actual
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
    WHERE p.oid = to_regprocedure('public.set_my_meal_completion(uuid,boolean)');

    IF NOT v_actual.prosecdef
       OR v_actual.result_type <> 'boolean'
       OR v_actual.owner_name <> 'postgres'
       OR position('v_user_id uuid := auth.uid()' IN v_actual.body_text) = 0
       OR position('update public.meals as m' IN v_actual.body_text) = 0
       OR position('set is_eaten = p_is_eaten' IN v_actual.body_text) = 0
       OR pg_catalog.regexp_count(v_actual.body_text, '\mset\M') <> 1
       OR position('from public.meal_plans as mp' IN v_actual.body_text) = 0
       OR position('mp.client_id = v_user_id' IN v_actual.body_text) = 0
       OR position('v_updated_count <> 1' IN v_actual.body_text) = 0
       OR position('return true' IN v_actual.body_text) = 0
       OR pg_catalog.cardinality(coalesce(v_actual.proconfig, ARRAY[]::text[])) <> 1
       OR NOT ('search_path=pg_catalog, public' = ANY (coalesce(v_actual.proconfig, ARRAY[]::text[])))
       OR (
         SELECT count(*)
         FROM pg_catalog.unnest(coalesce(v_actual.proconfig, ARRAY[]::text[])) AS config(value)
         WHERE config.value LIKE 'search_path=%'
       ) <> 1
       OR NOT has_function_privilege('authenticated', v_actual.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_actual.oid, 'EXECUTE')
       OR has_function_privilege('anon', v_actual.oid, 'EXECUTE')
       OR EXISTS (
         SELECT 1
         FROM pg_catalog.aclexplode(coalesce(v_actual.proacl, pg_catalog.acldefault('f', v_actual.proowner))) AS acl
         WHERE acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'Existing meal completion RPC differs from the canonical contract; reconciliation stopped.';
    END IF;
  END IF;

  FOR v_policy IN
    SELECT *
    FROM (VALUES
      ('dietitian_profiles','Dietitians can select own profile','r',true,false,ARRAY['user_id','auth.uid','profiles','dietitian']::text[]),
      ('dietitian_profiles','Clients can select active dietitian profile','r',true,false,ARRAY['dietitian_clients','dietitian_id','client_id','auth.uid','active']::text[]),
      ('dietitian_profiles','Dietitians can create own pending profile','a',false,true,ARRAY['user_id','auth.uid','profiles','dietitian']::text[]),
      ('dietitian_profiles','Dietitians can update own non-system profile fields','w',true,true,ARRAY['user_id','auth.uid','profiles','dietitian']::text[]),
      ('appointments','Dietitians can select active client appointments','r',true,false,ARRAY['dietitian_id','auth.uid','is_current_user_dietitian','dietitian_clients','client_id','active']::text[]),
      ('appointments','Clients can select own active appointments','r',true,false,ARRAY['client_id','auth.uid','profiles','client','dietitian_clients','dietitian_id','active']::text[]),
      ('appointments','Dietitians can create active client appointments','a',false,true,ARRAY['dietitian_id','auth.uid','is_current_user_dietitian','dietitian_clients','client_id','active']::text[]),
      ('appointments','Dietitians can update active client appointments','w',true,true,ARRAY['dietitian_id','auth.uid','is_current_user_dietitian','dietitian_clients','client_id','active']::text[]),
      ('appointments','Dietitians can delete active client appointments','d',true,false,ARRAY['dietitian_id','auth.uid','is_current_user_dietitian','dietitian_clients','client_id','active']::text[]),
      ('chat_messages','Participants can select active relationship messages','r',true,false,ARRAY['sender_id','receiver_id','auth.uid','dietitian_clients','dietitian_id','client_id','active']::text[]),
      ('chat_messages','Participants can send active relationship messages','a',false,true,ARRAY['sender_id','receiver_id','auth.uid','dietitian_clients','dietitian_id','client_id','active']::text[])
    ) AS expected(table_name, policy_name, command_code, using_required, check_required, semantic_fragments)
  LOOP
    SELECT
      p.oid,
      p.polcmd,
      p.polpermissive,
      p.polroles,
      p.polqual,
      p.polwithcheck,
      r.oid AS authenticated_oid
    INTO v_actual
    FROM pg_catalog.pg_policy AS p
    JOIN pg_catalog.pg_roles AS r ON r.rolname = 'authenticated'
    WHERE p.polrelid = to_regclass('public.' || v_policy.table_name)
      AND p.polname = v_policy.policy_name;

    IF FOUND THEN
      IF v_actual.polcmd <> v_policy.command_code
         OR NOT v_actual.polpermissive
         OR v_actual.polroles <> ARRAY[v_actual.authenticated_oid]::oid[]
         OR (v_actual.polqual IS NOT NULL) <> v_policy.using_required
         OR (v_actual.polwithcheck IS NOT NULL) <> v_policy.check_required THEN
        RAISE EXCEPTION 'Existing policy basic contract drifted for %.%; reconciliation stopped.', v_policy.table_name, v_policy.policy_name;
      END IF;

      v_expression := pg_catalog.lower(
        coalesce(pg_catalog.pg_get_expr(v_actual.polqual, to_regclass('public.' || v_policy.table_name)), '')
        || ' '
        || coalesce(pg_catalog.pg_get_expr(v_actual.polwithcheck, to_regclass('public.' || v_policy.table_name)), '')
      );

      FOREACH v_fragment IN ARRAY v_policy.semantic_fragments
      LOOP
        IF position(pg_catalog.lower(v_fragment) IN v_expression) = 0 THEN
          RAISE EXCEPTION 'Existing policy semantic contract drifted for %.%; reconciliation stopped.', v_policy.table_name, v_policy.policy_name;
        END IF;
      END LOOP;
    END IF;
  END LOOP;
END
$preconditions$;

-- Canonical function security hardening.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
declare
  v_account_type text;
  v_role public.user_role;
  v_full_name text;
  v_phone text;
begin
  v_account_type := lower(coalesce(nullif(new.raw_user_meta_data ->> 'account_type', ''), nullif(new.raw_user_meta_data ->> 'role', ''), ''));
  if v_account_type = 'client' then
    v_role := 'client'::public.user_role;
  elsif v_account_type = 'dietitian' then
    v_role := 'dietitian'::public.user_role;
  else
    raise exception 'Geçersiz hesap türü; yalnız client veya dietitian kabul edilir.' using errcode = '22023';
  end if;
  v_full_name := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', '')), '');
  v_phone := nullif(btrim(coalesce(new.raw_user_meta_data ->> 'phone', '')), '');

  insert into public.profiles (id, email, full_name, phone, role)
  values (new.id, new.email, v_full_name, v_phone, v_role)
  on conflict (id) do nothing;

  if v_role = 'client'::public.user_role then
    insert into public.client_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  else
    insert into public.dietitian_profiles (user_id, is_verified, verification_status, verified_at, rejection_reason)
    values (new.id, false, 'pending', null, null)
    on conflict (user_id) do nothing;
  end if;
  return new;
end;
$function$;

ALTER FUNCTION public.protect_profile_system_fields() SET search_path = pg_catalog, public;
ALTER FUNCTION public.save_my_current_weight(numeric) SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_profiles_updated_at() SET search_path = pg_catalog, public;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO service_role;
REVOKE EXECUTE ON FUNCTION public.protect_profile_system_fields() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.protect_profile_system_fields() TO service_role;
REVOKE EXECUTE ON FUNCTION public.save_my_current_weight(numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_my_current_weight(numeric) TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.set_profiles_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.set_profiles_updated_at() TO service_role;

-- Create the canonical verification mirror function only when it is missing.
DO $verification_function$
BEGIN
  IF to_regprocedure('public.sync_dietitian_verification_fields()') IS NULL THEN
    EXECUTE $ddl$
      CREATE FUNCTION public.sync_dietitian_verification_fields()
      RETURNS trigger
      LANGUAGE plpgsql
      SET search_path = pg_catalog, public
      AS $function$
begin
  if new.verification_status is null
     or new.verification_status not in ('pending', 'approved', 'rejected') then
    raise exception 'Geçersiz diyetisyen doğrulama durumu.' using errcode = '23514';
  end if;
  if auth.uid() is not null and auth.uid() = new.user_id then
    if tg_op = 'INSERT' then
      if new.verification_status is distinct from 'pending'
         or new.is_verified is distinct from false then
        raise exception 'Diyetisyen doğrulama alanları browser tarafından atanamaz.' using errcode = '42501';
      end if;
    elsif new.verification_status is distinct from old.verification_status
       or new.is_verified is distinct from old.is_verified
       or new.verified_at is distinct from old.verified_at
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception 'Diyetisyen doğrulama alanları browser tarafından değiştirilemez.' using errcode = '42501';
    end if;
  end if;
  new.is_verified := (new.verification_status = 'approved');
  return new;
end;
$function$
    $ddl$;
  END IF;
END
$verification_function$;

REVOKE EXECUTE ON FUNCTION public.sync_dietitian_verification_fields() FROM PUBLIC, anon, authenticated;

-- Create the canonical row-level verification trigger only when it is missing.
DO $verification_trigger$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = to_regclass('public.dietitian_profiles')
      AND tgname = 'trg_sync_dietitian_verification_fields'
      AND NOT tgisinternal
  ) THEN
    EXECUTE $ddl$
      CREATE TRIGGER trg_sync_dietitian_verification_fields
      BEFORE INSERT OR UPDATE ON public.dietitian_profiles
      FOR EACH ROW EXECUTE FUNCTION public.sync_dietitian_verification_fields()
    $ddl$;
  END IF;
END
$verification_trigger$;

-- Add the canonical validated constraint only when it is missing.
DO $constraint$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint
    WHERE conrelid = to_regclass('public.dietitian_profiles')
      AND conname = 'dietitian_profiles_verification_consistency_check'
  ) THEN
    EXECUTE $ddl$
      ALTER TABLE public.dietitian_profiles
        ADD CONSTRAINT dietitian_profiles_verification_consistency_check
        CHECK (is_verified IS NOT DISTINCT FROM (verification_status = 'approved'))
    $ddl$;
  END IF;
END
$constraint$;

-- Create only missing canonical policies. Existing names passed semantic preconditions above.
DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.dietitian_profiles') AND polname = 'Dietitians can select own profile') THEN
    EXECUTE $ddl$CREATE POLICY "Dietitians can select own profile" ON public.dietitian_profiles FOR SELECT TO authenticated
      USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'dietitian'))$ddl$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.dietitian_profiles') AND polname = 'Clients can select active dietitian profile') THEN
    EXECUTE $ddl$CREATE POLICY "Clients can select active dietitian profile" ON public.dietitian_profiles FOR SELECT TO authenticated
      USING (EXISTS (SELECT 1 FROM public.dietitian_clients dc WHERE dc.dietitian_id = dietitian_profiles.user_id AND dc.client_id = auth.uid() AND dc.status = 'active'))$ddl$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.dietitian_profiles') AND polname = 'Dietitians can create own pending profile') THEN
    EXECUTE $ddl$CREATE POLICY "Dietitians can create own pending profile" ON public.dietitian_profiles FOR INSERT TO authenticated
      WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'dietitian'))$ddl$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.dietitian_profiles') AND polname = 'Dietitians can update own non-system profile fields') THEN
    EXECUTE $ddl$CREATE POLICY "Dietitians can update own non-system profile fields" ON public.dietitian_profiles FOR UPDATE TO authenticated
      USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'dietitian'))
      WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'dietitian'))$ddl$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.appointments') AND polname = 'Dietitians can select active client appointments') THEN
    EXECUTE $ddl$CREATE POLICY "Dietitians can select active client appointments" ON public.appointments FOR SELECT TO authenticated
      USING (dietitian_id = auth.uid() AND public.is_current_user_dietitian() AND EXISTS (SELECT 1 FROM public.dietitian_clients dc WHERE dc.dietitian_id = appointments.dietitian_id AND dc.client_id = appointments.client_id AND dc.status = 'active'))$ddl$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.appointments') AND polname = 'Clients can select own active appointments') THEN
    EXECUTE $ddl$CREATE POLICY "Clients can select own active appointments" ON public.appointments FOR SELECT TO authenticated
      USING (client_id = auth.uid() AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'client') AND EXISTS (SELECT 1 FROM public.dietitian_clients dc WHERE dc.dietitian_id = appointments.dietitian_id AND dc.client_id = appointments.client_id AND dc.status = 'active'))$ddl$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.appointments') AND polname = 'Dietitians can create active client appointments') THEN
    EXECUTE $ddl$CREATE POLICY "Dietitians can create active client appointments" ON public.appointments FOR INSERT TO authenticated
      WITH CHECK (dietitian_id = auth.uid() AND public.is_current_user_dietitian() AND EXISTS (SELECT 1 FROM public.dietitian_clients dc WHERE dc.dietitian_id = appointments.dietitian_id AND dc.client_id = appointments.client_id AND dc.status = 'active'))$ddl$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.appointments') AND polname = 'Dietitians can update active client appointments') THEN
    EXECUTE $ddl$CREATE POLICY "Dietitians can update active client appointments" ON public.appointments FOR UPDATE TO authenticated
      USING (dietitian_id = auth.uid() AND public.is_current_user_dietitian() AND EXISTS (SELECT 1 FROM public.dietitian_clients dc WHERE dc.dietitian_id = appointments.dietitian_id AND dc.client_id = appointments.client_id AND dc.status = 'active'))
      WITH CHECK (dietitian_id = auth.uid() AND public.is_current_user_dietitian() AND EXISTS (SELECT 1 FROM public.dietitian_clients dc WHERE dc.dietitian_id = appointments.dietitian_id AND dc.client_id = appointments.client_id AND dc.status = 'active'))$ddl$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.appointments') AND polname = 'Dietitians can delete active client appointments') THEN
    EXECUTE $ddl$CREATE POLICY "Dietitians can delete active client appointments" ON public.appointments FOR DELETE TO authenticated
      USING (dietitian_id = auth.uid() AND public.is_current_user_dietitian() AND EXISTS (SELECT 1 FROM public.dietitian_clients dc WHERE dc.dietitian_id = appointments.dietitian_id AND dc.client_id = appointments.client_id AND dc.status = 'active'))$ddl$;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.chat_messages') AND polname = 'Participants can select active relationship messages') THEN
    EXECUTE $ddl$CREATE POLICY "Participants can select active relationship messages" ON public.chat_messages FOR SELECT TO authenticated
      USING ((sender_id = auth.uid() OR receiver_id = auth.uid()) AND EXISTS (SELECT 1 FROM public.dietitian_clients dc WHERE dc.status = 'active' AND ((dc.dietitian_id = chat_messages.sender_id AND dc.client_id = chat_messages.receiver_id) OR (dc.dietitian_id = chat_messages.receiver_id AND dc.client_id = chat_messages.sender_id))))$ddl$;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = to_regclass('public.chat_messages') AND polname = 'Participants can send active relationship messages') THEN
    EXECUTE $ddl$CREATE POLICY "Participants can send active relationship messages" ON public.chat_messages FOR INSERT TO authenticated
      WITH CHECK (sender_id = auth.uid() AND EXISTS (SELECT 1 FROM public.dietitian_clients dc WHERE dc.status = 'active' AND ((dc.dietitian_id = chat_messages.sender_id AND dc.client_id = chat_messages.receiver_id) OR (dc.dietitian_id = chat_messages.receiver_id AND dc.client_id = chat_messages.sender_id))))$ddl$;
  END IF;
END
$policies$;

ALTER TABLE public.dietitian_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Canonical meal completion RPC. Its body is stored here but is not invoked by this package.
CREATE OR REPLACE FUNCTION public.set_my_meal_completion(p_meal_id uuid, p_is_eaten boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
declare
  v_user_id uuid := auth.uid();
  v_updated_count integer;
begin
  if v_user_id is null or p_is_eaten is null then
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '42501';
  end if;
  update public.meals as m
  set is_eaten = p_is_eaten
  where m.id = p_meal_id
    and exists (select 1 from public.meal_plans as mp where mp.id = m.plan_id and mp.client_id = v_user_id);
  get diagnostics v_updated_count = row_count;
  if v_updated_count <> 1 then
    raise exception 'Öğün tamamlanma durumu güncellenemedi.' using errcode = '42501';
  end if;
  return true;
end;
$function$;

ALTER FUNCTION public.set_my_meal_completion(uuid, boolean) OWNER TO postgres;
REVOKE EXECUTE ON FUNCTION public.set_my_meal_completion(uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_my_meal_completion(uuid, boolean) TO authenticated, service_role;

-- Catalog postconditions. Any failure rolls the whole transaction back.
DO $postconditions$
DECLARE
  v_count bigint;
  v_function record;
  v_policy record;
  v_actual record;
  v_expression text;
  v_fragment text;
BEGIN
  FOR v_function IN
    SELECT *
    FROM (VALUES
      ('public.handle_new_user()', true, 'trigger', 'handle_new_user', ARRAY[]::text[], false, true),
      ('public.protect_profile_system_fields()', false, 'trigger', 'allowed_hash', ARRAY['d23346619753f0334ad8e518a6cf7628']::text[], false, true),
      ('public.save_my_current_weight(numeric)', true, 'jsonb', 'allowed_hash', ARRAY['f7caf0c59ea4ea12d8b5558799564ada']::text[], true, true),
      ('public.set_profiles_updated_at()', false, 'trigger', 'allowed_hash', ARRAY['9b1889f56258bf9d6554213c05019c76']::text[], false, true),
      ('public.set_my_meal_completion(uuid,boolean)', true, 'boolean', 'meal_completion', ARRAY[]::text[], true, true),
      ('public.sync_dietitian_verification_fields()', false, 'trigger', 'verification_sync', ARRAY[]::text[], false, NULL::boolean)
    ) AS expected(signature, security_definer, result_type, body_contract, allowed_body_md5s, authenticated_execute, service_role_execute)
  LOOP
    SELECT
      p.oid IS NOT NULL AS signature_present,
      coalesce(p.prosecdef = v_function.security_definer, false) AS security_matches,
      coalesce(pg_catalog.pg_get_function_result(p.oid) = v_function.result_type, false) AS result_type_matches,
      coalesce(r.rolname = 'postgres', false) AS owner_matches,
      coalesce(CASE v_function.body_contract
        WHEN 'handle_new_user' THEN
          position('new.raw_user_meta_data ->> ''account_type''' IN body.body_text) > 0
          AND position('new.raw_user_meta_data ->> ''role''' IN body.body_text) > 0
          AND position('v_account_type = ''client''' IN body.body_text) > 0
          AND position('v_account_type = ''dietitian''' IN body.body_text) > 0
          AND position('errcode = ''22023''' IN body.body_text) > 0
          AND position('insert into public.profiles' IN body.body_text) > 0
          AND position('insert into public.client_profiles' IN body.body_text) > 0
          AND position('insert into public.dietitian_profiles' IN body.body_text) > 0
          AND position('values (new.id, false, ''pending'', null, null)' IN body.body_text) > 0
          AND position('on conflict (id) do nothing' IN body.body_text) > 0
          AND position('on conflict (user_id) do nothing' IN body.body_text) > 0
          AND position('return new' IN body.body_text) > 0
        WHEN 'meal_completion' THEN
          position('v_user_id uuid := auth.uid()' IN body.body_text) > 0
          AND position('update public.meals as m' IN body.body_text) > 0
          AND position('set is_eaten = p_is_eaten' IN body.body_text) > 0
          AND pg_catalog.regexp_count(body.body_text, '\mset\M') = 1
          AND position('from public.meal_plans as mp' IN body.body_text) > 0
          AND position('mp.id = m.plan_id' IN body.body_text) > 0
          AND position('mp.client_id = v_user_id' IN body.body_text) > 0
          AND position('v_updated_count <> 1' IN body.body_text) > 0
          AND position('return true' IN body.body_text) > 0
        WHEN 'verification_sync' THEN
          position('new.verification_status not in (''pending'', ''approved'', ''rejected'')' IN body.body_text) > 0
          AND position('new.verified_at is distinct from old.verified_at' IN body.body_text) > 0
          AND position('new.rejection_reason is distinct from old.rejection_reason' IN body.body_text) > 0
          AND position('new.is_verified := (new.verification_status = ''approved'')' IN body.body_text) > 0
          AND position('return new' IN body.body_text) > 0
          AND position('approved_at' IN body.body_text) = 0
        WHEN 'allowed_hash' THEN
          pg_catalog.md5(pg_catalog.replace(p.prosrc, pg_catalog.chr(13) || pg_catalog.chr(10), pg_catalog.chr(10))) = ANY (v_function.allowed_body_md5s)
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
      ) AS search_path_matches,
      coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE') = v_function.authenticated_execute, false) AS authenticated_execute_matches,
      coalesce(
        v_function.service_role_execute IS NULL
        OR has_function_privilege('service_role', p.oid, 'EXECUTE') = v_function.service_role_execute,
        false
      ) AS service_role_execute_matches,
      coalesce(NOT has_function_privilege('anon', p.oid, 'EXECUTE'), false) AS anon_execute_matches,
      coalesce(
        p.oid IS NOT NULL AND NOT EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ),
        false
      ) AS public_execute_matches
    INTO v_actual
    FROM (SELECT 1) AS seed
    LEFT JOIN pg_catalog.pg_proc AS p ON p.oid = to_regprocedure(v_function.signature)
    LEFT JOIN pg_catalog.pg_roles AS r ON r.oid = p.proowner
    CROSS JOIN LATERAL (
      SELECT pg_catalog.lower(coalesce(p.prosrc, '')) AS body_text
    ) AS body;

    IF NOT v_actual.signature_present
       OR NOT v_actual.security_matches
       OR NOT v_actual.result_type_matches
       OR NOT v_actual.owner_matches
       OR NOT v_actual.body_contract_matches
       OR NOT v_actual.search_path_matches
       OR NOT v_actual.authenticated_execute_matches
       OR NOT v_actual.service_role_execute_matches
       OR NOT v_actual.anon_execute_matches
       OR NOT v_actual.public_execute_matches THEN
      RAISE EXCEPTION USING MESSAGE = pg_catalog.format(
        'Function postcondition failed for %s: signature_present=%s, security_matches=%s, result_type_matches=%s, owner_matches=%s, body_contract_matches=%s, search_path_matches=%s, authenticated_execute_matches=%s, service_role_execute_matches=%s, anon_execute_matches=%s, public_execute_matches=%s. Transaction rolled back.',
        v_function.signature,
        v_actual.signature_present,
        v_actual.security_matches,
        v_actual.result_type_matches,
        v_actual.owner_matches,
        v_actual.body_contract_matches,
        v_actual.search_path_matches,
        v_actual.authenticated_execute_matches,
        v_actual.service_role_execute_matches,
        v_actual.anon_execute_matches,
        v_actual.public_execute_matches
      );
    END IF;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_trigger
    WHERE tgrelid = to_regclass('public.dietitian_profiles')
      AND tgname = 'trg_sync_dietitian_verification_fields'
      AND NOT tgisinternal
      AND tgenabled <> 'D'
      AND tgtype = 23
      AND tgfoid = to_regprocedure('public.sync_dietitian_verification_fields()')
  ) THEN
    RAISE EXCEPTION 'Verification sync trigger postcondition failed; transaction rolled back.';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM public.dietitian_profiles
  WHERE verification_status IS NULL
     OR verification_status NOT IN ('pending', 'approved', 'rejected')
     OR is_verified IS DISTINCT FROM (verification_status = 'approved');

  IF v_count <> 0 THEN
    RAISE EXCEPTION 'Verification data postcondition found % incompatible rows; transaction rolled back.', v_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_constraint AS con
    WHERE con.conrelid = to_regclass('public.dietitian_profiles')
      AND con.conname = 'dietitian_profiles_verification_consistency_check'
      AND con.contype = 'c'
      AND con.convalidated
      AND position('is_verified is not distinct from' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
      AND position('verification_status' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
      AND position('approved' IN pg_catalog.lower(pg_catalog.pg_get_constraintdef(con.oid, true))) > 0
  ) THEN
    RAISE EXCEPTION 'Verification constraint postcondition failed; transaction rolled back.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (VALUES ('dietitian_profiles'),('appointments'),('chat_messages')) AS expected(table_name)
    LEFT JOIN pg_catalog.pg_class AS c ON c.oid = to_regclass('public.' || expected.table_name)
    WHERE c.oid IS NULL OR NOT c.relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS postcondition failed; transaction rolled back.';
  END IF;

  FOR v_policy IN
    SELECT *
    FROM (VALUES
      ('dietitian_profiles','Dietitians can select own profile','r',true,false,ARRAY['user_id','auth.uid','profiles','dietitian']::text[]),
      ('dietitian_profiles','Clients can select active dietitian profile','r',true,false,ARRAY['dietitian_clients','dietitian_id','client_id','auth.uid','active']::text[]),
      ('dietitian_profiles','Dietitians can create own pending profile','a',false,true,ARRAY['user_id','auth.uid','profiles','dietitian']::text[]),
      ('dietitian_profiles','Dietitians can update own non-system profile fields','w',true,true,ARRAY['user_id','auth.uid','profiles','dietitian']::text[]),
      ('appointments','Dietitians can select active client appointments','r',true,false,ARRAY['dietitian_id','auth.uid','is_current_user_dietitian','dietitian_clients','client_id','active']::text[]),
      ('appointments','Clients can select own active appointments','r',true,false,ARRAY['client_id','auth.uid','profiles','client','dietitian_clients','dietitian_id','active']::text[]),
      ('appointments','Dietitians can create active client appointments','a',false,true,ARRAY['dietitian_id','auth.uid','is_current_user_dietitian','dietitian_clients','client_id','active']::text[]),
      ('appointments','Dietitians can update active client appointments','w',true,true,ARRAY['dietitian_id','auth.uid','is_current_user_dietitian','dietitian_clients','client_id','active']::text[]),
      ('appointments','Dietitians can delete active client appointments','d',true,false,ARRAY['dietitian_id','auth.uid','is_current_user_dietitian','dietitian_clients','client_id','active']::text[]),
      ('chat_messages','Participants can select active relationship messages','r',true,false,ARRAY['sender_id','receiver_id','auth.uid','dietitian_clients','dietitian_id','client_id','active']::text[]),
      ('chat_messages','Participants can send active relationship messages','a',false,true,ARRAY['sender_id','receiver_id','auth.uid','dietitian_clients','dietitian_id','client_id','active']::text[])
    ) AS expected(table_name, policy_name, command_code, using_required, check_required, semantic_fragments)
  LOOP
    SELECT
      p.oid,
      p.polcmd,
      p.polpermissive,
      p.polroles,
      p.polqual,
      p.polwithcheck,
      r.oid AS authenticated_oid
    INTO v_actual
    FROM pg_catalog.pg_policy AS p
    JOIN pg_catalog.pg_roles AS r ON r.rolname = 'authenticated'
    WHERE p.polrelid = to_regclass('public.' || v_policy.table_name)
      AND p.polname = v_policy.policy_name;

    IF NOT FOUND
       OR v_actual.polcmd <> v_policy.command_code
       OR NOT v_actual.polpermissive
       OR v_actual.polroles <> ARRAY[v_actual.authenticated_oid]::oid[]
       OR (v_actual.polqual IS NOT NULL) <> v_policy.using_required
       OR (v_actual.polwithcheck IS NOT NULL) <> v_policy.check_required THEN
      RAISE EXCEPTION 'Policy postcondition failed for %.%; transaction rolled back.', v_policy.table_name, v_policy.policy_name;
    END IF;

    v_expression := pg_catalog.lower(
      coalesce(pg_catalog.pg_get_expr(v_actual.polqual, to_regclass('public.' || v_policy.table_name)), '')
      || ' '
      || coalesce(pg_catalog.pg_get_expr(v_actual.polwithcheck, to_regclass('public.' || v_policy.table_name)), '')
    );
    FOREACH v_fragment IN ARRAY v_policy.semantic_fragments
    LOOP
      IF position(pg_catalog.lower(v_fragment) IN v_expression) = 0 THEN
        RAISE EXCEPTION 'Policy semantic postcondition failed for %.%; transaction rolled back.', v_policy.table_name, v_policy.policy_name;
      END IF;
    END LOOP;
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policy AS p
    JOIN pg_catalog.pg_roles AS r ON r.rolname = 'authenticated'
    WHERE p.polrelid = to_regclass('public.meals')
      AND p.polname = 'Clients can update own meal completion'
      AND p.polcmd = 'w'
      AND p.polroles = ARRAY[r.oid]::oid[]
      AND p.polqual IS NOT NULL
      AND p.polwithcheck IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Legacy policy preservation postcondition failed; transaction rolled back.';
  END IF;

  SELECT count(*)
  INTO v_count
  FROM (VALUES
    ('meal_plans','Users can select own meal plans','r'),
    ('meal_plans','Dietitians can view own meal plans','r'),
    ('meals','Users can select own meal rows','r'),
    ('meals','Dietitians can update own meal rows','w')
  ) AS expected(table_name, policy_name, command_code)
  JOIN pg_catalog.pg_policy AS p
    ON p.polrelid = to_regclass('public.' || expected.table_name)
   AND p.polname = expected.policy_name
   AND p.polcmd = expected.command_code
   AND p.polqual IS NOT NULL
  JOIN pg_catalog.pg_roles AS r
    ON r.rolname = 'authenticated'
   AND p.polroles = ARRAY[r.oid]::oid[];

  IF v_count <> 4 THEN
    RAISE EXCEPTION 'Extra policy preservation postcondition failed; transaction rolled back.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_namespace
    WHERE nspname = 'supabase_migrations'
  ) OR to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
    RAISE EXCEPTION 'Migration history preservation postcondition failed; transaction rolled back.';
  END IF;
END
$postconditions$;

COMMIT;
