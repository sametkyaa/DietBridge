import type { AnalyticsDateRange, ClientAnalyticsReport } from '../types/analytics';
import { addAnalyticsDays } from './analyticsContract';
import {
  ANALYTICS_MEAL_TYPE_LABELS,
  BODY_FIELD_LABELS,
  RANGE_LABELS,
  formatDate,
  formatNumber,
  formatPercentage,
  formatPeriodLabel,
  formatPointDelta,
  formatRangeLabel,
  formatShortDate,
  formatSignedLiters,
  formatSignedWeight,
} from './analyticsFormat';

/** Adherence deltas smaller than this are not reported as a change. */
export const ADHERENCE_CHANGE_THRESHOLD = 5;
/** A meal type needs at least this many planned meals to be called the weakest. */
export const WEAKEST_MEAL_TYPE_MIN_PLANNED = 3;
/** A measurement older than this many days is flagged in the insights. */
export const MEASUREMENT_STALE_DAYS = 14;

/**
 * The "now" that makes resolveAnalyticsDateRange return the period right
 * before the given range (same range key). Null for "Tüm Zamanlar".
 */
export const getPreviousPeriodNow = (range: AnalyticsDateRange): Date | null => {
  if (range.startDate === null) return null;
  const previousEnd = addAnalyticsDays(range.startDate, -1);
  // 09:00 UTC is 12:00 in Istanbul, safely inside the intended civil day.
  return new Date(`${previousEnd}T09:00:00Z`);
};

const periodWeightChange = (report: ClientAnalyticsReport): number | null => {
  const points = report.weightTrend;
  if (points.length < 2) return null;
  return Math.round((points[points.length - 1].value - points[0].value) * 10) / 10;
};

export interface AnalyticsComparison {
  previousRange: AnalyticsDateRange;
  adherence: { current: number | null; previous: number | null; delta: number | null };
  water: { current: number | null; previous: number | null; delta: number | null };
  weight: { current: number | null; previous: number | null };
}

export const compareAnalyticsReports = (
  current: ClientAnalyticsReport,
  previous: ClientAnalyticsReport,
): AnalyticsComparison => {
  const adherenceCurrent = current.kpis.mealAdherencePercentage;
  const adherencePrevious = previous.kpis.mealAdherencePercentage;
  const waterCurrent = current.kpis.water.averageLiters;
  const waterPrevious = previous.kpis.water.averageLiters;
  return {
    previousRange: previous.range,
    adherence: {
      current: adherenceCurrent,
      previous: adherencePrevious,
      delta: adherenceCurrent !== null && adherencePrevious !== null ? adherenceCurrent - adherencePrevious : null,
    },
    water: {
      current: waterCurrent,
      previous: waterPrevious,
      delta: waterCurrent !== null && waterPrevious !== null ? waterCurrent - waterPrevious : null,
    },
    weight: { current: periodWeightChange(current), previous: periodWeightChange(previous) },
  };
};

export type InsightTone = 'ok' | 'warn' | 'info';

export interface AnalyticsInsight {
  key: string;
  tone: InsightTone;
  text: string;
}

const daysBetween = (from: string, to: string): number => (
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000)
);

/**
 * Plain-language observations built only from values on the screen. Nothing
 * is estimated; an insight appears only when its inputs exist.
 */
export const deriveAnalyticsInsights = (
  report: ClientAnalyticsReport,
  comparison: AnalyticsComparison | null,
): AnalyticsInsight[] => {
  const insights: AnalyticsInsight[] = [];
  const { kpis } = report;

  const delta = comparison?.adherence.delta ?? null;
  if (comparison && delta !== null && Math.abs(delta) >= ADHERENCE_CHANGE_THRESHOLD) {
    insights.push({
      key: 'adherence-change',
      tone: delta > 0 ? 'ok' : 'warn',
      text: `Öğün uyumu önceki döneme göre ${Math.abs(Math.round(delta))} puan ${delta > 0 ? 'arttı' : 'azaldı'} (${formatPercentage(comparison.adherence.previous)} → ${formatPercentage(comparison.adherence.current)}).`,
    });
  }

  const overall = kpis.mealAdherencePercentage;
  const weakest = report.mealTypeAdherence
    .filter((item) => item.planned >= WEAKEST_MEAL_TYPE_MIN_PLANNED && item.percentage !== null)
    .sort((left, right) => (left.percentage as number) - (right.percentage as number))[0];
  if (weakest && overall !== null && (weakest.percentage as number) <= overall - 10) {
    insights.push({
      key: 'weakest-meal-type',
      tone: 'warn',
      text: `En düşük uyum ${ANALYTICS_MEAL_TYPE_LABELS[weakest.type]} türünde: ${formatPercentage(weakest.percentage)} (${weakest.completed}/${weakest.planned}); genel uyum ${formatPercentage(overall)}.`,
    });
  }

  const missedDays = report.mealDayMatrix.dayTotals.filter((day) => day.planned > 0 && day.completed === 0 && day.date !== report.range.endDate);
  if (missedDays.length >= 2) {
    insights.push({
      key: 'missed-days',
      tone: 'warn',
      text: `Son ${report.mealDayMatrix.dates.length} günde ${missedDays.length} gün hiç öğün işaretlenmedi (${missedDays.slice(-3).map((day) => formatShortDate(day.date)).join(', ')}).`,
    });
  }

  const water = kpis.water;
  if (water.goalAchievementPercentage !== null && water.goalEligibleDays > 0) {
    insights.push({
      key: 'water-goal',
      tone: water.goalAchievementPercentage >= 70 ? 'ok' : 'info',
      text: `Su hedefine (${formatNumber(water.goalLiters, ' L')}) kayıtlı ${water.goalEligibleDays} günün ${water.achievedGoalDays} gününde ulaşıldı.`,
    });
  }

  const periodChange = comparison?.weight.current ?? (report.weightTrend.length >= 2
    ? Math.round((report.weightTrend[report.weightTrend.length - 1].value - report.weightTrend[0].value) * 10) / 10
    : null);
  if (periodChange !== null && kpis.targetGap !== null && kpis.targetGap !== 0 && periodChange !== 0) {
    const towardGoal = Math.sign(periodChange) === -Math.sign(kpis.targetGap);
    insights.push({
      key: 'weight-direction',
      tone: towardGoal ? 'ok' : 'warn',
      text: `Bu dönemde kilo ${formatSignedWeight(periodChange)} değişti; ${towardGoal ? 'hedefe doğru ilerliyor' : 'hedeften uzaklaşıyor'} (hedefe ${formatNumber(Math.abs(kpis.targetGap), ' kg')}).`,
    });
  }

  if (kpis.lastMeasurementDate) {
    const age = daysBetween(kpis.lastMeasurementDate, report.range.endDate);
    if (age > MEASUREMENT_STALE_DAYS) {
      insights.push({ key: 'measurement-stale', tone: 'info', text: `Son ölçüm ${age} gün önce (${formatDate(kpis.lastMeasurementDate)}); yeni ölçüm planlanabilir.` });
    }
  }

  const calories = report.plannedNutrition.calories;
  if (calories.totalMeals > 0 && !calories.isComplete) {
    insights.push({
      key: 'calorie-gaps',
      tone: 'info',
      text: `Planlanan ${calories.totalMeals} öğünün ${calories.totalMeals - calories.coveredMeals} tanesinde kalori bilgisi yok; kalori toplamı eksik veriyle hesaplanmaz.`,
    });
  }

  return insights;
};

export type ExportCell = string | number | null;
export interface ExportSheet {
  name: string;
  rows: ExportCell[][];
}

/**
 * The XLSX export of the Analytics page. Every cell uses the same formatter
 * as the screen, so exported values match what the dietitian sees.
 */
export const buildAnalyticsExportSheets = (
  clientName: string,
  report: ClientAnalyticsReport,
  comparison: AnalyticsComparison | null,
  insights: readonly AnalyticsInsight[],
): ExportSheet[] => {
  const { kpis } = report;
  const summary: ExportCell[][] = [
    ['Danışan', clientName],
    ['Dönem', `${RANGE_LABELS[report.range.key]} · ${formatRangeLabel(report.range)}`],
    [],
    ['Gösterge', 'Değer', 'Önceki dönem', 'Fark'],
    ['Güncel kilo', formatNumber(kpis.currentWeight, ' kg'), null, null],
    ['Başlangıca göre değişim', formatSignedWeight(kpis.weightChange), null, null],
    ['Dönem içi kilo değişimi', formatSignedWeight(comparison?.weight.current ?? null), formatSignedWeight(comparison?.weight.previous ?? null), null],
    ['Hedef kilo', formatNumber(kpis.targetWeight, ' kg'), null, null],
    ['Öğün uyumu', formatPercentage(kpis.mealAdherencePercentage), comparison ? formatPercentage(comparison.adherence.previous) : null, comparison ? formatPointDelta(comparison.adherence.delta) : null],
    ['Tamamlanan / planlanan öğün', `${kpis.completedMeals} / ${kpis.plannedMeals}`, null, null],
    ['Günlük su ortalaması', formatNumber(kpis.water.averageLiters, ' L'), comparison ? formatNumber(comparison.water.previous, ' L') : null, comparison ? formatSignedLiters(comparison.water.delta) : null],
    ['Su kaydı olan gün', kpis.water.periodDays === null ? `${kpis.water.trackedDays}` : `${kpis.water.trackedDays} / ${kpis.water.periodDays}`, null, null],
    ['Son ölçüm', formatDate(kpis.lastMeasurementDate), null, null],
  ];
  if (comparison) summary.push([], ['Önceki dönem', formatRangeLabel(comparison.previousRange)]);
  if (insights.length > 0) summary.push([], ['İçgörüler'], ...insights.map((insight) => [insight.text]));

  const matrix = report.mealDayMatrix;
  const matrixRows: ExportCell[][] = [
    ['Öğün', ...matrix.dates.map(formatShortDate), 'Uyum'],
    ...matrix.rows.map((row) => [
      ANALYTICS_MEAL_TYPE_LABELS[row.type],
      ...row.cells.map((cell) => (cell.planned === 0 ? '' : `${cell.completed}/${cell.planned}`)),
      formatPercentage(row.percentage),
    ]),
    ['Günlük', ...matrix.dayTotals.map((day) => (day.planned === 0 ? '' : formatPercentage(day.percentage))), formatPercentage(matrix.percentage)],
  ];

  return [
    { name: 'Özet', rows: summary },
    {
      name: 'Günlük uyum',
      rows: [['Gün', 'Tamamlanan', 'Planlanan', 'Uyum'], ...report.dailyAdherence.map((point) => [formatPeriodLabel(point), point.completed, point.planned, formatPercentage(point.percentage)])],
    },
    {
      name: 'Haftalık uyum',
      rows: [['Hafta', 'Tamamlanan', 'Planlanan', 'Uyum'], ...report.weeklyAdherence.map((point) => [formatPeriodLabel(point), point.completed, point.planned, formatPercentage(point.percentage)])],
    },
    {
      name: 'Öğün türü',
      rows: [['Öğün türü', 'Tamamlanan', 'Planlanan', 'Uyum'], ...report.mealTypeAdherence.map((item) => [ANALYTICS_MEAL_TYPE_LABELS[item.type], item.completed, item.planned, formatPercentage(item.percentage)])],
    },
    { name: 'Öğün x gün', rows: matrixRows },
    {
      name: 'Ölçümler',
      rows: [
        ['Tarih', 'Ölçü', 'Değer'],
        ...report.weightTrend.map((point) => [formatDate(point.date), 'Kilo', formatNumber(point.value, ' kg')]),
        ...report.bodyMeasurementTrends.flatMap((trend) => trend.points.map((point) => [formatDate(point.date), BODY_FIELD_LABELS[trend.field], formatNumber(point.value, ' cm')])),
      ],
    },
    {
      name: 'Su',
      rows: [['Tarih', 'Su'], ...report.waterTrend.map((point) => [formatDate(point.date), formatNumber(point.value, ' L')])],
    },
  ];
};
