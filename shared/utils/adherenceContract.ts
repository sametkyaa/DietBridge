/**
 * Canonical meal-adherence calculation shared by analytics and client views.
 * Counts are deliberately validated so malformed data never becomes a
 * fabricated percentage.
 */
export const calculateAdherencePercentage = (
  completed: number,
  planned: number,
): number | null => {
  if (
    !Number.isSafeInteger(completed)
    || !Number.isSafeInteger(planned)
    || completed < 0
    || planned < 0
    || completed > planned
  ) {
    return null;
  }

  return planned === 0 ? null : (completed / planned) * 100;
};
