import { useEffect, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertCircle,
  CalendarDays,
  CheckCircle2,
  Droplets,
  Scale,
  Target,
  TrendingUp,
  Users,
  Utensils,
  type LucideIcon,
} from 'lucide-react';
import { useAnalytics } from '../features/analytics/hooks/useAnalytics';
import { calculateGoalProgress } from '../features/analytics/utils/goalProgressContract';
import {
  DAILY_ADHERENCE_REVEAL_STEP,
  getDailyAdherenceReveal,
  getNextDailyAdherenceVisibleCount,
} from '../features/analytics/utils/dailyAdherenceReveal';
import type {
  AnalyticsAdherencePoint,
  AnalyticsDateRangeKey,
  AnalyticsMealType,
  AnalyticsTrendPoint,
  BodyMeasurementField,
  ClientAnalyticsReport,
  PlannedNutritionMetric,
} from '../features/analytics/types/analytics';
import DietitianAvatar from '../shared/components/DietitianAvatar';

const RANGE_OPTIONS: Array<{ key: AnalyticsDateRangeKey; label: string }> = [
  { key: '7d', label: '7 Gün' },
  { key: '30d', label: '30 Gün' },
  { key: '3m', label: '3 Ay' },
  { key: 'all', label: 'Tüm Zamanlar' },
];

const BODY_FIELD_LABELS: Record<BodyMeasurementField, string> = {
  waist: 'Bel',
  hip: 'Kalça',
  arm: 'Kol (eski kayıt)',
  rightArm: 'Sağ kol',
  leftArm: 'Sol kol',
  chest: 'Göğüs',
  thigh: 'Uyluk (eski kayıt)',
  calf: 'Baldır (eski kayıt)',
  rightCalf: 'Sağ baldır',
  leftCalf: 'Sol baldır',
  neck: 'Boyun',
};

const MEAL_TYPE_LABELS: Record<AnalyticsMealType, string> = {
  breakfast: 'Kahvaltı',
  lunch: 'Öğle',
  dinner: 'Akşam',
  snack: 'Ara öğün',
};

type AnalyticsTabId = 'overview' | 'meals' | 'measurements' | 'water';

const ANALYTICS_TABS: Array<{ id: AnalyticsTabId; label: string }> = [
  { id: 'overview', label: 'Genel Bakış' },
  { id: 'meals', label: 'Öğün Uyumu' },
  { id: 'measurements', label: 'Ölçümler' },
  { id: 'water', label: 'Su Takibi' },
];

const numberFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const percentageFormatter = (maximumFractionDigits: number) => new Intl.NumberFormat('tr-TR', {
  maximumFractionDigits,
});

const formatNumber = (value: number | null, suffix = ''): string => (
  value === null || !Number.isFinite(value) ? '—' : `${numberFormatter.format(value)}${suffix}`
);

const formatPercentage = (value: number | null, maximumFractionDigits = 0): string => (
  value === null || !Number.isFinite(value)
    ? '—'
    : `%${percentageFormatter(maximumFractionDigits).format(value)}`
);

const formatDate = (value: string | null): string => {
  if (value === null) return '—';
  return new Date(`${value}T00:00:00`).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const formatShortDate = (value: string): string => new Date(`${value}T00:00:00`).toLocaleDateString('tr-TR', {
  day: 'numeric',
  month: 'short',
});

const formatPeriodLabel = ({ periodStart, periodEnd }: AnalyticsAdherencePoint): string => (
  periodStart === periodEnd
    ? formatShortDate(periodStart)
    : `${formatShortDate(periodStart)} – ${formatShortDate(periodEnd)}`
);

const formatSignedWeight = (value: number | null): string => {
  if (value === null || !Number.isFinite(value)) return '—';
  if (value === 0) return '0 kg';
  return `${value > 0 ? '+' : '−'}${numberFormatter.format(Math.abs(value))} kg`;
};

const clampPercentage = (value: number | null): number => (
  value === null || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value))
);

const initialsFromName = (fullName: string): string => fullName
  .split(/\s+/)
  .filter(Boolean)
  .slice(0, 2)
  .map((part) => part[0]?.toLocaleUpperCase('tr-TR') ?? '')
  .join('');

const EmptySection = ({
  title,
  description,
}: {
  title: string;
  description?: string;
}) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-5 text-center">
    <p className="text-sm font-semibold text-slate-700">{title}</p>
    {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
  </div>
);

const StatusPanel = ({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry?: () => void;
}) => (
  <div className="flex min-h-60 items-center justify-center rounded-2xl border border-slate-200 bg-white p-6">
    <div className="max-w-md text-center">
      <AlertCircle className="mx-auto mb-3 h-8 w-8 text-rose-500" aria-hidden="true" />
      <h2 className="text-lg font-bold text-slate-800">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500" role="alert">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Tekrar Dene
        </button>
      )}
    </div>
  </div>
);

const LoadingPanel = ({ message }: { message: string }) => (
  <div className="flex min-h-60 items-center justify-center rounded-2xl border border-slate-200 bg-white p-6" role="status">
    <div className="text-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-emerald-100 border-t-primary" />
      <p className="mt-3 text-sm font-medium text-slate-500">{message}</p>
    </div>
  </div>
);

const TrendChart = ({
  points,
  label,
  unit,
  color,
  areaColor,
}: {
  points: AnalyticsTrendPoint[];
  label: string;
  unit: string;
  color: string;
  areaColor: string;
}) => {
  const width = 720;
  const height = 220;
  const chartTop = 16;
  const chartBottom = 184;
  const chartLeft = 12;
  const chartRight = width - 12;
  const values = points.map((point) => point.value);
  const minimumValue = Math.min(...values);
  const maximumValue = Math.max(...values);
  const valueSpread = maximumValue - minimumValue;
  const domainPadding = valueSpread === 0
    ? Math.max(Math.abs(maximumValue) * 0.05, 1)
    : valueSpread * 0.12;
  const minimum = minimumValue - domainPadding;
  const maximum = maximumValue + domainPadding;
  const domainRange = maximum - minimum;
  const coordinates = points.map((point, index) => {
    const x = points.length === 1
      ? width / 2
      : chartLeft + (index / (points.length - 1)) * (chartRight - chartLeft);
    const y = chartTop + ((maximum - point.value) / domainRange) * (chartBottom - chartTop);
    return { ...point, x, y };
  });
  const linePath = coordinates.map(({ x, y }) => `${x},${y}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];
  const firstCoordinate = coordinates[0];
  const lastCoordinate = coordinates[coordinates.length - 1];
  const areaPath = `M ${firstCoordinate.x} ${firstCoordinate.y} L ${coordinates
    .map(({ x, y }) => `${x} ${y}`)
    .join(' L ')} L ${lastCoordinate.x} ${chartBottom} L ${firstCoordinate.x} ${chartBottom} Z`;
  const tickIndexes = [...new Set([0, Math.floor((points.length - 1) / 2), points.length - 1])];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-56 w-full"
        role="img"
        aria-label={`${label}: ${points.length} gerçek kayıt`}
      >
        {[0.25, 0.5, 0.75].map((ratio) => {
          const y = chartTop + ratio * (chartBottom - chartTop);
          return <line key={ratio} x1={chartLeft} x2={chartRight} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="4 5" />;
        })}
        <path d={areaPath} fill={areaColor} />
        {points.length > 1 && (
          <polyline
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
            points={linePath}
          />
        )}
        {coordinates.map((point, index) => (
          <circle key={`${point.date}-${index}`} cx={point.x} cy={point.y} r="3.75" fill={color}>
            <title>{`${formatDate(point.date)}: ${numberFormatter.format(point.value)} ${unit}`}</title>
          </circle>
        ))}
        {tickIndexes.map((index) => (
          <text
            key={`${points[index].date}-${index}`}
            x={coordinates[index].x}
            y="208"
            textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'}
            fill="#64748b"
            fontSize="11"
          >
            {formatShortDate(points[index].date)}
          </text>
        ))}
      </svg>
      <p className="mt-1 text-xs text-slate-500">
        {`${formatDate(first.date)}: ${numberFormatter.format(first.value)} ${unit} · ${formatDate(last.date)}: ${numberFormatter.format(last.value)} ${unit}`}
      </p>
      <details className="mt-3 rounded-xl border border-slate-200 bg-slate-50/80 px-3 py-2.5">
        <summary className="cursor-pointer text-xs font-bold text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">
          Kayıtları tablo olarak göster
        </summary>
        <div className="mt-3 max-h-48 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{label}</caption>
            <thead className="border-b border-slate-200 text-slate-500">
              <tr><th scope="col" className="py-2">Tarih</th><th scope="col" className="py-2 text-right">Değer</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {points.map((point, index) => (
                <tr key={`${point.date}-${index}`}>
                  <td className="py-2 text-slate-600">{formatDate(point.date)}</td>
                  <td className="py-2 text-right font-semibold text-slate-800">{`${numberFormatter.format(point.value)} ${unit}`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
};

const CompactBodyTrend = ({
  points,
  label,
}: {
  points: AnalyticsTrendPoint[];
  label: string;
}) => {
  const width = 280;
  const height = 72;
  const padding = 7;
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const coordinates = points.map((point, index) => ({
    ...point,
    x: points.length === 1
      ? width / 2
      : padding + (index / (points.length - 1)) * (width - padding * 2),
    y: range === 0
      ? height / 2
      : padding + ((maximum - point.value) / range) * (height - padding * 2),
  }));
  const latest = points[points.length - 1];

  return (
    <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold text-slate-600">{label}</h3>
          <p className="mt-1 text-lg font-bold text-slate-800">{`${numberFormatter.format(latest.value)} cm`}</p>
        </div>
        <p className="text-right text-[11px] text-slate-400">{`${points.length} kayıt`}<br />{formatDate(latest.date)}</p>
      </div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="mt-3 h-20 w-full"
        role="img"
        aria-label={`${label} geçmişi: ${points.length} gerçek kayıt`}
      >
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="#cbd5e1" strokeDasharray="4 4" />
        {points.length > 1 && (
          <polyline
            fill="none"
            stroke="#4f8f6a"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
            points={coordinates.map(({ x, y }) => `${x},${y}`).join(' ')}
          />
        )}
        {coordinates.map((point, index) => (
          <circle key={`${point.date}-${index}`} cx={point.x} cy={point.y} r="3.5" fill="#4f8f6a">
            <title>{`${formatDate(point.date)}: ${numberFormatter.format(point.value)} cm`}</title>
          </circle>
        ))}
      </svg>
      <details className="mt-2 border-t border-slate-200 pt-2.5">
        <summary className="cursor-pointer text-xs font-bold text-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2">Tüm ölçümleri göster</summary>
        <div className="mt-2 max-h-40 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{`${label} ölçüm geçmişi`}</caption>
            <thead className="text-slate-500">
              <tr><th scope="col" className="py-1.5">Tarih</th><th scope="col" className="py-1.5 text-right">Ölçüm</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {points.map((point, index) => (
                <tr key={`${point.date}-${index}`}>
                  <td className="py-1.5 text-slate-600">{formatDate(point.date)}</td>
                  <td className="py-1.5 text-right font-semibold text-slate-800">{`${numberFormatter.format(point.value)} cm`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
};

const AdherenceTable = ({
  points,
  label,
}: {
  points: AnalyticsAdherencePoint[];
  label: string;
}) => (
  <div className="overflow-x-auto">
    <table className="w-full min-w-[460px] text-left text-sm">
      <caption className="sr-only">{label}</caption>
      <thead className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
        <tr>
          <th scope="col" className="pb-2.5">Dönem</th>
          <th scope="col" className="pb-2.5 text-center">Tamamlanan</th>
          <th scope="col" className="pb-2.5 text-right">Uyum</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {points.map((point, index) => (
          <tr key={`${point.periodStart}-${point.periodEnd}-${index}`}>
            <td className="py-2.5 text-slate-600">{formatPeriodLabel(point)}</td>
            <td className="py-2.5 text-center text-slate-600">{`${point.completed}/${point.planned}`}</td>
            <td className="py-2.5 text-right font-bold text-slate-800">{formatPercentage(point.percentage, 1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const DailyAdherenceTable = ({
  points,
  visibleCount,
  onShowMore,
}: {
  points: AnalyticsAdherencePoint[];
  visibleCount: number;
  onShowMore: () => void;
}) => {
  const reveal = getDailyAdherenceReveal(points, visibleCount);

  return (
    <div>
      <AdherenceTable points={reveal.visiblePoints} label="Günlük öğün uyumu" />
      {reveal.hasMore && (
        <div className="mt-3 flex flex-col gap-2 border-t border-slate-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-slate-400">{`${reveal.visiblePoints.length} / ${points.length} gün gösteriliyor`}</p>
          <button
            type="button"
            onClick={onShowMore}
            aria-label={`${DAILY_ADHERENCE_REVEAL_STEP} gün daha göster`}
            className="min-h-10 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-emerald-700 transition-colors hover:border-emerald-200 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
          >
            Daha Fazlasını Göster
          </button>
        </div>
      )}
    </div>
  );
};

const NutritionCard = ({
  label,
  metric,
  unit,
}: {
  label: string;
  metric: PlannedNutritionMetric;
  unit: string;
}) => (
  <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1.5 text-xl font-bold text-slate-800">{formatNumber(metric.total, ` ${unit}`)}</p>
    <p className={`mt-1.5 text-xs ${metric.isComplete ? 'text-emerald-700' : 'text-amber-700'}`}>
      {metric.totalMeals === 0
        ? 'Planlanmış öğün yok'
        : `${metric.coveredMeals}/${metric.totalMeals} öğünde veri · ${metric.isComplete ? 'tam kapsam' : 'eksik kapsam'}`}
    </p>
  </div>
);

const KpiCard = ({
  label,
  value,
  context,
  Icon,
  iconClassName = 'text-emerald-700',
}: {
  label: string;
  value: string;
  context: string;
  Icon: LucideIcon;
  iconClassName?: string;
}) => (
  <article className="rounded-2xl border border-slate-200 bg-white px-4 py-4">
    <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
      <Icon className={`h-4 w-4 ${iconClassName}`} aria-hidden="true" />
      <span>{label}</span>
    </div>
    <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900">{value}</p>
    <p className="mt-1 text-xs text-slate-500">{context}</p>
  </article>
);

const GoalProgressCard = ({
  kpis,
}: {
  kpis: ClientAnalyticsReport['kpis'];
}) => {
  const goalProgress = calculateGoalProgress({
    startWeight: kpis.startWeight,
    currentWeight: kpis.currentWeight,
    targetWeight: kpis.targetWeight,
  });
  const radius = 45;
  const circumference = 2 * Math.PI * radius;
  const progress = goalProgress.progressPercentage ?? 0;
  const strokeOffset = circumference - (progress / 100) * circumference;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700">
          <Target className="h-4 w-4" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-slate-800">Hedefe İlerleme</h2>
          <p className="mt-0.5 text-xs text-slate-500">Başlangıç ve hedef kilo arasındaki ilerleme.</p>
        </div>
      </div>

      {goalProgress.hasData && goalProgress.progressPercentage !== null ? (
        <div className="mt-4 grid grid-cols-[112px_1fr] items-center gap-4">
          <div
            className="relative h-28 w-28"
            role="img"
            aria-label={`Hedefe ilerleme: ${formatPercentage(goalProgress.progressPercentage)}`}
          >
            <svg viewBox="0 0 112 112" className="h-full w-full -rotate-90" aria-hidden="true">
              <circle cx="56" cy="56" r={radius} fill="none" stroke="#e2f2e7" strokeWidth="10" />
              <circle
                cx="56"
                cy="56"
                r={radius}
                fill="none"
                stroke="#2f8f5b"
                strokeWidth="10"
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={strokeOffset}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-slate-900">{formatPercentage(goalProgress.progressPercentage)}</span>
              <span className="text-[11px] text-slate-500">İlerleme</span>
            </div>
          </div>
          <dl className="grid gap-2 text-xs">
            <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Hedef Kilo</dt><dd className="font-semibold text-slate-800">{formatNumber(kpis.targetWeight, ' kg')}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Başlangıç Kilo</dt><dd className="font-semibold text-slate-800">{formatNumber(kpis.startWeight, ' kg')}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Güncel Kilo</dt><dd className="font-semibold text-slate-800">{formatNumber(kpis.currentWeight, ' kg')}</dd></div>
            <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Hedefe Kalan</dt><dd className="font-semibold text-slate-800">{formatNumber(goalProgress.remainingKg, ' kg')}</dd></div>
          </dl>
        </div>
      ) : (
        <div className="mt-4">
          <EmptySection title="Hedef ilerlemesi için başlangıç, güncel ve hedef kilo bilgileri gerekli." />
        </div>
      )}

      {goalProgress.isComplete && (
        <p className="mt-3 text-xs font-medium text-emerald-700">Hedefe ulaşıldı.</p>
      )}
    </article>
  );
};

const WeeklyAdherenceChart = ({ points }: { points: AnalyticsAdherencePoint[] }) => (
  points.length === 0 ? (
    <EmptySection title="Seçili dönemde öğün planı bulunmuyor." />
  ) : (
    <div className="overflow-x-auto">
      <div className="flex min-w-[420px] items-end gap-2 pb-1">
        {points.map((point, index) => {
          const percentage = clampPercentage(point.percentage);
          const label = formatPeriodLabel(point);
          return (
            <div key={`${point.periodStart}-${point.periodEnd}-${index}`} className="min-w-[76px] flex-1 text-center">
              <div className="flex h-28 items-end justify-center rounded-lg bg-slate-50 px-2 pt-2">
                <div
                  className={`w-full max-w-10 rounded-t-md transition-[height] ${point.percentage === null ? 'bg-slate-200' : 'bg-emerald-600'}`}
                  style={{ height: point.percentage === null ? '0%' : `${percentage}%` }}
                  role="img"
                  aria-label={`${label}: ${point.completed}/${point.planned} öğün, uyum ${formatPercentage(point.percentage)}`}
                />
              </div>
              <p className="mt-2 text-[11px] leading-4 text-slate-500">{label}</p>
              <p className="mt-0.5 text-xs font-bold text-slate-800">{formatPercentage(point.percentage)}</p>
            </div>
          );
        })}
      </div>
    </div>
  )
);

const MealTypeAdherenceCard = ({
  items,
  overallPercentage,
}: {
  items: ClientAnalyticsReport['mealTypeAdherence'];
  overallPercentage: number | null;
}) => (
  <div>
    <div className="flex items-center gap-3 border-b border-slate-100 pb-3">
      <div className="h-2.5 w-20 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`Genel öğün uyumu ${formatPercentage(overallPercentage)}`}>
        <div className="h-full rounded-full bg-emerald-600" style={{ width: overallPercentage === null ? '0%' : `${clampPercentage(overallPercentage)}%` }} />
      </div>
      <div>
        <p className="text-xs text-slate-500">Genel uyum</p>
        <p className="text-sm font-bold text-slate-800">{formatPercentage(overallPercentage)}</p>
      </div>
    </div>
    <div className="mt-3 space-y-3">
      {items.map((item) => (
        <div key={item.type}>
          <div className="mb-1 flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-slate-600">{MEAL_TYPE_LABELS[item.type]}</span>
            <span className="font-semibold text-slate-800">{`${item.completed}/${item.planned} · ${formatPercentage(item.percentage)}`}</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${MEAL_TYPE_LABELS[item.type]} uyumu ${formatPercentage(item.percentage)}`}>
            <div className="h-full rounded-full bg-emerald-600" style={{ width: item.percentage === null ? '0%' : `${clampPercentage(item.percentage)}%` }} />
          </div>
        </div>
      ))}
    </div>
  </div>
);

const ClientSummary = ({
  client,
  report,
}: {
  client: { fullName: string; avatarUrl: string | null } | null;
  report: ClientAnalyticsReport;
}) => {
  const name = client?.fullName ?? 'Danışan';
  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        {client?.avatarUrl ? (
          <img src={client.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-slate-200 object-cover" />
        ) : (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-xs font-bold text-emerald-700" aria-hidden="true">
            {initialsFromName(name)}
          </div>
        )}
        <div className="min-w-0">
          <h2 className="truncate text-base font-bold text-slate-900">{name}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {`${report.range.startDate === null ? 'İlk kayıttan' : formatDate(report.range.startDate)} – ${formatDate(report.range.endDate)}`}
          </p>
        </div>
      </div>
      <p className="text-xs font-semibold text-slate-500">Son ölçüm: {formatDate(report.kpis.lastMeasurementDate)}</p>
    </section>
  );
};

const AnalyticsKpiGrid = ({ report }: { report: ClientAnalyticsReport }) => {
  const hasMealData = report.kpis.plannedMeals > 0;
  const hasWaterData = report.kpis.water.averageLiters !== null;
  return (
    <section aria-labelledby="analytics-kpi-title">
      <h2 id="analytics-kpi-title" className="sr-only">Temel göstergeler</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          label="Güncel Kilo"
          value={formatNumber(report.kpis.currentWeight, ' kg')}
          context={report.kpis.lastMeasurementDate === null ? 'Henüz ölçüm yok' : `Son ölçüm: ${formatDate(report.kpis.lastMeasurementDate)}`}
          Icon={Scale}
        />
        <KpiCard
          label="Başlangıca Göre Değişim"
          value={formatSignedWeight(report.kpis.weightChange)}
          context={`Başlangıç: ${formatNumber(report.kpis.startWeight, ' kg')}`}
          Icon={TrendingUp}
        />
        <KpiCard
          label="Öğün Uyumu"
          value={hasMealData ? formatPercentage(report.kpis.mealAdherencePercentage) : '—'}
          context={hasMealData ? `${report.kpis.completedMeals} / ${report.kpis.plannedMeals} öğün tamamlandı` : 'Planlanmış öğün yok'}
          Icon={CheckCircle2}
        />
        <KpiCard
          label="Su Takibi"
          value={formatNumber(report.kpis.water.averageLiters, ' L')}
          context={hasWaterData ? 'Günlük ortalama' : 'Henüz su kaydı yok'}
          Icon={Droplets}
          iconClassName="text-cyan-700"
        />
      </div>
    </section>
  );
};

const OverviewPanel = ({
  report,
  hasMealData,
}: {
  report: ClientAnalyticsReport;
  hasMealData: boolean;
}) => (
  <div className="space-y-4">
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start gap-3">
          <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Scale className="h-4 w-4" aria-hidden="true" /></div>
          <div><h2 className="text-sm font-bold text-slate-800">Kilo Trendi</h2><p className="mt-0.5 text-xs text-slate-500">Gerçek ölçüm kayıtları</p></div>
        </div>
        {report.weightTrend.length === 0 ? (
          <EmptySection title="Henüz kilo ölçümü bulunmuyor." description="Seçili dönemde kayıtlı kilo ölçümü yok." />
        ) : (
          <TrendChart points={report.weightTrend} label="Kilo trendi" unit="kg" color="#2f8f5b" areaColor="#e5f5ea" />
        )}
      </article>
      <GoalProgressCard kpis={report.kpis} />
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start gap-3">
          <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><CalendarDays className="h-4 w-4" aria-hidden="true" /></div>
          <div><h2 className="text-sm font-bold text-slate-800">Haftalık Öğün Uyumu</h2><p className="mt-0.5 text-xs text-slate-500">Gerçek haftalık dönem aralıkları</p></div>
        </div>
        {!hasMealData ? <EmptySection title="Seçili dönemde öğün planı bulunmuyor." /> : <WeeklyAdherenceChart points={report.weeklyAdherence} />}
      </article>
      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start gap-3">
          <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><Utensils className="h-4 w-4" aria-hidden="true" /></div>
          <div><h2 className="text-sm font-bold text-slate-800">Öğün Türüne Göre Uyum</h2><p className="mt-0.5 text-xs text-slate-500">Tamamlanan / planlanan öğünler</p></div>
        </div>
        {!hasMealData ? <EmptySection title="Öğün türü uyumu için veri bulunmuyor." /> : <MealTypeAdherenceCard items={report.mealTypeAdherence} overallPercentage={report.kpis.mealAdherencePercentage} />}
      </article>
    </div>
  </div>
);

const MealsPanel = ({
  report,
  hasMealData,
  dailyAdherenceVisibleCount,
  onShowMoreDailyAdherence,
}: {
  report: ClientAnalyticsReport;
  hasMealData: boolean;
  dailyAdherenceVisibleCount: number;
  onShowMoreDailyAdherence: () => void;
}) => (
  <div className="space-y-4">
    <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-start gap-3">
        <div className="rounded-lg bg-emerald-50 p-2 text-emerald-700"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /></div>
        <div><h2 className="text-sm font-bold text-slate-800">Öğün Uyumu</h2><p className="mt-0.5 text-xs text-slate-500">Seçili dönemde tamamlanan ve planlanan öğünler</p></div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Uyum</p><p className="mt-1 text-xl font-bold text-slate-900">{hasMealData ? formatPercentage(report.kpis.mealAdherencePercentage) : '—'}</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Tamamlanan</p><p className="mt-1 text-xl font-bold text-slate-900">{report.kpis.completedMeals}</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Planlanan</p><p className="mt-1 text-xl font-bold text-slate-900">{report.kpis.plannedMeals}</p></div>
        <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs text-slate-500">Eksik kapsam</p><p className="mt-1 text-xl font-bold text-slate-900">{report.dataQuality.incompleteMacroMeals}</p></div>
      </div>
    </article>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start gap-3"><Utensils className="mt-0.5 h-4 w-4 text-emerald-700" aria-hidden="true" /><div><h2 className="text-sm font-bold text-slate-800">Günlük Öğün Uyumu</h2><p className="mt-0.5 text-xs text-slate-500">Gün bazında gerçek dönem kayıtları</p></div></div>
        {!hasMealData ? (
          <EmptySection title="Seçili dönemde öğün planı bulunmuyor." />
        ) : (
          <DailyAdherenceTable
            points={report.dailyAdherence}
            visibleCount={dailyAdherenceVisibleCount}
            onShowMore={onShowMoreDailyAdherence}
          />
        )}
      </article>
      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start gap-3"><CalendarDays className="mt-0.5 h-4 w-4 text-emerald-700" aria-hidden="true" /><div><h2 className="text-sm font-bold text-slate-800">Haftalık Öğün Uyumu</h2><p className="mt-0.5 text-xs text-slate-500">Haftalık dönem aralıkları</p></div></div>
        {!hasMealData ? <EmptySection title="Haftalık uyum hesaplamak için öğün planı bulunmuyor." /> : <AdherenceTable points={report.weeklyAdherence} label="Haftalık öğün uyumu" />}
      </article>
    </div>

    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3"><h2 className="text-sm font-bold text-slate-800">Öğün Türüne Göre Uyum</h2><p className="mt-0.5 text-xs text-slate-500">Kahvaltı, öğle, akşam ve ara öğün kırılımı</p></div>
        {!hasMealData ? <EmptySection title="Öğün türü uyumu için veri bulunmuyor." /> : <MealTypeAdherenceCard items={report.mealTypeAdherence} overallPercentage={report.kpis.mealAdherencePercentage} />}
      </article>
      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start gap-3"><CalendarDays className="mt-0.5 h-4 w-4 text-emerald-700" aria-hidden="true" /><div><h2 className="text-sm font-bold text-slate-800">Haftalık Uyum Görünümü</h2><p className="mt-0.5 text-xs text-slate-500">Dönem bazında hızlı karşılaştırma</p></div></div>
        {!hasMealData ? <EmptySection title="Seçili dönemde öğün planı bulunmuyor." /> : <WeeklyAdherenceChart points={report.weeklyAdherence} />}
      </article>
    </div>

    <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-slate-800">Planlanan Beslenme</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">Değerler tüketim değil, seçili dönemde planlanan toplamları gösterir.</p>
      </div>
      {!hasMealData ? (
        <EmptySection title="Planlanan beslenme hesaplamak için öğün bulunmuyor." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <NutritionCard label="Kalori" metric={report.plannedNutrition.calories} unit="kcal" />
          <NutritionCard label="Protein" metric={report.plannedNutrition.protein} unit="g" />
          <NutritionCard label="Karbonhidrat" metric={report.plannedNutrition.carbs} unit="g" />
          <NutritionCard label="Yağ" metric={report.plannedNutrition.fat} unit="g" />
        </div>
      )}
    </article>
  </div>
);

const MeasurementsPanel = ({
  report,
  visibleBodyTrends,
}: {
  report: ClientAnalyticsReport;
  visibleBodyTrends: ClientAnalyticsReport['bodyMeasurementTrends'];
}) => {
  const goalProgress = calculateGoalProgress({
    startWeight: report.kpis.startWeight,
    currentWeight: report.kpis.currentWeight,
    targetWeight: report.kpis.targetWeight,
  });

  return (
    <div className="space-y-4">
      <section aria-labelledby="measurement-summary-title" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 id="measurement-summary-title" className="text-sm font-bold text-slate-800">Ölçüm Özeti</h2>
        <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Güncel Kilo</dt><dd className="mt-1 text-base font-bold text-slate-900">{formatNumber(report.kpis.currentWeight, ' kg')}</dd></div>
          <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Başlangıç Kilo</dt><dd className="mt-1 text-base font-bold text-slate-900">{formatNumber(report.kpis.startWeight, ' kg')}</dd></div>
          <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Başlangıca Göre Değişim</dt><dd className="mt-1 text-base font-bold text-slate-900">{formatSignedWeight(report.kpis.weightChange)}</dd></div>
          <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Hedef Kilo / Hedefe Kalan</dt><dd className="mt-1 text-base font-bold text-slate-900">{formatNumber(report.kpis.targetWeight, ' kg')}</dd><p className="mt-0.5 text-xs text-slate-500">Kalan: {formatNumber(goalProgress.remainingKg, ' kg')}</p></div>
        </dl>
      </section>

      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start gap-3"><Scale className="mt-0.5 h-4 w-4 text-emerald-700" aria-hidden="true" /><div><h2 className="text-sm font-bold text-slate-800">Kilo Trendi</h2><p className="mt-0.5 text-xs text-slate-500">Detaylı gerçek ölçüm kayıtları</p></div></div>
        {report.weightTrend.length === 0 ? (
          <EmptySection title="Henüz kilo ölçümü bulunmuyor." description="Seçili dönemde kayıtlı kilo ölçümü yok." />
        ) : (
          <TrendChart points={report.weightTrend} label="Kilo trendi" unit="kg" color="#2f8f5b" areaColor="#e5f5ea" />
        )}
      </article>

      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start gap-3"><Activity className="mt-0.5 h-4 w-4 text-emerald-700" aria-hidden="true" /><div><h2 className="text-sm font-bold text-slate-800">Vücut Ölçüleri</h2><p className="mt-0.5 text-xs text-slate-500">DB’de kayıtlı gerçek çevre ölçümleri</p></div></div>
        {visibleBodyTrends.length === 0 ? (
          <EmptySection title="Seçili dönemde vücut ölçümü bulunmuyor." />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {visibleBodyTrends.map((trend) => (
              <div key={trend.field}>
                <CompactBodyTrend points={trend.points} label={BODY_FIELD_LABELS[trend.field]} />
              </div>
            ))}
          </div>
        )}
      </article>
    </div>
  );
};

const WaterSummary = ({ report }: { report: ClientAnalyticsReport }) => {
  const water = report.kpis.water;
  const achievedDays = water.goalEligibleDays === 0 ? '—' : `${water.achievedGoalDays}/${water.goalEligibleDays}`;
  const trackedDays = water.periodDays === null ? `${water.trackedDays} gün` : `${water.trackedDays}/${water.periodDays} gün`;
  return (
    <section aria-labelledby="water-summary-title" className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <h2 id="water-summary-title" className="text-sm font-bold text-slate-800">Su Takibi Özeti</h2>
      <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Günlük Ortalama</dt><dd className="mt-1 text-base font-bold text-slate-900">{formatNumber(water.averageLiters, ' L')}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Günlük Hedef</dt><dd className="mt-1 text-base font-bold text-slate-900">{formatNumber(water.goalLiters, ' L')}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Hedefe Ulaşılan Gün</dt><dd className="mt-1 text-base font-bold text-slate-900">{achievedDays}</dd></div>
        <div className="rounded-xl bg-slate-50 p-3"><dt className="text-xs text-slate-500">Takipli Gün</dt><dd className="mt-1 text-base font-bold text-slate-900">{trackedDays}</dd></div>
      </dl>
    </section>
  );
};

const WaterPanel = ({ report }: { report: ClientAnalyticsReport }) => (
  <div className="space-y-4">
    <WaterSummary report={report} />
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]">
      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-start gap-3"><Droplets className="mt-0.5 h-4 w-4 text-cyan-700" aria-hidden="true" /><div><h2 className="text-sm font-bold text-slate-800">Su Takibi Trendi</h2><p className="mt-0.5 text-xs text-slate-500">Günlük kayıtlardan litre karşılığı</p></div></div>
        {report.waterTrend.length === 0 ? (
          <EmptySection title="Henüz su takip kaydı bulunmuyor." description="Seçili dönemde kayıtlı su takibi yok." />
        ) : (
          <TrendChart points={report.waterTrend} label="Su takip trendi" unit="L" color="#0e7490" areaColor="#e0f2fe" />
        )}
      </article>
      <article className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <h2 className="text-sm font-bold text-slate-800">Su Hedefi Özeti</h2>
        <dl className="mt-4 space-y-3 text-sm">
          <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Günlük hedef</dt><dd className="font-bold text-slate-800">{formatNumber(report.kpis.water.goalLiters, ' L')}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Son kayıt</dt><dd className="font-bold text-slate-800">{formatNumber(report.kpis.water.latestLiters, ' L')}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Hedefe ulaşma</dt><dd className="font-bold text-slate-800">{formatPercentage(report.kpis.water.goalAchievementPercentage)}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Hedefe ulaşılan gün</dt><dd className="font-bold text-slate-800">{report.kpis.water.goalEligibleDays === 0 ? '—' : `${report.kpis.water.achievedGoalDays}/${report.kpis.water.goalEligibleDays}`}</dd></div>
          <div className="flex items-center justify-between gap-3"><dt className="text-slate-500">Takipli gün</dt><dd className="font-bold text-slate-800">{report.kpis.water.periodDays === null ? `${report.kpis.water.trackedDays} gün` : `${report.kpis.water.trackedDays}/${report.kpis.water.periodDays} gün`}</dd></div>
        </dl>
      </article>
    </div>
  </div>
);

const AnalyticsTabs = ({
  activeTab,
  onChange,
}: {
  activeTab: AnalyticsTabId;
  onChange: (tab: AnalyticsTabId) => void;
}) => {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = ANALYTICS_TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % ANALYTICS_TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + ANALYTICS_TABS.length) % ANALYTICS_TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = ANALYTICS_TABS.length - 1;
    if (nextIndex === currentIndex) return;
    event.preventDefault();
    const nextTab = ANALYTICS_TABS[nextIndex];
    onChange(nextTab.id);
    document.getElementById(`analytics-tab-${nextTab.id}`)?.focus();
  };

  return (
    <div role="tablist" aria-label="Analiz bölümleri" className="flex overflow-x-auto border-b border-slate-200">
      {ANALYTICS_TABS.map((tab) => {
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            id={`analytics-tab-${tab.id}`}
            type="button"
            role="tab"
            aria-selected={isActive}
            aria-controls={`analytics-tabpanel-${tab.id}`}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={handleKeyDown}
            className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset sm:px-4 ${
              isActive
                ? 'border-emerald-600 text-emerald-700'
                : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
};

const AnalyticsTabPanel = ({
  activeTab,
  report,
  hasMealData,
  visibleBodyTrends,
  dailyAdherenceVisibleCount,
  onShowMoreDailyAdherence,
}: {
  activeTab: AnalyticsTabId;
  report: ClientAnalyticsReport;
  hasMealData: boolean;
  visibleBodyTrends: ClientAnalyticsReport['bodyMeasurementTrends'];
  dailyAdherenceVisibleCount: number;
  onShowMoreDailyAdherence: () => void;
}) => (
  <section
    id={`analytics-tabpanel-${activeTab}`}
    role="tabpanel"
    aria-labelledby={`analytics-tab-${activeTab}`}
    tabIndex={0}
    className="pt-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
  >
    {activeTab === 'overview' && <OverviewPanel report={report} hasMealData={hasMealData} />}
    {activeTab === 'meals' && (
      <MealsPanel
        report={report}
        hasMealData={hasMealData}
        dailyAdherenceVisibleCount={dailyAdherenceVisibleCount}
        onShowMoreDailyAdherence={onShowMoreDailyAdherence}
      />
    )}
    {activeTab === 'measurements' && <MeasurementsPanel report={report} visibleBodyTrends={visibleBodyTrends} />}
    {activeTab === 'water' && <WaterPanel report={report} />}
  </section>
);

const DataQualityNotice = ({ report }: { report: ClientAnalyticsReport }) => {
  const hasQualityWarning = report.dataQuality.invalidWaterRows > 0
    || report.dataQuality.invalidCompletionRows > 0
    || report.dataQuality.incompleteCalorieMeals > 0
    || report.dataQuality.incompleteMacroMeals > 0;
  if (!hasQualityWarning) return null;
  return (
    <aside className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800" role="status">
      <p className="font-bold">Eksik veri bilgisi</p>
      <p className="mt-1 leading-5">Bazı kayıtlar eksik veya geçersiz alan içeriyor. Hesaplamalar yalnız doğrulanabilen gerçek değerleri kapsar.</p>
    </aside>
  );
};

const Analytics = () => {
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const [activeTab, setActiveTab] = useState<AnalyticsTabId>('overview');
  const [dailyAdherenceVisibleCount, setDailyAdherenceVisibleCount] = useState(DAILY_ADHERENCE_REVEAL_STEP);
  const report = analytics.report;
  const hasMealData = report !== null && report.kpis.plannedMeals > 0;
  const visibleBodyTrends = report?.bodyMeasurementTrends.filter((trend) => trend.points.length > 0) ?? [];

  useEffect(() => {
    setDailyAdherenceVisibleCount(DAILY_ADHERENCE_REVEAL_STEP);
  }, [analytics.selectedClientId, analytics.rangeKey]);

  return (
    <div className="min-h-screen bg-slate-50/60 pb-16">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-md sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">Danışan Analizleri</h1>
              <p className="mt-0.5 truncate text-xs font-medium text-slate-500 sm:text-sm">Gerçek ölçüm, öğün planı ve günlük takip verileri</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              aria-label="Profil sayfasına git"
            >
              <DietitianAvatar className="h-9 w-9 rounded-full border border-slate-200" alt="Profil" />
            </button>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-3 border-t border-slate-100 pt-3 lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-end">
            <label className="block min-w-0 lg:max-w-sm">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Danışan</span>
              <select
                value={analytics.selectedClientId ?? ''}
                onChange={(event) => analytics.selectClient(event.target.value || null)}
                disabled={analytics.clientListStatus !== 'success' || analytics.clients.length === 0}
                className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100"
              >
                <option value="">
                  {analytics.clientListStatus === 'loading' ? 'Danışanlar yükleniyor…' : 'Danışan seçin'}
                </option>
                {analytics.clients.map((client) => (
                  <option key={client.id} value={client.id}>{client.fullName}</option>
                ))}
              </select>
            </label>

            <fieldset className="min-w-0">
              <legend className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Tarih Aralığı</legend>
              <div className="overflow-x-auto pb-0.5">
                <div className="flex min-w-max gap-1.5">
                  {RANGE_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => analytics.selectRange(option.key)}
                      disabled={analytics.selectedClientId === null}
                      aria-pressed={analytics.rangeKey === option.key}
                      className={`min-h-10 rounded-xl border px-3.5 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                        analytics.rangeKey === option.key
                          ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </fieldset>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-4 p-4 sm:p-5 lg:p-6">
        {analytics.clientListStatus === 'loading' && <LoadingPanel message="Aktif danışanlar yükleniyor…" />}

        {analytics.clientListStatus === 'error' && (
          <StatusPanel
            title="Danışanlar yüklenemedi"
            message={analytics.clientListError ?? 'Danışanlar şu anda yüklenemiyor.'}
            onRetry={() => { void analytics.retryClients(); }}
          />
        )}

        {analytics.clientListStatus === 'success' && analytics.clients.length === 0 && (
          <StatusPanel
            title="Aktif danışan bulunmuyor"
            message="Analiz gösterebilmek için en az bir aktif danışan ilişkisi gerekir."
          />
        )}

        {analytics.clientListStatus === 'success' && analytics.clients.length > 0 && analytics.analyticsStatus === 'idle' && (
          <div className="flex min-h-60 items-center justify-center rounded-2xl border border-slate-200 bg-white p-6 text-center">
            <div className="max-w-md">
              <Users className="mx-auto h-9 w-9 text-emerald-600" aria-hidden="true" />
              <h2 className="mt-3 text-lg font-bold text-slate-800">Analiz için danışan seçin</h2>
              <p className="mt-2 text-sm leading-6 text-slate-500">Yalnız aktif danışanlarınıza ait gerçek takip verileri gösterilir.</p>
            </div>
          </div>
        )}

        {analytics.analyticsStatus === 'loading' && <LoadingPanel message="Analiz verileri yükleniyor…" />}

        {analytics.analyticsStatus === 'error' && (
          <StatusPanel
            title="Analiz verileri yüklenemedi"
            message={analytics.analyticsError ?? 'Analiz verileri şu anda yüklenemiyor.'}
            onRetry={() => { void analytics.retryAnalytics(); }}
          />
        )}

        {analytics.analyticsStatus === 'success' && report && (
          <div className="space-y-4">
            <ClientSummary client={analytics.selectedClient} report={report} />
            <AnalyticsKpiGrid report={report} />
            <AnalyticsTabs activeTab={activeTab} onChange={setActiveTab} />
            <AnalyticsTabPanel
              activeTab={activeTab}
              report={report}
              hasMealData={hasMealData}
              visibleBodyTrends={visibleBodyTrends}
              dailyAdherenceVisibleCount={dailyAdherenceVisibleCount}
              onShowMoreDailyAdherence={() => {
                setDailyAdherenceVisibleCount((current) => getNextDailyAdherenceVisibleCount(current, report.dailyAdherence.length));
              }}
            />
            <DataQualityNotice report={report} />
          </div>
        )}
      </main>
    </div>
  );
};

export default Analytics;
