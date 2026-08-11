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
  Utensils,
  Users,
} from 'lucide-react';
import { useAnalytics } from '../features/analytics/hooks/useAnalytics';
import type {
  AnalyticsAdherencePoint,
  AnalyticsDateRangeKey,
  AnalyticsMealType,
  AnalyticsTrendPoint,
  BodyMeasurementField,
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

const numberFormatter = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });

const formatNumber = (value: number | null, suffix = ''): string => (
  value === null || !Number.isFinite(value) ? 'Veri yok' : `${numberFormatter.format(value)}${suffix}`
);

const formatPercentage = (value: number | null): string => (
  value === null || !Number.isFinite(value) ? 'Veri yok' : `%${numberFormatter.format(value)}`
);

const formatDate = (value: string | null): string => {
  if (value === null) return 'Veri yok';
  return new Date(`${value}T00:00:00`).toLocaleDateString('tr-TR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

const EmptySection = ({ children }: { children: string }) => (
  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-5 py-8 text-center text-sm text-slate-500">
    {children}
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
  <div className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-100 bg-white p-8 shadow-sm">
    <div className="max-w-md text-center">
      <AlertCircle className="mx-auto mb-4 h-10 w-10 text-rose-500" aria-hidden="true" />
      <h2 className="text-lg font-bold text-slate-800">{title}</h2>
      <p className="mt-2 text-sm leading-6 text-slate-500" role="alert">{message}</p>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-5 min-h-11 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          Tekrar Dene
        </button>
      )}
    </div>
  </div>
);

const LoadingPanel = ({ message }: { message: string }) => (
  <div className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-100 bg-white p-8 shadow-sm" role="status">
    <div className="text-center">
      <div className="mx-auto h-10 w-10 animate-spin rounded-full border-4 border-emerald-100 border-t-primary" />
      <p className="mt-4 text-sm font-medium text-slate-500">{message}</p>
    </div>
  </div>
);

const TrendChart = ({
  points,
  label,
  unit,
  color,
}: {
  points: AnalyticsTrendPoint[];
  label: string;
  unit: string;
  color: string;
}) => {
  const width = 640;
  const height = 180;
  const padding = 18;
  const values = points.map((point) => point.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const range = maximum - minimum;
  const coordinates = points.map((point, index) => {
    const x = points.length === 1
      ? width / 2
      : padding + (index / (points.length - 1)) * (width - padding * 2);
    const y = range === 0
      ? height / 2
      : padding + ((maximum - point.value) / range) * (height - padding * 2);
    return { ...point, x, y };
  });
  const polyline = coordinates.map(({ x, y }) => `${x},${y}`).join(' ');
  const first = points[0];
  const last = points[points.length - 1];

  return (
    <div>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-52 w-full"
        role="img"
        aria-label={`${label}: ${points.length} gerçek kayıt`}
      >
        {[45, 90, 135].map((y) => (
          <line key={y} x1="0" x2={width} y1={y} y2={y} stroke="#e2e8f0" strokeDasharray="5 5" />
        ))}
        {points.length > 1 && (
          <polyline
            fill="none"
            stroke={color}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="4"
            points={polyline}
          />
        )}
        {coordinates.map((point) => (
          <circle key={`${point.date}-${point.value}`} cx={point.x} cy={point.y} r="5" fill={color}>
            <title>{`${formatDate(point.date)}: ${numberFormatter.format(point.value)} ${unit}`}</title>
          </circle>
        ))}
      </svg>
      <p className="mt-2 text-xs text-slate-500">
        {`${formatDate(first.date)}: ${numberFormatter.format(first.value)} ${unit} · ${formatDate(last.date)}: ${numberFormatter.format(last.value)} ${unit}`}
      </p>
      <details className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3">
        <summary className="cursor-pointer text-xs font-bold text-slate-600">Kayıtları tablo olarak göster</summary>
        <div className="mt-3 max-h-48 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{label}</caption>
            <thead className="text-slate-500">
              <tr><th className="py-2">Tarih</th><th className="py-2 text-right">Değer</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {points.map((point) => (
                <tr key={`${point.date}-${point.value}`}>
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
    <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
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
        <line x1="0" x2={width} y1={height / 2} y2={height / 2} stroke="#e2e8f0" strokeDasharray="4 4" />
        {points.length > 1 && (
          <polyline
            fill="none"
            stroke="#7c3aed"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="3"
            points={coordinates.map(({ x, y }) => `${x},${y}`).join(' ')}
          />
        )}
        {coordinates.map((point, index) => (
          <circle key={`${point.date}-${index}`} cx={point.x} cy={point.y} r="4" fill="#7c3aed">
            <title>{`${formatDate(point.date)}: ${numberFormatter.format(point.value)} cm`}</title>
          </circle>
        ))}
      </svg>
      <details className="mt-2 border-t border-slate-200 pt-3">
        <summary className="cursor-pointer text-xs font-bold text-violet-700">Tüm ölçümleri göster</summary>
        <div className="mt-2 max-h-40 overflow-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{`${label} ölçüm geçmişi`}</caption>
            <thead className="text-slate-500">
              <tr><th className="py-1.5">Tarih</th><th className="py-1.5 text-right">Ölçüm</th></tr>
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
    <table className="w-full text-left text-sm">
      <caption className="sr-only">{label}</caption>
      <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
        <tr>
          <th className="pb-3">Dönem</th>
          <th className="pb-3 text-center">Tamamlanan</th>
          <th className="pb-3 text-right">Uyum</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {points.map((point) => (
          <tr key={`${point.periodStart}-${point.periodEnd}`}>
            <td className="py-3 text-slate-600">
              {point.periodStart === point.periodEnd
                ? formatDate(point.periodStart)
                : `${formatDate(point.periodStart)} – ${formatDate(point.periodEnd)}`}
            </td>
            <td className="py-3 text-center text-slate-600">{`${point.completed}/${point.planned}`}</td>
            <td className="py-3 text-right font-bold text-slate-800">{formatPercentage(point.percentage)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const NutritionCard = ({
  label,
  metric,
  unit,
}: {
  label: string;
  metric: PlannedNutritionMetric;
  unit: string;
}) => (
  <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-2 text-xl font-bold text-slate-800">{formatNumber(metric.total, ` ${unit}`)}</p>
    <p className={`mt-2 text-xs ${metric.isComplete ? 'text-emerald-600' : 'text-amber-600'}`}>
      {metric.totalMeals === 0
        ? 'Planlanmış öğün yok'
        : `${metric.coveredMeals}/${metric.totalMeals} öğünde veri · ${metric.isComplete ? 'tam' : 'eksik kapsam'}`}
    </p>
  </div>
);

const Analytics = () => {
  const navigate = useNavigate();
  const analytics = useAnalytics();
  const report = analytics.report;
  const hasMealData = report !== null && report.kpis.plannedMeals > 0;
  const visibleBodyTrends = report?.bodyMeasurementTrends.filter((trend) => trend.points.length > 0) ?? [];

  return (
    <div className="min-h-screen bg-slate-50/50 pb-20">
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 px-4 py-4 shadow-sm backdrop-blur-md sm:px-6">
        <div className="mx-auto max-w-7xl">
          <div className="flex flex-col justify-between gap-4 md:flex-row md:items-center">
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-800">Danışan Analizleri</h1>
              <p className="mt-1 text-sm font-medium text-slate-500">Gerçek ölçüm, öğün planı ve günlük takip verileri</p>
            </div>
            <button
              type="button"
              onClick={() => navigate('/profile')}
              className="self-start rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 md:self-auto"
              aria-label="Profil sayfasına git"
            >
              <DietitianAvatar className="h-10 w-10 rounded-full border border-slate-200 shadow-sm" alt="Profil" />
            </button>
          </div>

          <div className="mt-5 flex flex-col gap-3 lg:flex-row lg:items-end">
            <label className="block min-w-0 flex-1 lg:max-w-sm">
              <span className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-slate-500">Danışan</span>
              <select
                value={analytics.selectedClientId ?? ''}
                onChange={(event) => analytics.selectClient(event.target.value || null)}
                disabled={analytics.clientListStatus !== 'success' || analytics.clients.length === 0}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 outline-none transition focus:border-primary focus:ring-2 focus:ring-emerald-100 disabled:cursor-not-allowed disabled:bg-slate-100"
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
              <legend className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-500">Tarih aralığı</legend>
              <div className="flex flex-wrap gap-2">
                {RANGE_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => analytics.selectRange(option.key)}
                    disabled={analytics.selectedClientId === null}
                    aria-pressed={analytics.rangeKey === option.key}
                    className={`min-h-11 rounded-xl border px-4 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${
                      analytics.rangeKey === option.key
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl p-4 sm:p-6 lg:p-8">
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
          <div className="flex min-h-72 items-center justify-center rounded-2xl border border-slate-100 bg-white p-8 text-center shadow-sm">
            <div className="max-w-md">
              <Users className="mx-auto h-12 w-12 text-emerald-500" aria-hidden="true" />
              <h2 className="mt-4 text-xl font-bold text-slate-800">Analiz için danışan seçin</h2>
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
          <div className="space-y-8">
            <section className="flex flex-col gap-4 rounded-2xl border border-slate-100 bg-white p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-6">
              <div className="flex min-w-0 items-center gap-4">
                {analytics.selectedClient?.avatarUrl && (
                  <img
                    src={analytics.selectedClient.avatarUrl}
                    alt=""
                    className="h-14 w-14 rounded-full border border-slate-100 object-cover"
                  />
                )}
                <div className="min-w-0">
                  <h2 className="truncate text-xl font-bold text-slate-800">{analytics.selectedClient?.fullName ?? 'Danışan'}</h2>
                  <p className="mt-1 text-sm text-slate-500">
                    {`${report.range.startDate === null ? 'İlk kayıttan' : formatDate(report.range.startDate)} – ${formatDate(report.range.endDate)}`}
                  </p>
                </div>
              </div>
              <p className="rounded-xl bg-slate-50 px-4 py-2 text-xs font-semibold text-slate-500">Son ölçüm: {formatDate(report.kpis.lastMeasurementDate)}</p>
            </section>

            <section aria-labelledby="analytics-kpi-title">
              <h2 id="analytics-kpi-title" className="sr-only">Temel göstergeler</h2>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
                {[
                  { label: 'Güncel Kilo', value: formatNumber(report.kpis.currentWeight, ' kg'), icon: Scale, color: 'text-blue-600', bg: 'bg-blue-50' },
                  { label: 'Başlangıca Göre', value: formatNumber(report.kpis.weightChange, ' kg'), icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                  { label: 'Hedef Farkı', value: formatNumber(report.kpis.targetGap, ' kg'), icon: Target, color: 'text-violet-600', bg: 'bg-violet-50' },
                  { label: 'Öğün Uyumu', value: formatPercentage(report.kpis.mealAdherencePercentage), icon: CheckCircle2, color: 'text-emerald-600', bg: 'bg-emerald-50' },
                  { label: 'Ort. Su', value: formatNumber(report.kpis.water.averageMl === null ? null : report.kpis.water.averageMl / 1000, ' L'), icon: Droplets, color: 'text-cyan-600', bg: 'bg-cyan-50' },
                  {
                    label: 'Takipli Su Günü',
                    value: report.kpis.water.periodDays === null
                      ? `${report.kpis.water.trackedDays} gün`
                      : `${report.kpis.water.trackedDays}/${report.kpis.water.periodDays} gün`,
                    icon: CalendarDays,
                    color: 'text-orange-600',
                    bg: 'bg-orange-50',
                  },
                ].map((item) => (
                  <article key={item.label} className="rounded-2xl border border-slate-100 bg-white p-5 shadow-sm">
                    <div className={`mb-4 inline-flex rounded-xl p-2.5 ${item.bg}`}><item.icon className={`h-5 w-5 ${item.color}`} aria-hidden="true" /></div>
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{item.label}</p>
                    <p className="mt-1 text-xl font-bold text-slate-800">{item.value}</p>
                  </article>
                ))}
              </div>
            </section>

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-2" aria-label="Ölçüm trendleri">
              <article className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-center gap-3">
                  <Scale className="h-5 w-5 text-blue-600" aria-hidden="true" />
                  <div><h2 className="font-bold text-slate-800">Kilo Trendi</h2><p className="text-xs text-slate-500">Gerçek ölçüm kayıtları</p></div>
                </div>
                {report.weightTrend.length === 0
                  ? <EmptySection>Seçili dönemde kilo ölçümü bulunmuyor.</EmptySection>
                  : <TrendChart points={report.weightTrend} label="Kilo trendi" unit="kg" color="#3b82f6" />}
              </article>

              <article className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-center gap-3">
                  <Activity className="h-5 w-5 text-violet-600" aria-hidden="true" />
                  <div><h2 className="font-bold text-slate-800">Vücut Ölçüleri</h2><p className="text-xs text-slate-500">DB’de kayıtlı gerçek çevre ölçümleri</p></div>
                </div>
                {visibleBodyTrends.length === 0 ? (
                  <EmptySection>Seçili dönemde vücut ölçüsü bulunmuyor.</EmptySection>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {visibleBodyTrends.map((trend) => (
                      <div key={trend.field}>
                        <CompactBodyTrend
                          points={trend.points}
                          label={BODY_FIELD_LABELS[trend.field]}
                        />
                      </div>
                    ))}
                  </div>
                )}
              </article>
            </section>

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-3" aria-label="Su takibi">
              <article className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm lg:col-span-2">
                <div className="mb-5 flex items-center gap-3">
                  <Droplets className="h-5 w-5 text-cyan-600" aria-hidden="true" />
                  <div><h2 className="font-bold text-slate-800">Su Takibi Trendi</h2><p className="text-xs text-slate-500">Günlük kayıtlardan litre karşılığı</p></div>
                </div>
                {report.waterTrend.length === 0 ? (
                  <EmptySection>Seçili dönemde su takip kaydı bulunmuyor.</EmptySection>
                ) : (
                  <TrendChart
                    points={report.waterTrend.map((point) => ({ ...point, value: point.value / 1000 }))}
                    label="Su takip trendi"
                    unit="L"
                    color="#0891b2"
                  />
                )}
              </article>
              <article className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <h2 className="font-bold text-slate-800">Su Hedefi Özeti</h2>
                <dl className="mt-5 space-y-4 text-sm">
                  <div><dt className="text-slate-500">Günlük hedef</dt><dd className="mt-1 font-bold text-slate-800">{formatNumber(report.kpis.water.goalMl === null ? null : report.kpis.water.goalMl / 1000, ' L')}</dd></div>
                  <div><dt className="text-slate-500">Son kayıt</dt><dd className="mt-1 font-bold text-slate-800">{formatNumber(report.kpis.water.latestMl === null ? null : report.kpis.water.latestMl / 1000, ' L')}</dd></div>
                  <div><dt className="text-slate-500">Hedefe ulaşma</dt><dd className="mt-1 font-bold text-slate-800">{formatPercentage(report.kpis.water.goalAchievementPercentage)}</dd></div>
                  <div><dt className="text-slate-500">Hedefe ulaşılan gün</dt><dd className="mt-1 font-bold text-slate-800">{`${report.kpis.water.achievedGoalDays}/${report.kpis.water.goalEligibleDays}`}</dd></div>
                </dl>
              </article>
            </section>

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-2" aria-label="Öğün uyumu">
              <article className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-center gap-3"><Utensils className="h-5 w-5 text-emerald-600" aria-hidden="true" /><h2 className="font-bold text-slate-800">Günlük Öğün Uyumu</h2></div>
                {!hasMealData ? <EmptySection>Seçili dönemde öğün planı bulunmuyor.</EmptySection> : <AdherenceTable points={report.dailyAdherence} label="Günlük öğün uyumu" />}
              </article>
              <article className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-center gap-3"><CalendarDays className="h-5 w-5 text-orange-600" aria-hidden="true" /><h2 className="font-bold text-slate-800">Haftalık Öğün Uyumu</h2></div>
                {!hasMealData ? <EmptySection>Haftalık uyum hesaplamak için öğün planı bulunmuyor.</EmptySection> : <AdherenceTable points={report.weeklyAdherence} label="Haftalık öğün uyumu" />}
              </article>
            </section>

            <section className="grid grid-cols-1 gap-6 lg:grid-cols-3" aria-label="Öğün dağılımı ve planlanan beslenme">
              <article className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm">
                <h2 className="font-bold text-slate-800">Öğün Türüne Göre Uyum</h2>
                {!hasMealData ? (
                  <div className="mt-5"><EmptySection>Öğün türü uyumu için veri bulunmuyor.</EmptySection></div>
                ) : (
                  <div className="mt-5 space-y-4">
                    {report.mealTypeAdherence.map((item) => (
                      <div key={item.type}>
                        <div className="mb-1.5 flex justify-between text-sm"><span className="font-medium text-slate-600">{MEAL_TYPE_LABELS[item.type]}</span><span className="font-bold text-slate-800">{`${item.completed}/${item.planned} · ${formatPercentage(item.percentage)}`}</span></div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${MEAL_TYPE_LABELS[item.type]} uyumu ${formatPercentage(item.percentage)}`}>
                          <div className="h-full rounded-full bg-primary" style={{ width: `${Math.min(100, Math.max(0, item.percentage ?? 0))}%` }} />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </article>

              <article className="rounded-2xl border border-slate-100 bg-white p-6 shadow-sm lg:col-span-2">
                <div className="mb-5">
                  <h2 className="font-bold text-slate-800">Planlanan Beslenme</h2>
                  <p className="mt-1 text-xs text-slate-500">Değerler tüketim değil, seçili dönemde planlanan toplamları gösterir.</p>
                </div>
                {!hasMealData ? (
                  <EmptySection>Planlanan beslenme hesaplamak için öğün bulunmuyor.</EmptySection>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <NutritionCard label="Kalori" metric={report.plannedNutrition.calories} unit="kcal" />
                    <NutritionCard label="Protein" metric={report.plannedNutrition.protein} unit="g" />
                    <NutritionCard label="Karbonhidrat" metric={report.plannedNutrition.carbs} unit="g" />
                    <NutritionCard label="Yağ" metric={report.plannedNutrition.fat} unit="g" />
                  </div>
                )}
              </article>
            </section>

            {(report.dataQuality.invalidWaterRows > 0 || report.dataQuality.invalidCompletionRows > 0 || report.dataQuality.incompleteMacroMeals > 0) && (
              <aside className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-800" role="status">
                <p className="font-bold">Eksik veri bilgisi</p>
                <p className="mt-1 leading-6">Bazı kayıtlar eksik veya geçersiz alan içeriyor. Hesaplamalar yalnız doğrulanabilen gerçek değerleri kapsar.</p>
              </aside>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default Analytics;
