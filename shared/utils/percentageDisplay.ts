const percentageDisplayFormatter = new Intl.NumberFormat('tr-TR', {
  maximumFractionDigits: 0,
});

/**
 * Formats a compliance value for visible UI text without changing the raw metric.
 * Invalid values stay fail-closed instead of becoming misleading percentages.
 */
export const formatPercentageDisplay = (value: number | null | undefined): string => (
  value === null || value === undefined || !Number.isFinite(value)
    ? 'Veri yok'
    : `%${percentageDisplayFormatter.format(value)}`
);
