import React, { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import NotificationBell from '../../notifications/components/NotificationBell';
import {
  fetchMealTrackingOverview,
  getMealTrackingUserMessage,
} from '../services/mealTrackingService';
import {
  formatMealTrackingCompletionTime,
  formatMealTrackingLastCompletedAt,
  getMealTrackingRange,
  hasUnmarkedMeals,
  isMealPastDue,
  summarizeMealTrackingOverviewKpis,
} from '../utils/mealTrackingContract';
import { getIstanbulDateKey } from '../../analytics/utils/analyticsContract';
import type {
  MealTrackingFilter,
  MealTrackingOverviewClient,
  MealTrackingOverviewMealEntry,
  MealTrackingOverviewTypeEntry,
} from '../types/mealTracking';
import {
  Card,
  EmptyState,
  ErrorState,
  Icon,
  KpiGrid,
  KpiTile,
  LinkButton,
  LoadingState,
  PageContainer,
  PageHeader,
  PersonCell,
  ProgressBar,
  SearchInput,
  SegmentedControl,
  TBody,
  THead,
  Table,
  TableCard,
  Td,
  Th,
  Tr,
  cx,
  iconButtonClasses,
} from '../../../shared/ui';

type OverviewViewState =
  | { status: 'loading' }
  | { status: 'ready'; clients: MealTrackingOverviewClient[] }
  | { status: 'error'; message: string };

type OverviewView = Exclude<MealTrackingFilter, 'date'>;
type RowFilter = 'all' | 'unmarked' | 'no_plan';

const VIEW_OPTIONS: Array<{ value: OverviewView; label: string }> = [
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

const istanbulNowTime = (): string => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

type ChipTone = 'done' | 'miss' | 'wait';

const chipClasses: Record<ChipTone, { box: string; dot: string }> = {
  done: { box: 'border-transparent bg-ok-bg text-ok-ink', dot: 'bg-ok text-white' },
  miss: { box: 'border-transparent bg-bad-bg text-bad', dot: 'bg-bad text-white' },
  wait: { box: 'border-line bg-surface text-ink-2', dot: 'bg-sunk text-ink-3' },
};

const MealChip = ({ tone, label, time, title, photo }: { tone: ChipTone; label: string; time?: string | null; title: string; photo?: boolean }) => (
  <span title={title} className={cx('inline-flex h-[30px] items-center gap-1.5 whitespace-nowrap rounded-full border pl-1 pr-[11px] text-12.5 font-semibold', chipClasses[tone].box)}>
    <span aria-hidden="true" className={cx('grid h-[22px] w-[22px] place-items-center rounded-full', chipClasses[tone].dot)}>
      {tone === 'done' ? <Icon name="check" size={12} /> : tone === 'miss' ? <Icon name="x" size={12} /> : null}
    </span>
    {label}
    {time && <span className="font-medium tabular-nums opacity-80">{time}</span>}
    {photo && <Icon name="camera" size={14} className="opacity-80" title="Fotoğraflı" />}
  </span>
);

const todayEntryTone = (entry: MealTrackingOverviewMealEntry, nowTime: string): ChipTone => {
  if (entry.status === 'completed') return 'done';
  if (entry.status === 'unmarked' || isMealPastDue(entry, true, nowTime)) return 'miss';
  return 'wait';
};

const todayEntryStatus = (entry: MealTrackingOverviewMealEntry, nowTime: string): string => {
  if (entry.status === 'completed') {
    const time = formatMealTrackingCompletionTime(entry.completedAt ?? null);
    return `Tamamlandı${time ? ` · ${time}` : ''}${entry.hasCompletionPhoto ? ' · fotoğraflı' : ''}`;
  }
  return todayEntryTone(entry, nowTime) === 'miss' ? 'Saati geçti, işaretlenmedi' : 'Bekliyor';
};

const typeEntryTone = (entry: MealTrackingOverviewTypeEntry): ChipTone => (
  entry.status === 'complete' ? 'done' : entry.status === 'unmarked' ? 'miss' : 'wait'
);

const typeEntryStatus = (entry: MealTrackingOverviewTypeEntry): string => {
  if (entry.status === 'complete') return 'Tamamı tamamlandı';
  if (entry.status === 'partial') return 'Kısmi tamamlandı';
  return 'Tamamlanma yok';
};

const MealSummary: React.FC<{ client: MealTrackingOverviewClient; view: OverviewView; nowTime: string }> = ({ client, view, nowTime }) => {
  if (client.plannedCount === 0) {
    return (
      <span className="flex flex-wrap items-center gap-2.5 text-13 text-ink-3">
        {view === 'today' ? 'Bugün için plan yok' : 'Bu dönemde planlı öğün yok'}
        <LinkButton to="/meal-plans" state={{ clientId: client.clientId }} variant="secondary" size="sm" leftIcon="plus">Plan oluştur</LinkButton>
      </span>
    );
  }

  if (client.mealSummary.length === 0) {
    return <span className="text-13 text-ink-3">Özet bulunmuyor</span>;
  }

  return (
    <ul className="m-0 flex min-w-0 list-none flex-wrap items-center gap-1.5 p-0" aria-label="Öğün durumu özeti">
      {client.mealSummary.map((entry) => (
        entry.kind === 'meal' ? (
          <Fragment key={entry.id}>
            <li aria-label={`${entry.label}: ${todayEntryStatus(entry, nowTime)}`}>
              <MealChip
                tone={todayEntryTone(entry, nowTime)}
                label={entry.label.split(' · ')[0]}
                time={entry.time}
                title={`${entry.title} — ${todayEntryStatus(entry, nowTime)}`}
                photo={entry.hasCompletionPhoto}
              />
            </li>
          </Fragment>
        ) : (
          <Fragment key={entry.type}>
            <li aria-label={`${entry.label} ${entry.completedCount}/${entry.plannedCount}: ${typeEntryStatus(entry)}`}>
              <MealChip tone={typeEntryTone(entry)} label={`${entry.label} ${entry.completedCount}/${entry.plannedCount}`} title={typeEntryStatus(entry)} />
            </li>
          </Fragment>
        )
      ))}
    </ul>
  );
};

const Progress: React.FC<{ client: MealTrackingOverviewClient; missed: boolean }> = ({ client, missed }) => {
  if (client.plannedCount === 0) return <span className="text-ink-3">—</span>;
  return (
    <span className="flex min-w-[130px] items-center gap-2.5" aria-label={`Öğün ilerlemesi: ${client.completedCount}/${client.plannedCount} (%${client.percentage ?? 0})`}>
      <ProgressBar value={client.percentage ?? 0} tone={missed ? 'bad' : 'brand'} label="Tamamlanan öğün oranı" valueText={`%${client.percentage ?? 0}`} />
      <b className="whitespace-nowrap tabular-nums">{client.completedCount} / {client.plannedCount}</b>
    </span>
  );
};

const MealTrackingOverviewPage = () => {
  const [filter, setFilter] = useState<OverviewView>('today');
  const [rowFilter, setRowFilter] = useState<RowFilter>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [viewState, setViewState] = useState<OverviewViewState>({ status: 'loading' });
  const [nowTime, setNowTime] = useState(istanbulNowTime);
  const requestSequence = useRef(0);
  const isMounted = useRef(true);

  const range = useMemo(() => getMealTrackingRange(filter), [filter]);
  const today = getIstanbulDateKey();

  const loadOverview = useCallback(async () => {
    const requestId = ++requestSequence.current;
    setViewState({ status: 'loading' });
    setNowTime(istanbulNowTime());

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

  useEffect(() => {
    const timer = window.setInterval(() => setNowTime(istanbulNowTime()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const clients = viewState.status === 'ready' ? viewState.clients : [];
  const kpis = summarizeMealTrackingOverviewKpis(clients, filter, nowTime);
  const normalizedSearchTerm = normalizeClientSearchValue(searchTerm);
  const visibleClients = useMemo(() => {
    if (viewState.status !== 'ready') return [];

    return viewState.clients
      .filter((client) => (
        !normalizedSearchTerm
        || normalizeClientSearchValue(client.displayName).includes(normalizedSearchTerm)
      ))
      .filter((client) => {
        if (rowFilter === 'no_plan') return client.plannedCount === 0;
        if (rowFilter === 'unmarked') return hasUnmarkedMeals(client, filter, nowTime);
        return true;
      })
      .sort(compareOverviewClients);
  }, [filter, normalizedSearchTerm, nowTime, rowFilter, viewState]);

  const unmarkedCount = clients.filter((client) => hasUnmarkedMeals(client, filter, nowTime)).length;
  const noPlanCount = clients.filter((client) => client.plannedCount === 0).length;
  const emptySearch = viewState.status === 'ready'
    && viewState.clients.length > 0
    && visibleClients.length === 0
    && Boolean(normalizedSearchTerm);
  const dueCount = kpis.completedCount + kpis.missedCount;

  return (
    <PageContainer>
      <PageHeader
        eyebrow={<span className="capitalize">{new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())} · {nowTime}</span>}
        title="Öğün takibi"
        description={filter === 'today'
          ? 'Danışanlarınızın bugün için planlanan öğünlere göre tamamlama durumu.'
          : 'Danışanlarınızın son 7 gündeki öğün tamamlama durumu.'}
        actions={(
          <>
            <div role="group" aria-label="Öğün takip aralığı" className="inline-flex gap-0.5 rounded-db border border-line bg-sunk p-[3px]">
              {VIEW_OPTIONS.map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
                  data-testid={`meal-overview-filter-${value}`}
                  onClick={() => setFilter(value)}
                  className={cx(
                    'inline-flex h-8 items-center rounded-[7px] px-[13px] text-13 font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
                    filter === value ? 'bg-brand text-white shadow-seg' : 'text-ink-2 hover:text-ink',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <NotificationBell />
          </>
        )}
      />

      {viewState.status === 'ready' && viewState.clients.length > 0 && (
        <KpiGrid className="mb-5 grid-cols-2 lg:grid-cols-4">
          <KpiTile
            icon="users"
            label={filter === 'today' ? 'Bugün planı olan danışan' : 'Planı olan danışan'}
            value={kpis.clientsWithPlan}
            unit={`/ ${kpis.clientCount}`}
            hint={`Toplam ${kpis.plannedCount} öğün planlandı`}
          />
          <KpiTile
            icon="check-circle"
            label="Tamamlanan"
            value={<span className="text-ok">{kpis.completedCount}</span>}
            hint={filter === 'today' ? `Saati gelen ${dueCount} öğünden` : `${kpis.plannedCount} planlı öğünden`}
          />
          <KpiTile
            icon="warning-circle"
            label={filter === 'today' ? 'Saati geçti, işaretlenmedi' : 'Tamamlanmayan'}
            value={<span className={kpis.missedCount > 0 ? 'text-bad' : undefined}>{kpis.missedCount}</span>}
            hint={`${kpis.missedClientCount} danışan`}
          />
          {filter === 'today' ? (
            <KpiTile icon="clock" label="Zamanı gelmedi" value={kpis.upcomingCount} hint={kpis.nextTime ? `Sıradaki: ${kpis.nextTime}` : 'Bugün başka öğün yok'} />
          ) : (
            <KpiTile
              icon="chart-line-up"
              label="Ortalama uyum"
              value={kpis.plannedCount > 0 ? `%${Math.round((kpis.completedCount / kpis.plannedCount) * 100)}` : '—'}
              hint="Planlı öğünlere göre"
            />
          )}
        </KpiGrid>
      )}

      <TableCard aria-labelledby="meal-overview-title">
        <h2 id="meal-overview-title" className="sr-only">Danışan öğün durumları</h2>
        <div className="flex flex-col gap-3 border-b border-line px-5 py-3.5 lg:flex-row lg:items-center">
          <SearchInput
            id="meal-overview-card-search"
            label="Danışan ara"
            placeholder="Danışan ara..."
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            containerClassName="lg:w-[240px]"
          />
          <SegmentedControl<RowFilter>
            ariaLabel="Danışan durumu filtresi"
            value={rowFilter}
            onChange={setRowFilter}
            className="max-w-full self-start overflow-x-auto"
            options={[
              { value: 'all', label: 'Tümü', count: viewState.status === 'ready' ? clients.length : undefined },
              { value: 'unmarked', label: filter === 'today' ? 'İşaretlenmeyen var' : 'Eksik var', count: viewState.status === 'ready' ? unmarkedCount : undefined },
              { value: 'no_plan', label: 'Planı yok', count: viewState.status === 'ready' ? noPlanCount : undefined },
            ]}
          />
          <div className="flex flex-wrap gap-4 text-12.5 text-ink-2 lg:ml-auto" aria-hidden="true">
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ok" />Tamamlandı</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-bad" />{filter === 'today' ? 'Saati geçti' : 'Tamamlanmadı'}</span>
            <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-line-strong" />{filter === 'today' ? 'Bekliyor' : 'Kısmi'}</span>
          </div>
        </div>

        {viewState.status === 'loading' && <LoadingState label="Öğün takip özeti yükleniyor…" variant="skeleton" rows={4} className="p-5" />}

        {viewState.status === 'error' && (
          <ErrorState title="Öğün takip özeti yüklenemedi." description={viewState.message} onRetry={() => void loadOverview()} retryLabel="Tekrar dene" />
        )}

        {viewState.status === 'ready' && viewState.clients.length === 0 && (
          <EmptyState icon="users" title="Henüz aktif danışanınız bulunmuyor." description="Aktif bir danışan bağlantısı oluşturulduğunda burada görünecek." />
        )}

        {viewState.status === 'ready' && viewState.clients.length > 0 && emptySearch && (
          <EmptyState
            icon="magnifying-glass"
            title="Aramanızla eşleşen aktif danışan bulunamadı."
            action={<button type="button" onClick={() => setSearchTerm('')} className="text-13 font-semibold text-brand">Aramayı temizle</button>}
          />
        )}

        {viewState.status === 'ready' && viewState.clients.length > 0 && !emptySearch && visibleClients.length === 0 && (
          <EmptyState compact icon="check-circle" title={rowFilter === 'no_plan' ? 'Planı olmayan danışan yok.' : 'İşaretlenmemiş öğünü olan danışan yok.'} />
        )}

        {viewState.status === 'ready' && visibleClients.length > 0 && (
          <>
            <div className="hidden md:block">
              <Table caption="Danışan öğün durumları">
                <THead>
                  <Tr>
                    <Th className="w-[210px]">Danışan</Th>
                    <Th>{filter === 'today' ? 'Bugünün öğünleri' : 'Öğün tipine göre'}</Th>
                    <Th className="w-[170px]">Tamamlanan</Th>
                    <Th className="w-[150px]">Son güncelleme</Th>
                    <Th align="right" className="w-[60px]"><span className="sr-only">İşlem</span></Th>
                  </Tr>
                </THead>
                <TBody>
                  {visibleClients.map((client) => (
                    <Fragment key={client.clientId}>
                      <Tr>
                        <Td>
                          <Link to={`/clients/${client.clientId}`} className="block rounded-tag focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
                            <PersonCell name={client.displayName} avatarSrc={client.avatar} />
                          </Link>
                        </Td>
                        <Td wrap className="py-3"><MealSummary client={client} view={filter} nowTime={nowTime} /></Td>
                        <Td><Progress client={client} missed={hasUnmarkedMeals(client, filter, nowTime)} /></Td>
                        <Td className="text-13 text-ink-2">
                          {client.plannedCount === 0 ? '—' : formatMealTrackingLastCompletedAt(client.lastCompletedAt, today) ?? 'Henüz kayıt yok'}
                        </Td>
                        <Td align="right">
                          <Link
                            to={`/clients/${client.clientId}/meal-tracking`}
                            className={iconButtonClasses({ variant: 'outline', size: 'sm' })}
                            aria-label={`${client.displayName} öğün takip detayını aç`}
                            title="Öğün takip detayı"
                          >
                            <Icon name="caret-right" size={17} />
                          </Link>
                        </Td>
                      </Tr>
                    </Fragment>
                  ))}
                </TBody>
              </Table>
            </div>

            <ul className="m-0 flex list-none flex-col gap-3 p-4 md:hidden">
              {visibleClients.map((client) => (
                <Fragment key={client.clientId}>
                  <li>
                    <Card padding="sm">
                      <div className="flex items-center gap-3">
                        <Link to={`/clients/${client.clientId}`} className="min-w-0 flex-1">
                          <PersonCell name={client.displayName} avatarSrc={client.avatar} subtitle={client.plannedCount === 0 ? undefined : `${client.completedCount} / ${client.plannedCount} tamamlandı`} />
                        </Link>
                        <Link
                          to={`/clients/${client.clientId}/meal-tracking`}
                          className={iconButtonClasses({ variant: 'outline', size: 'sm' })}
                          aria-label={`${client.displayName} öğün takip detayını aç`}
                        >
                          <Icon name="caret-right" size={17} />
                        </Link>
                      </div>
                      <div className="mt-3"><MealSummary client={client} view={filter} nowTime={nowTime} /></div>
                    </Card>
                  </li>
                </Fragment>
              ))}
            </ul>

            <p className="m-0 flex items-start gap-2 border-t border-line px-5 py-3.5 text-12 text-ink-3">
              <Icon name="info" size={15} className="mt-px shrink-0" />
              {filter === 'today'
                ? 'Öğün ilerlemesi, bugün için gerçekten planlanan öğünlere göre hesaplanmaktadır.'
                : 'Öğün ilerlemesi, seçili 7 günlük dönemdeki gerçekten planlanan öğünlere göre hesaplanmaktadır.'}
            </p>
          </>
        )}
      </TableCard>
    </PageContainer>
  );
};

export default MealTrackingOverviewPage;
