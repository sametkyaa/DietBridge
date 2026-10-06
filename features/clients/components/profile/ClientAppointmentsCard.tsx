import { Fragment, useCallback } from 'react';
import { Badge, Card, CardHeader, EmptyState, ErrorState, LinkButton, LoadingState, cx } from '../../../../shared/ui';
import { fetchClientAppointmentsOverview, type ProfileAppointment } from '../../services/clientProfileService';
import { useProfileSection } from '../../hooks/useProfileSection';

const TYPE_LABEL: Record<string, string> = {
  Yüzyüze: 'Yüz yüze',
  'Görüntülü Görüşme': 'Görüntülü',
  'Telefon Görüşmesi': 'Telefon',
};

const formatDay = (dateKey: string, todayKey: string): string => {
  if (dateKey === todayKey) return 'Bugün';
  return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${dateKey}T00:00:00Z`));
};

const Row = ({ appointment, todayKey, past }: { appointment: ProfileAppointment; todayKey: string; past: boolean }) => (
  <li className={cx('flex items-start gap-3 border-t border-line py-2.5 first:border-t-0', !past && appointment.date === todayKey && '-mx-3 rounded-db border-t-transparent bg-brand-tint px-3')}>
    <span className={cx('w-12 shrink-0 font-semibold tabular-nums', past && 'text-ink-3')}>{appointment.time}</span>
    <div className="min-w-0 flex-1">
      <b className={cx('block truncate font-semibold', past && 'text-ink-3')}>{formatDay(appointment.date, todayKey)} · {appointment.title}</b>
      <span className="block text-12 text-ink-3">{TYPE_LABEL[appointment.type] ?? appointment.type}{appointment.duration > 0 ? ` · ${appointment.duration} dk` : ''}</span>
    </div>
    {past && appointment.status === 'completed' && <Badge tone="ok" size="sm">Tamamlandı</Badge>}
  </li>
);

/** Next upcoming and the latest past appointments of this client. */
export const ClientAppointmentsCard = ({ clientId, todayKey, refreshToken }: { clientId: string; todayKey: string; refreshToken: number }) => {
  const loader = useCallback(() => fetchClientAppointmentsOverview(clientId, todayKey), [clientId, todayKey]);
  const { state, reload } = useProfileSection(loader, refreshToken);
  return (
    <Card as="section" aria-labelledby="client-appointments-title">
      <CardHeader
        id="client-appointments-title"
        title="Randevular"
        actions={<LinkButton to="/appointments" variant="ghost" size="sm" leftIcon="calendar-plus">Takvim</LinkButton>}
      />
      {state.status === 'loading' ? (
        <LoadingState label="Randevular yükleniyor…" className="py-4" />
      ) : state.status === 'error' ? (
        <ErrorState compact description="Randevular yüklenemedi." onRetry={() => void reload()} />
      ) : state.data.upcoming.length === 0 && state.data.past.length === 0 ? (
        <EmptyState compact icon="calendar-blank" title="Randevu kaydı yok." />
      ) : (
        <ul className="m-0 list-none p-0">
          {state.data.upcoming.map((appointment) => (
            <Fragment key={appointment.id}><Row appointment={appointment} todayKey={todayKey} past={false} /></Fragment>
          ))}
          {state.data.past.map((appointment) => (
            <Fragment key={appointment.id}><Row appointment={appointment} todayKey={todayKey} past /></Fragment>
          ))}
        </ul>
      )}
    </Card>
  );
};
