import { Fragment, useCallback, type ReactNode } from 'react';
import { fetchClientDetails } from '../../clients/services/clientService';
import { fetchClientAppointmentsOverview, fetchClientMealsForDate } from '../../clients/services/clientProfileService';
import { useProfileSection } from '../../clients/hooks/useProfileSection';
import { dietWeekNumber, formatDecimal, parseWeightLabel } from '../../clients/utils/clientProfileContract';
import { MEAL_TYPE_LABELS } from '../../meal-tracking/utils/mealTrackingContract';
import { getDateKeyInTimeZone } from '../../../shared/utils/dateContract';
import { formatPercentageDisplay } from '../../../shared/utils/percentageDisplay';
import { Avatar, ErrorState, Icon, LinkButton, LoadingState, cx } from '../../../shared/ui';

const TYPE_LABEL: Record<string, string> = {
  Yüzyüze: 'yüz yüze',
  'Görüntülü Görüşme': 'görüntülü',
  'Telefon Görüşmesi': 'telefon',
};

const formatAppointmentDay = (dateKey: string, todayKey: string): string => {
  if (dateKey === todayKey) return 'Bugün';
  return new Intl.DateTimeFormat('tr-TR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(new Date(`${dateKey}T00:00:00Z`));
};

const formatCompletedTime = (value: string | null): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('tr-TR', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul' }).format(date);
};

const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-t border-line px-5 py-4">
    <h3 className="m-0 mb-2.5 text-12 font-semibold uppercase tracking-[0.04em] text-ink-3">{title}</h3>
    {children}
  </section>
);

export interface ChatClientSummaryPanelProps {
  clientId: string;
  clientName: string;
  avatarUrl: string | null;
  refreshToken: number;
}

/**
 * Read-only context next to the conversation: goal, weights, adherence, next
 * appointment and today's meals. Every value comes from the same services as
 * the client profile; nothing here writes data.
 */
export const ChatClientSummaryPanel = ({ clientId, clientName, avatarUrl, refreshToken }: ChatClientSummaryPanelProps) => {
  const todayKey = getDateKeyInTimeZone();
  const detailsLoader = useCallback(async () => {
    const result = await fetchClientDetails(clientId);
    if (result.status !== 'active') throw new Error(result.status);
    return result.client;
  }, [clientId]);
  const appointmentsLoader = useCallback(() => fetchClientAppointmentsOverview(clientId, todayKey), [clientId, todayKey]);
  const mealsLoader = useCallback(() => fetchClientMealsForDate(clientId, todayKey), [clientId, todayKey]);
  const details = useProfileSection(detailsLoader, refreshToken);
  const appointments = useProfileSection(appointmentsLoader, refreshToken);
  const meals = useProfileSection(mealsLoader, refreshToken);

  const client = details.state.status === 'success' ? details.state.data : null;
  const week = client ? dietWeekNumber(client.dietStartDate ?? null, todayKey) : null;
  const subtitle = client ? [client.goal, week ? `${week}. hafta` : null].filter(Boolean).join(' · ') : null;
  const current = client ? parseWeightLabel(client.currentWeight) : null;
  const target = client ? parseWeightLabel(client.targetWeight) : null;
  const next = appointments.state.status === 'success' ? appointments.state.data.upcoming[0] ?? null : null;

  return (
    <aside aria-label={`${clientName} özeti`} className="flex min-h-0 w-[300px] shrink-0 flex-col overflow-y-auto rounded-card border border-line bg-surface shadow-card">
      <div className="flex flex-col items-center gap-2 px-5 pb-4 pt-5 text-center">
        <Avatar name={clientName} src={avatarUrl} size="lg" />
        <b className="text-16 font-semibold">{clientName}</b>
        {subtitle && <span className="text-12.5 text-ink-2">{subtitle}</span>}
      </div>

      {details.state.status === 'loading' ? (
        <LoadingState label="Danışan bilgileri yükleniyor…" className="py-4" />
      ) : details.state.status === 'error' ? (
        <ErrorState compact description="Danışan bilgileri yüklenemedi." onRetry={() => void details.reload()} />
      ) : client && (
        <dl className="m-0 grid grid-cols-3 gap-2 border-t border-line px-5 py-4 text-center">
          <div><dt className="text-11.5 text-ink-3">Güncel kilo</dt><dd className="m-0 mt-0.5 font-semibold tabular-nums">{current !== null ? `${formatDecimal(current)} kg` : '—'}</dd></div>
          <div><dt className="text-11.5 text-ink-3">Hedef kilo</dt><dd className="m-0 mt-0.5 font-semibold tabular-nums">{target !== null ? `${formatDecimal(target)} kg` : '—'}</dd></div>
          <div><dt className="text-11.5 text-ink-3">Öğün uyumu (7 gün)</dt><dd className="m-0 mt-0.5 font-semibold tabular-nums">{client.compliance === null ? '—' : formatPercentageDisplay(client.compliance)}</dd></div>
        </dl>
      )}

      <Section title="Sıradaki randevu">
        {appointments.state.status === 'loading' ? (
          <span className="text-13 text-ink-3">Yükleniyor…</span>
        ) : appointments.state.status === 'error' ? (
          <button type="button" className="text-13 font-semibold text-brand" onClick={() => void appointments.reload()}>Randevular yüklenemedi · Tekrar dene</button>
        ) : next ? (
          <div className="flex items-center gap-3">
            <span aria-hidden="true" className="grid h-9 w-9 place-items-center rounded-db bg-brand-tint text-brand"><Icon name="calendar-blank" size={17} /></span>
            <div className="min-w-0">
              <b className="block text-13.5 font-semibold">{formatAppointmentDay(next.date, todayKey)} {next.time}</b>
              <span className="block truncate text-12.5 text-ink-2">{next.title}{TYPE_LABEL[next.type] ? ` · ${TYPE_LABEL[next.type]}` : ''}</span>
            </div>
          </div>
        ) : (
          <span className="text-13 text-ink-3">Planlı randevu yok.</span>
        )}
      </Section>

      <Section title="Bugünkü öğünler">
        {meals.state.status === 'loading' ? (
          <span className="text-13 text-ink-3">Yükleniyor…</span>
        ) : meals.state.status === 'error' ? (
          <button type="button" className="text-13 font-semibold text-brand" onClick={() => void meals.reload()}>Öğünler yüklenemedi · Tekrar dene</button>
        ) : meals.state.data === null || meals.state.data.length === 0 ? (
          <span className="text-13 text-ink-3">Bugün için plan yok.</span>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {meals.state.data.map((meal) => (
              <Fragment key={meal.id}>
                <li className="flex items-center gap-2.5 text-13">
                  <span aria-hidden="true" className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full', meal.isEaten ? 'bg-ok text-white' : 'border border-line-strong text-ink-3')}>
                    {meal.isEaten && <Icon name="check" size={11} />}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-medium">{meal.slotLabel ?? MEAL_TYPE_LABELS[meal.type]}</span>
                  <span className="shrink-0 tabular-nums text-ink-3">
                    <span className="sr-only">{meal.isEaten ? 'Tamamlandı ' : 'Plan '}</span>
                    {meal.isEaten ? formatCompletedTime(meal.completedAt) ?? '✓' : meal.time ? `Plan ${meal.time}` : 'Plan'}
                  </span>
                </li>
              </Fragment>
            ))}
          </ul>
        )}
      </Section>

      <div className="mt-auto border-t border-line px-5 py-4">
        <LinkButton to={`/clients/${clientId}`} variant="secondary" fullWidth leftIcon="user">Profili görüntüle</LinkButton>
      </div>
    </aside>
  );
};
