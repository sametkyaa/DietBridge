import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Info, RefreshCw, Search, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import DietitianAvatar from '../../../shared/components/DietitianAvatar';
import NotificationBell from '../../notifications/components/NotificationBell';
import {
  fetchMealTrackingOverview,
  getMealTrackingUserMessage,
} from '../services/mealTrackingService';
import {
  formatMealTrackingLastCompletedAt,
  getMealTrackingRange,
} from '../utils/mealTrackingContract';
import { getIstanbulDateKey } from '../../analytics/utils/analyticsContract';
import type {
  MealTrackingFilter,
  MealTrackingOverviewClient,
  MealTrackingOverviewMealEntry,
  MealTrackingOverviewSummaryEntry,
  MealTrackingOverviewTypeEntry,
} from '../types/mealTracking';

type OverviewViewState =
  | { status: 'loading' }
  | { status: 'ready'; clients: MealTrackingOverviewClient[] }
  | { status: 'error'; message: string };

const VIEW_OPTIONS: Array<{ value: Exclude<MealTrackingFilter, 'date'>; label: string }> = [
  { value: 'today', label: 'Bugün' },
  { value: '7d', label: 'Son 7 Gün' },
];

const normalizeClientSearchValue = (value: string | null | undefined): string => (
  (value ?? '').trim().toLocaleLowerCase('tr-TR')
);

const compareOverviewClients = (
  left: MealTrackingOverviewClient,
  right: MealTrackingOverviewClient,
): number => (
  left.displayName.localeCompare(right.displayName, 'tr-TR')
  || left.clientId.localeCompare(right.clientId)
);

const getClientInitials = (name: string): string => {
  const initials = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toLocaleUpperCase('tr-TR'))
    .join('');

  return initials || '?';
};

const ClientAvatar: React.FC<{ client: MealTrackingOverviewClient; sizeClassName: string }> = ({
  client,
  sizeClassName,
}) => {
  const [imageFailed, setImageFailed] = useState(false);

  useEffect(() => {
    setImageFailed(false);
  }, [client.avatar]);

  if (!client.avatar || imageFailed) {
    return (
      <span
        role="img"
        aria-label={`${client.displayName} profil fotoğrafı yok`}
        className={`${sizeClassName} flex shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-700`}
      >
        {getClientInitials(client.displayName)}
      </span>
    );
  }

  return (
    <img
      src={client.avatar}
      alt={client.displayName}
      onError={() => setImageFailed(true)}
      className={`${sizeClassName} shrink-0 rounded-full object-cover`}
    />
  );
};

const ClientSearchInput: React.FC<{
  id: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}> = ({ id, value, onChange, className = '' }) => (
  <div className={`relative min-w-0 ${className}`}>
    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
    <input
      id={id}
      type="search"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder="Danışan ara..."
      aria-label="Danışan ara"
      className="min-h-11 w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-11 pr-10 text-sm text-slate-700 shadow-sm outline-none transition-colors placeholder:text-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20"
    />
    {value && (
      <button
        type="button"
        onClick={() => onChange('')}
        aria-label="Danışan aramasını temizle"
        className="absolute right-2.5 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    )}
  </div>
);

const getProgressText = (client: MealTrackingOverviewClient): string => (
  client.plannedCount === 0
    ? 'Plan yok'
    : `${client.completedCount}/${client.plannedCount} (%${client.percentage ?? 0})`
);

const getProgressClassName = (client: MealTrackingOverviewClient): string => {
  if (client.plannedCount === 0 || client.completedCount === 0) return 'text-slate-500';
  if (client.completedCount === client.plannedCount) return 'text-primary';
  return 'text-amber-600';
};

const getTodayStatusLabel = (entry: MealTrackingOverviewMealEntry): string => {
  if (entry.status === 'completed') return 'Tamamlandı';
  if (entry.status === 'pending') return 'Bekliyor';
  return 'İşaretlenmedi';
};

const getTodayStatusDotClassName = (entry: MealTrackingOverviewMealEntry): string => {
  if (entry.status === 'completed') return 'bg-emerald-500';
  if (entry.status === 'pending') return 'bg-amber-400';
  return 'bg-slate-400';
};

const getTypeStatusLabel = (entry: MealTrackingOverviewTypeEntry): string => {
  if (entry.status === 'complete') return 'Tamamı tamamlandı';
  if (entry.status === 'partial') return 'Kısmi tamamlandı';
  return 'Tamamlanma yok';
};

const getTypeStatusDotClassName = (entry: MealTrackingOverviewTypeEntry): string => {
  if (entry.status === 'complete') return 'bg-emerald-500';
  if (entry.status === 'partial') return 'bg-amber-400';
  return 'bg-slate-400';
};

const MealSummary: React.FC<{ client: MealTrackingOverviewClient }> = ({ client }) => {
  if (client.plannedCount === 0) {
    return <span className="text-sm text-slate-400">Bu dönemde planlı öğün yok</span>;
  }

  if (client.mealSummary.length === 0) {
    return <span className="text-sm text-slate-400">Özet bulunmuyor</span>;
  }

  return (
    <ul className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2" aria-label="Öğün durumu özeti">
      {client.mealSummary.map((entry: MealTrackingOverviewSummaryEntry) => (
        entry.kind === 'meal' ? (
          <li
            key={entry.id}
            className="inline-flex min-w-0 items-center gap-2 text-sm text-slate-600"
            aria-label={`${entry.label}: ${getTodayStatusLabel(entry)}`}
            title={entry.title}
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getTodayStatusDotClassName(entry)}`} aria-hidden="true" />
            <span className="truncate">{entry.label}</span>
            <span className="text-xs text-slate-400">{getTodayStatusLabel(entry)}</span>
          </li>
        ) : (
          <li
            key={entry.type}
            className="inline-flex min-w-0 items-center gap-2 text-sm text-slate-600"
            aria-label={`${entry.label} ${entry.completedCount}/${entry.plannedCount}: ${getTypeStatusLabel(entry)}`}
          >
            <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${getTypeStatusDotClassName(entry)}`} aria-hidden="true" />
            <span className="truncate">{entry.label} {entry.completedCount}/{entry.plannedCount}</span>
            <span className="sr-only">{getTypeStatusLabel(entry)}</span>
          </li>
        )
      ))}
    </ul>
  );
};

const LastUpdated: React.FC<{ client: MealTrackingOverviewClient; today: string }> = ({ client, today }) => {
  if (client.plannedCount === 0) return <span className="text-sm text-slate-400">—</span>;

  return (
    <span className="text-sm text-slate-500">
      {formatMealTrackingLastCompletedAt(client.lastCompletedAt, today) ?? 'Henüz kayıt yok'}
    </span>
  );
};

const OverviewTableRow: React.FC<{ client: MealTrackingOverviewClient; today: string }> = ({
  client,
  today,
}) => (
  <tr className="border-t border-slate-100 align-middle transition-colors hover:bg-slate-50/60">
    <td className="px-6 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <ClientAvatar client={client} sizeClassName="h-10 w-10" />
        <span className="min-w-0 truncate font-semibold text-slate-800">{client.displayName}</span>
      </div>
    </td>
    <td className={`whitespace-nowrap px-6 py-4 text-sm font-semibold ${getProgressClassName(client)}`}>
      <span aria-label={`Öğün ilerlemesi: ${getProgressText(client)}`}>{getProgressText(client)}</span>
    </td>
    <td className="min-w-[22rem] px-6 py-4">
      <MealSummary client={client} />
    </td>
    <td className="whitespace-nowrap px-6 py-4">
      <LastUpdated client={client} today={today} />
    </td>
    <td className="px-6 py-4 text-right">
      <Link
        to={`/clients/${client.clientId}/meal-tracking`}
        className="inline-flex min-h-11 items-center justify-end gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={`${client.displayName} öğün takip detayını aç`}
      >
        Detay
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </td>
  </tr>
);

const OverviewClientCard: React.FC<{ client: MealTrackingOverviewClient; today: string }> = ({
  client,
  today,
}) => (
  <article className="rounded-xl border border-slate-100 bg-white p-4 shadow-sm">
    <div className="flex min-w-0 items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <ClientAvatar client={client} sizeClassName="h-11 w-11" />
        <h3 className="min-w-0 truncate font-semibold text-slate-800">{client.displayName}</h3>
      </div>
      <span className={`shrink-0 text-sm font-semibold ${getProgressClassName(client)}`}>
        {getProgressText(client)}
      </span>
    </div>

    <div className="mt-4 border-t border-slate-100 pt-4">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Öğün durumu (özet)</p>
      <MealSummary client={client} />
    </div>

    <div className="mt-4 flex items-center justify-between gap-3 border-t border-slate-100 pt-4">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Son güncelleme</p>
        <LastUpdated client={client} today={today} />
      </div>
      <Link
        to={`/clients/${client.clientId}/meal-tracking`}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg px-3 py-2 text-sm font-semibold text-primary transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        aria-label={`${client.displayName} öğün takip detayını aç`}
      >
        Detay
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  </article>
);

const OverviewLoadingState = () => (
  <div className="overflow-hidden rounded-xl border border-slate-100" role="status" aria-label="Öğün takip özeti yükleniyor">
    <div className="hidden divide-y divide-slate-100 md:block">
      {[0, 1, 2, 3].map((row) => (
        <div key={row} className="flex animate-pulse items-center gap-6 px-6 py-5">
          <div className="h-10 w-10 rounded-full bg-slate-100" />
          <div className="h-4 w-40 rounded bg-slate-100" />
          <div className="h-4 w-24 rounded bg-slate-100" />
          <div className="h-4 flex-1 rounded bg-slate-100" />
          <div className="h-4 w-24 rounded bg-slate-100" />
        </div>
      ))}
    </div>
    <div className="space-y-3 p-4 md:hidden">
      {[0, 1, 2].map((row) => (
        <div key={row} className="animate-pulse rounded-xl border border-slate-100 p-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-full bg-slate-100" />
            <div className="h-4 w-32 rounded bg-slate-100" />
          </div>
          <div className="mt-5 h-4 w-full rounded bg-slate-100" />
        </div>
      ))}
    </div>
    <span className="sr-only">Öğün takip özeti yükleniyor…</span>
  </div>
);

const MealTrackingOverviewPage = () => {
  const [filter, setFilter] = useState<Exclude<MealTrackingFilter, 'date'>>('today');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewState, setViewState] = useState<OverviewViewState>({ status: 'loading' });
  const requestSequence = useRef(0);
  const isMounted = useRef(true);

  const range = useMemo(() => getMealTrackingRange(filter), [filter]);
  const today = getIstanbulDateKey();

  const loadOverview = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setViewState({ status: 'loading' });

    try {
      const clients = await fetchMealTrackingOverview(range.startDate, range.endDate, filter);
      if (!isMounted.current || requestId !== requestSequence.current) return;
      setViewState({ status: 'ready', clients });
    } catch (cause) {
      if (!isMounted.current || requestId !== requestSequence.current) return;
      setViewState({ status: 'error', message: getMealTrackingUserMessage(cause) });
    }
  }, [filter, range]);

  useEffect(() => {
    isMounted.current = true;
    void loadOverview();

    return () => {
      isMounted.current = false;
      requestSequence.current += 1;
    };
  }, [loadOverview]);

  const normalizedSearchTerm = normalizeClientSearchValue(searchTerm);
  const visibleClients = useMemo(() => {
    if (viewState.status !== 'ready') return [];

    return viewState.clients
      .filter((client) => (
        !normalizedSearchTerm
        || normalizeClientSearchValue(client.displayName).includes(normalizedSearchTerm)
      ))
      .sort(compareOverviewClients);
  }, [normalizedSearchTerm, viewState]);

  const subtitle = filter === 'today'
    ? 'Danışanlarınızın bugün için planlanan öğünlere göre tamamlama durumunu toplu olarak görüntüleyin.'
    : 'Danışanlarınızın son 7 gündeki öğün tamamlama durumunu toplu olarak görüntüleyin.';
  const cardSubtitle = filter === 'today' ? 'Bugün özeti' : 'Son 7 gün özeti';
  const emptySearch = viewState.status === 'ready'
    && viewState.clients.length > 0
    && visibleClients.length === 0
    && Boolean(normalizedSearchTerm);

  return (
    <div className="min-h-full w-full min-w-0 bg-background-light p-4 pb-24 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl">
        <header className="mb-6 flex flex-col gap-5 xl:mb-8 xl:flex-row xl:items-start xl:justify-between">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-slate-800">Öğün Takibi</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500 sm:text-base">{subtitle}</p>
          </div>

          <div className="flex w-full min-w-0 items-center gap-3 xl:w-auto">
            <ClientSearchInput
              id="meal-overview-header-search"
              value={searchTerm}
              onChange={setSearchTerm}
              className="flex-1 xl:w-64 xl:flex-none"
            />
            <NotificationBell />
            <Link
              to="/profile"
              className="shrink-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              aria-label="Profil sayfasına git"
            >
              <DietitianAvatar
                alt="Profil"
                className="h-10 w-10 rounded-full border-2 border-white object-cover shadow-sm"
              />
            </Link>
          </div>
        </header>

        <div className="mb-6 flex justify-start xl:mb-8 xl:justify-end" role="group" aria-label="Öğün takip aralığı">
          <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto">
            {VIEW_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                aria-pressed={filter === value}
                data-testid={`meal-overview-filter-${value}`}
                onClick={() => setFilter(value)}
                className={`min-h-11 rounded-xl border px-5 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${filter === value ? 'border-primary bg-primary/5 text-primary' : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="meal-overview-title">
          <div className="flex flex-col gap-4 border-b border-slate-100 p-5 sm:p-6 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 id="meal-overview-title" className="text-xl font-bold text-slate-800">Toplu görünüm</h2>
              <p className="mt-1 text-sm text-slate-500">{cardSubtitle}</p>
            </div>
            <ClientSearchInput
              id="meal-overview-card-search"
              value={searchTerm}
              onChange={setSearchTerm}
              className="w-full md:w-72"
            />
          </div>

          {viewState.status === 'loading' && <OverviewLoadingState />}

          {viewState.status === 'error' && (
            <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center" role="alert">
              <RefreshCw className="h-9 w-9 text-rose-400" aria-hidden="true" />
              <h3 className="mt-4 font-semibold text-slate-800">Öğün takip özeti yüklenemedi.</h3>
              <p className="mt-2 max-w-md text-sm leading-6 text-slate-500">{viewState.message}</p>
              <button
                type="button"
                onClick={() => void loadOverview()}
                className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Tekrar dene
              </button>
            </div>
          )}

          {viewState.status === 'ready' && viewState.clients.length === 0 && (
            <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center" role="status">
              <Info className="h-9 w-9 text-slate-300" aria-hidden="true" />
              <p className="mt-4 font-semibold text-slate-700">Henüz aktif danışanınız bulunmuyor.</p>
              <p className="mt-2 text-sm text-slate-500">Aktif bir danışan bağlantısı oluşturulduğunda burada görünecek.</p>
            </div>
          )}

          {viewState.status === 'ready' && viewState.clients.length > 0 && emptySearch && (
            <div className="flex min-h-64 flex-col items-center justify-center p-6 text-center" role="status">
              <Search className="h-9 w-9 text-slate-300" aria-hidden="true" />
              <p className="mt-4 font-semibold text-slate-700">Aramanızla eşleşen aktif danışan bulunamadı.</p>
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                className="mt-4 inline-flex min-h-11 items-center rounded-xl px-4 py-2 text-sm font-semibold text-primary transition-colors hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
              >
                Aramayı temizle
              </button>
            </div>
          )}

          {viewState.status === 'ready' && visibleClients.length > 0 && (
            <>
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full min-w-[980px] text-left">
                  <thead className="bg-slate-50/70">
                    <tr>
                      <th scope="col" className="px-6 py-4 text-xs font-semibold text-slate-500">Danışan</th>
                      <th scope="col" className="px-6 py-4 text-xs font-semibold text-slate-500">Öğün İlerlemesi</th>
                      <th scope="col" className="px-6 py-4 text-xs font-semibold text-slate-500">Öğün Durumu (Özet)</th>
                      <th scope="col" className="px-6 py-4 text-xs font-semibold text-slate-500">Son Güncelleme</th>
                      <th scope="col" className="px-6 py-4 text-right text-xs font-semibold text-slate-500"><span className="sr-only">İşlem</span></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleClients.map((client) => (
                      <OverviewTableRow key={client.clientId} client={client} today={today} />
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-3 p-4 md:hidden">
                {visibleClients.map((client) => (
                  <OverviewClientCard key={client.clientId} client={client} today={today} />
                ))}
              </div>

              <div className="flex items-start gap-2 border-t border-slate-100 px-5 py-4 text-xs leading-5 text-slate-400 sm:px-6">
                <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>
                  {filter === 'today'
                    ? 'Öğün ilerlemesi, bugün için gerçekten planlanan öğünlere göre hesaplanmaktadır.'
                    : 'Öğün ilerlemesi, seçili 7 günlük dönemdeki gerçekten planlanan öğünlere göre hesaplanmaktadır.'}
                </p>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default MealTrackingOverviewPage;
