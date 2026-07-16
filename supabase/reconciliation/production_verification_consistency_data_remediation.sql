-- DietBridge production verification consistency data remediation.
-- MANUAL EXECUTION ONLY after DATA_REMEDIATION_READY=YES and separate approval.
-- This transaction changes only the canonical is_verified mirror for one audited row.

BEGIN;

SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $preconditions$
DECLARE
  v_inconsistent_count bigint;
  v_pending_true_count bigint;
  v_other_inconsistent_count bigint;
BEGIN
  IF to_regclass('public.dietitian_profiles') IS NULL THEN
    RAISE EXCEPTION 'Required dietitian_profiles table is missing; remediation stopped.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = to_regclass('public.dietitian_profiles')
      AND a.attname = 'is_verified'
      AND a.atttypid = 'pg_catalog.bool'::pg_catalog.regtype
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_attribute AS a
    WHERE a.attrelid = to_regclass('public.dietitian_profiles')
      AND a.attname = 'verification_status'
      AND a.atttypid = 'pg_catalog.text'::pg_catalog.regtype
      AND a.attnum > 0
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION 'Verification column contract is missing or drifted; remediation stopped.';
  END IF;

  IF to_regprocedure('public.sync_dietitian_verification_fields()') IS NOT NULL
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_trigger
       WHERE tgrelid = to_regclass('public.dietitian_profiles')
         AND tgname = 'trg_sync_dietitian_verification_fields'
         AND NOT tgisinternal
     )
     OR EXISTS (
       SELECT 1
       FROM pg_catalog.pg_constraint
       WHERE conrelid = to_regclass('public.dietitian_profiles')
         AND conname = 'dietitian_profiles_verification_consistency_check'
     ) THEN
    RAISE EXCEPTION 'Verification schema state differs from the audited remediation starting state.';
  END IF;

  SELECT
    count(*) FILTER (
      WHERE verification_status IS NULL
         OR verification_status NOT IN ('pending', 'approved', 'rejected')
         OR is_verified IS DISTINCT FROM (verification_status = 'approved')
    ),
    count(*) FILTER (
      WHERE is_verified IS TRUE
        AND verification_status = 'pending'
    ),
    count(*) FILTER (
      WHERE (
        verification_status IS NULL
        OR verification_status NOT IN ('pending', 'approved', 'rejected')
        OR is_verified IS DISTINCT FROM (verification_status = 'approved')
      )
      AND NOT (is_verified IS TRUE AND verification_status = 'pending')
    )
  INTO v_inconsistent_count, v_pending_true_count, v_other_inconsistent_count
  FROM public.dietitian_profiles;

  IF v_inconsistent_count <> 1
     OR v_pending_true_count <> 1
     OR v_other_inconsistent_count <> 0 THEN
    RAISE EXCEPTION
      'Verification remediation precondition failed: inconsistent=%, pending_true=%, other_inconsistent=%.',
      v_inconsistent_count,
      v_pending_true_count,
      v_other_inconsistent_count;
  END IF;
END
$preconditions$;

DO $remediation$
DECLARE
  v_updated_count bigint;
  v_inconsistent_after bigint;
  v_pending_true_after bigint;
  v_approved_true_before bigint;
  v_approved_true_after bigint;
BEGIN
  SELECT count(*)
  INTO v_approved_true_before
  FROM public.dietitian_profiles
  WHERE verification_status = 'approved'
    AND is_verified IS TRUE;

  UPDATE public.dietitian_profiles
  SET is_verified = (verification_status = 'approved')
  WHERE is_verified IS DISTINCT FROM (verification_status = 'approved')
    AND is_verified IS TRUE
    AND verification_status = 'pending';

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  IF v_updated_count <> 1 THEN
    RAISE EXCEPTION 'Verification remediation changed % rows; expected exactly 1.', v_updated_count;
  END IF;

  SELECT
    count(*) FILTER (
      WHERE verification_status IS NULL
         OR verification_status NOT IN ('pending', 'approved', 'rejected')
         OR is_verified IS DISTINCT FROM (verification_status = 'approved')
    ),
    count(*) FILTER (
      WHERE is_verified IS TRUE
        AND verification_status = 'pending'
    ),
    count(*) FILTER (
      WHERE verification_status = 'approved'
        AND is_verified IS TRUE
    )
  INTO v_inconsistent_after, v_pending_true_after, v_approved_true_after
  FROM public.dietitian_profiles;

  IF v_inconsistent_after <> 0
     OR v_pending_true_after <> 0
     OR v_approved_true_after <> v_approved_true_before THEN
    RAISE EXCEPTION
      'Verification remediation postcondition failed: inconsistent=%, pending_true=%, approved_true_delta=%.',
      v_inconsistent_after,
      v_pending_true_after,
      v_approved_true_after - v_approved_true_before;
  END IF;
END
$remediation$;

COMMIT;
