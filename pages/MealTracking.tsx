import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import ChatImageViewer from '../features/chat/components/ChatImageViewer';
import { getMealImagePreviewUrls } from '../features/meal-plans/services/mealImagePreviewService';
import { getMealCompletionPhotoPreviewUrls } from '../features/meal-plans/services/mealPhotoService';
import {
  fetchMealTracking,
  getMealTrackingUserMessage,
} from '../features/meal-tracking/services/mealTrackingService';
import {
  formatMealTrackingCompletionTime,
  formatMealTrackingDate,
  getMealSlotName,
  getMealTrackingRange,
  getMealTrackingStatus,
  isMealPastDue,
} from '../features/meal-tracking/utils/mealTrackingContract';
import type { MealTrackingDay, MealTrackingFilter } from '../features/meal-tracking/types/mealTracking';
import { getIstanbulDateKey } from '../features/analytics/utils/analyticsContract';
import { isValidUuid } from '../shared/utils/uuid';
import { formatOptionalMealTime } from '../shared/utils/mealTime';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  ErrorState,
  Icon,
  LinkButton,
  LoadingState,
  PageContainer,
  PageHeader,
  cx,
} from '../shared/ui';

type PageStatus = 'loading' | 'ready' | 'error';

const istanbulNowTime = (): string => new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit', hour12: false,
}).format(new Date());

const FILTERS: ReadonlyArray<readonly [Exclude<MealTrackingFilter, 'date'>, string]> = [
  ['today', 'Bugün'],
  ['7d', 'Son 7 Gün'],
];

const MealTracking = () => {
  const { id } = useParams();
  const clientId = isValidUuid(id) ? id : null;
  const [filter, setFilter] = useState<MealTrackingFilter>('today');
  const [selectedDate, setSelectedDate] = useState(() => getIstanbulDateKey());
  const [status, setStatus] = useState<PageStatus>('loading');
  const [days, setDays] = useState<MealTrackingDay[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [photoPreviews, setPhotoPreviews] = useState<Map<string, string>>(new Map());
  const [completionPreviews, setCompletionPreviews] = useState<Map<string, string>>(new Map());
  const [viewer, setViewer] = useState<{ url: string; caption: string } | null>(null);
  const [nowTime, setNowTime] = useState(istanbulNowTime);
  const requestSequence = useRef(0);

  const range = useMemo(() => {
    try {
      return getMealTrackingRange(filter, selectedDate);
    } catch {
      return null;
    }
  }, [filter, selectedDate]);

  const load = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!clientId || !range) {
      setStatus('error');
      setErrorMessage('Danışan bağlantısı geçersiz.');
      setDays([]);
      setPhotoPreviews(new Map());
      setCompletionPreviews(new Map());
      return;
    }

    setStatus('loading');
    setErrorMessage(null);
    setNowTime(istanbulNowTime());
    try {
      const nextDays = await fetchMealTracking(clientId, range.startDate, range.endDate);
      if (requestId !== requestSequence.current) return;
      setDays(nextDays);
      setStatus('ready');

      const meals = nextDays.flatMap((day) => day.meals);
      const references = meals.map((meal) => meal.photoPath).filter((path): path is string => path !== null);
      const completionReferences = meals
        .map((meal) => meal.completionPhotoPath ?? null)
        .filter((path): path is string => path !== null);
      // Previews are best effort: a failed signed URL never hides the real meal records.
      const [previews, completion] = await Promise.all([
        references.length ? getMealImagePreviewUrls(references).catch(() => new Map<string, string>()) : new Map<string, string>(),
        completionReferences.length ? getMealCompletionPhotoPreviewUrls(completionReferences).catch(() => new Map<string, string>()) : new Map<string, string>(),
      ]);
      if (requestId !== requestSequence.current) return;
      setPhotoPreviews(previews);
      setCompletionPreviews(completion);
    } catch (cause) {
      if (requestId !== requestSequence.current) return;
      setStatus('error');
      setDays([]);
      setPhotoPreviews(new Map());
      setCompletionPreviews(new Map());
      setErrorMessage(getMealTrackingUserMessage(cause));
    }
  }, [clientId, range]);

  useEffect(() => {
    void load();
    return () => {
      requestSequence.current += 1;
    };
  }, [load]);

  const today = getIstanbulDateKey();
  const totals = days.reduce((sum, day) => ({ done: sum.done + day.completedCount, planned: sum.planned + day.plannedCount }), { done: 0, planned: 0 });

  return (
    <PageContainer>
      <PageHeader
        back={clientId ? { to: `/clients/${clientId}`, label: 'Danışan profiline dön' } : { to: '/meal-tracking', label: 'Öğün takibine dön' }}
        title="Öğün takibi"
        description="Bu danışanın planlı öğünlerinden hangilerinin tamamlandığını gerçek kayıtlarla görüntüleyin."
        actions={(
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Öğün takip aralığı">
            <div className="inline-flex gap-0.5 rounded-db border border-line bg-sunk p-[3px]">
              {FILTERS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={filter === value}
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
            <label className={cx('inline-flex h-[38px] items-center gap-2 rounded-control border px-3 text-13 font-semibold', filter === 'date' ? 'border-brand bg-brand-tint text-brand' : 'border-line-strong bg-surface text-ink')}>
              <Icon name="calendar-blank" size={16} />
              <input
                type="date"
                value={selectedDate}
                max={today}
                onChange={(event) => {
                  setSelectedDate(event.target.value);
                  setFilter('date');
                }}
                aria-label="Öğün takip tarihi seç"
                className="border-0 bg-transparent p-0 text-13 font-semibold outline-none"
              />
            </label>
          </div>
        )}
      />

      {status === 'loading' && <Card><LoadingState label="Öğün takip kayıtları yükleniyor…" /></Card>}

      {status === 'error' && (
        <Card>
          <ErrorState title="Öğün takip kayıtları yüklenemedi." description={errorMessage ?? undefined} onRetry={() => void load()} retryLabel="Tekrar dene" />
        </Card>
      )}

      {status === 'ready' && days.length === 0 && (
        <Card>
          <EmptyState
            icon="bowl-food"
            title="Bu tarih aralığında planlı öğün bulunmuyor."
            description="Plan oluşturulduğunda tamamlanma durumu burada görünecek."
            action={clientId ? <LinkButton to="/meal-plans" state={{ clientId }} variant="primary" leftIcon="plus">Plan oluştur</LinkButton> : undefined}
          />
        </Card>
      )}

      {status === 'ready' && days.length > 0 && (
        <div className="flex flex-col gap-5">
          {days.length > 1 && (
            <p className="m-0 text-13.5 text-ink-2">
              Seçili dönemde <b className="text-ink">{totals.done} / {totals.planned}</b> öğün tamamlandı
              {totals.planned > 0 ? ` (%${Math.round((totals.done / totals.planned) * 100)})` : ''}.
            </p>
          )}
          {days.map((day) => (
            <Fragment key={day.date}>
              <Card as="section" aria-labelledby={`meal-day-${day.date}`}>
                <CardHeader
                  id={`meal-day-${day.date}`}
                  title={<span className="capitalize">{formatMealTrackingDate(day.date)}{day.date === today ? ' · Bugün' : ''}</span>}
                  actions={(
                    <Badge tone={day.completedCount === day.plannedCount ? 'ok' : day.completedCount === 0 && day.date < today ? 'bad' : 'brand'}>
                      {day.completedCount}/{day.plannedCount} tamamlandı · %{day.percentage ?? 0}
                    </Badge>
                  )}
                />
                <ul className="m-0 list-none p-0">
                  {day.meals.map((meal) => {
                    const mealStatus = getMealTrackingStatus(meal, day.date, today);
                    const late = isMealPastDue({ status: mealStatus, time: meal.time }, day.date === today, nowTime);
                    const completionTime = formatMealTrackingCompletionTime(meal.completedAt);
                    const completionUrl = meal.completionPhotoPath ? completionPreviews.get(meal.completionPhotoPath) ?? null : null;
                    const photoUrl = meal.photoPath ? photoPreviews.get(meal.photoPath) ?? null : null;
                    const statusLabel = mealStatus === 'completed'
                      ? `Tamamlandı${completionTime ? ` · ${completionTime}` : ''}${meal.completionPhotoPath ? ' · fotoğrafla' : ''}`
                      : mealStatus === 'unmarked' ? 'İşaretlenmedi' : late ? 'Saati geçti, işaretlenmedi' : 'Bekliyor';

                    return (
                      <Fragment key={meal.id}>
                        <li className="flex min-w-0 flex-wrap items-center gap-3 border-t border-line py-3 first:border-t-0 sm:flex-nowrap">
                          <span
                            aria-hidden="true"
                            className={cx(
                              'grid h-7 w-7 shrink-0 place-items-center rounded-full',
                              mealStatus === 'completed' ? 'bg-ok text-white' : mealStatus === 'unmarked' || late ? 'bg-bad-bg text-bad' : 'border border-line-strong text-ink-3',
                            )}
                          >
                            <Icon name={mealStatus === 'completed' ? 'check' : mealStatus === 'unmarked' || late ? 'x' : 'clock'} size={14} />
                          </span>
                          <span className="w-12 shrink-0 text-13 font-semibold tabular-nums text-ink-2">{formatOptionalMealTime(meal.time)}</span>
                          <div className="min-w-0 flex-1">
                            <b className="block break-words font-semibold">{getMealSlotName(meal)} · {meal.title}</b>
                            <span className={cx('block text-12.5', mealStatus === 'completed' ? 'text-ok' : mealStatus === 'unmarked' || late ? 'text-bad' : 'text-ink-3')}>
                              {statusLabel}
                            </span>
                          </div>
                          {completionUrl ? (
                            <button
                              type="button"
                              onClick={() => setViewer({ url: completionUrl, caption: `${meal.title} · danışanın fotoğrafı` })}
                              className="group h-14 w-14 shrink-0 overflow-hidden rounded-db border border-line focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                              aria-label={`${meal.title} tamamlanma fotoğrafını büyüt`}
                            >
                              <img src={completionUrl} alt={`${meal.title} tamamlanma fotoğrafı`} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
                            </button>
                          ) : meal.completionPhotoPath ? (
                            <span className="inline-flex shrink-0 items-center gap-1 text-12 text-ink-3" role="status">
                              <Icon name="camera" size={15} />
                              Fotoğraf hazır değil
                            </span>
                          ) : photoUrl ? (
                            <button
                              type="button"
                              onClick={() => setViewer({ url: photoUrl, caption: `${meal.title} · plan görseli` })}
                              className="group h-11 w-11 shrink-0 overflow-hidden rounded-db border border-line opacity-80 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                              aria-label={`${meal.title} plan görselini büyüt`}
                            >
                              <img src={photoUrl} alt={`${meal.title} plan görseli`} className="h-full w-full object-cover" />
                            </button>
                          ) : null}
                        </li>
                      </Fragment>
                    );
                  })}
                </ul>
              </Card>
            </Fragment>
          ))}
        </div>
      )}

      {viewer && <ChatImageViewer url={viewer.url} caption={viewer.caption} onClose={() => setViewer(null)} />}
      <div className="sr-only" aria-live="polite">{range ? `${range.startDate} – ${range.endDate}` : ''}</div>
    </PageContainer>
  );
};

export default MealTracking;
