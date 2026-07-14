function rowIds(rows) {
  return Array.isArray(rows) ? rows.map((row) => row?.id).filter(Boolean) : [];
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function evaluateOwnMealSelection({
  error,
  rows,
  ownMealId,
  foreignMealId,
  adminOwnMeal,
  adminForeignMeal,
}) {
  const ids = rowIds(rows);
  const fixturesExist = adminOwnMeal?.id === ownMealId && adminForeignMeal?.id === foreignMealId;
  const ok = !error
    && fixturesExist
    && ids.length === 1
    && ids[0] === ownMealId
    && !ids.includes(foreignMealId);

  return {
    ok,
    actual: error
      ? 'query error; admin fixtures verified'
      : ok
        ? 'own meal visible; foreign meal hidden; admin fixtures verified'
        : 'unexpected meal visibility; admin fixtures checked',
  };
}

export function evaluateForeignMealSelection({
  error,
  rows,
  foreignMealId,
  adminBefore,
  adminAfter,
}) {
  const ids = rowIds(rows);
  const fixtureUnchanged = adminBefore?.id === foreignMealId
    && adminAfter?.id === foreignMealId
    && stableSerialize(adminBefore) === stableSerialize(adminAfter);
  const ok = !error && ids.length === 0 && fixtureUnchanged;

  return {
    ok,
    actual: error
      ? 'query error; admin fixture checked'
      : ok
        ? '0 rows; foreign fixture unchanged by admin verification'
        : 'foreign visibility or fixture integrity mismatch',
  };
}

export function evaluateDietitianMealUpdate({
  updateError,
  updatedRows,
  targetMealId,
  testTitle,
  adminAfterUpdate,
  originalTitle,
  restoreError,
  restoredRows,
  adminAfterRestore,
}) {
  const updated = Array.isArray(updatedRows)
    && updatedRows.length === 1
    && updatedRows[0]?.id === targetMealId
    && updatedRows[0]?.title === testTitle;
  const persisted = adminAfterUpdate?.id === targetMealId && adminAfterUpdate?.title === testTitle;
  const restored = !restoreError
    && Array.isArray(restoredRows)
    && restoredRows.length === 1
    && restoredRows[0]?.id === targetMealId
    && restoredRows[0]?.title === originalTitle
    && adminAfterRestore?.id === targetMealId
    && adminAfterRestore?.title === originalTitle;
  const ok = !updateError && updated && persisted && restored;

  return {
    ok,
    actual: ok
      ? 'dietitian update persisted; original title restored and verified'
      : 'dietitian update or restore physical verification failed',
  };
}

export function classifyHarnessExitCode({
  cleanupFailed,
  securityFailures,
  deferredBlockers,
  functionalBlockers,
  currentExitCode = 0,
}) {
  if (cleanupFailed) return 20;
  if (securityFailures) return 11;
  if (deferredBlockers) return 10;
  if (functionalBlockers) return 12;
  return currentExitCode;
}
