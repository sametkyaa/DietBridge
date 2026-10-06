import { Fragment } from 'react';
import { Badge, Card, CardHeader, EmptyState, ErrorState, LoadingState } from '../../../shared/ui';
import type { Appointment } from '../../../shared/types';
import { cx } from '../../../shared/ui/cx';

const TYPE_DOT: Record<Appointment['type'], string> = {
  Yüzyüze: 'bg-ok',
  'Görüntülü Görüşme': 'bg-info',
  'Telefon Görüşmesi': 'bg-warn',
};

const TYPE_LABEL: Record<Appointment['type'], string> = {
  Yüzyüze: 'Yüz yüze',
  'Görüntülü Görüşme': 'Görüntülü',
  'Telefon Görüşmesi': 'Telefon',
};

export interface TodayScheduleCardProps {
  appointments: readonly Appointment[];
  loading: boolean;
  error: boolean;
  nowTime: string;
  nextAppointmentId: string | null;
  onRetry: () => void;
}

/** Today's non-cancelled appointments in time order; past ones are dimmed. */
export const TodayScheduleCard = ({ appointments, loading, error, nowTime, nextAppointmentId, onRetry }: TodayScheduleCardProps) => (
  <Card as="section" aria-labelledby="today-schedule-title">
    <CardHeader id="today-schedule-title" title="Bugünün programı" link={{ to: '/appointments', label: 'Takvim' }} />
    {loading ? (
      <LoadingState label="Randevular yükleniyor…" className="py-6" />
    ) : error ? (
      <ErrorState compact description="Bugünkü randevular yüklenemedi." onRetry={onRetry} />
    ) : appointments.length === 0 ? (
      <EmptyState compact icon="calendar-blank" title="Bugün randevu yok." />
    ) : (
      <ul className="m-0 list-none p-0">
        {appointments.map((appointment) => {
          const past = appointment.status === 'completed' || appointment.time < nowTime;
          const current = appointment.id === nextAppointmentId;
          return (
            <Fragment key={appointment.id}>
              <li
                className={cx(
                  'flex items-center gap-3.5 border-t border-line py-3 first:border-t-0',
                  current && '-mx-3 rounded-db border-t-transparent bg-brand-tint px-3',
                )}
              >
                <span className={cx('w-12 font-semibold tabular-nums', past && 'text-ink-3')}>{appointment.time}</span>
                <span aria-hidden="true" className={cx('h-[9px] w-[9px] shrink-0 rounded-full', past ? 'bg-line-strong' : TYPE_DOT[appointment.type])} />
                <div className="min-w-0 flex-1">
                  <b className={cx('block truncate font-semibold', past && 'text-ink-3')}>{appointment.clientName}</b>
                  <span className={cx('block truncate text-12', past ? 'text-ink-3' : 'text-ink-2')}>{appointment.title}</span>
                </div>
                {appointment.status === 'completed' ? (
                  <Badge tone="ok" size="sm">Tamamlandı</Badge>
                ) : current ? (
                  <Badge tone="brand" size="sm">{TYPE_LABEL[appointment.type]}</Badge>
                ) : (
                  <span className={cx('text-12', past ? 'text-ink-3' : 'text-ink-2')}>{TYPE_LABEL[appointment.type]}</span>
                )}
              </li>
            </Fragment>
          );
        })}
      </ul>
    )}
  </Card>
);
