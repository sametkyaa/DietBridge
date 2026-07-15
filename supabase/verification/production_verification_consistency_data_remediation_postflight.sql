-- DietBridge production verification consistency remediation postflight.
-- READ ONLY: aggregate counts only; no application row or identifier is returned.

WITH verification_counts AS (
  SELECT
    count(*) FILTER (
      WHERE verification_status IS NULL
         OR verification_status NOT IN ('pending', 'approved', 'rejected')
         OR is_verified IS DISTINCT FROM (verification_status = 'approved')
    ) AS inconsistent_count,
    count(*) FILTER (
      WHERE verification_status = 'approved'
        AND is_verified IS TRUE
    ) AS approved_true_count,
    count(*) FILTER (
      WHERE verification_status = 'pending'
        AND is_verified IS TRUE
    ) AS pending_true_count,
    count(*) FILTER (
      WHERE verification_status = 'pending'
        AND is_verified IS FALSE
    ) AS pending_false_count
  FROM public.dietitian_profiles
),
results(sequence_no, check_id, object_name, status) AS (
  SELECT 10, 'VERIFICATION_INCONSISTENT_ROWS', 'aggregate count', inconsistent_count::text
  FROM verification_counts

  UNION ALL
  SELECT 20, 'VERIFICATION_APPROVED_TRUE_ROWS', 'aggregate count', approved_true_count::text
  FROM verification_counts

  UNION ALL
  SELECT 30, 'VERIFICATION_PENDING_TRUE_ROWS', 'aggregate count', pending_true_count::text
  FROM verification_counts

  UNION ALL
  SELECT 40, 'VERIFICATION_PENDING_FALSE_ROWS', 'aggregate count', pending_false_count::text
  FROM verification_counts

  UNION ALL
  SELECT
    999,
    'FINAL_GATE',
    'DATA_REMEDIATION_APPLIED_SUCCESSFULLY',
    CASE
      WHEN inconsistent_count = 0 AND pending_true_count = 0 THEN 'YES'
      ELSE 'NO'
    END
  FROM verification_counts
)
SELECT check_id, object_name, status
FROM results
ORDER BY sequence_no, check_id;
