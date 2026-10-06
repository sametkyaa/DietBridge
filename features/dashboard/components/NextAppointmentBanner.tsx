import { Icon, LinkButton } from '../../../shared/ui';
import type { Appointment } from '../../../shared/types';
import { formatDateKey } from '../../appointments/utils/appointmentContract';

const TYPE_LABEL: Record<Appointment['type'], string> = {
  'Görüntülü Görüşme': 'görüntülü',
  Yüzyüze: 'yüz yüze',
  'Telefon Görüşmesi': 'telefon',
};

/** Relative start label; other days show the date. */
const formatTimeUntil = (minutes: number, isToday: boolean, dateKey: string): string => {
  if (!isToday) return formatDateKey(dateKey, { weekday: 'long', day: 'numeric', month: 'long' });
  if (minutes <= 0) return 'şimdi';
  if (minutes < 60) return `${minutes} dakika sonra`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} saat sonra` : `${hours} sa ${rest} dk sonra`;
};

export interface NextAppointmentBannerProps {
  appointment: Appointment;
  minutesUntil: number;
  isToday: boolean;
}

/** "Sıradaki randevu" strip for the real next upcoming appointment (no join action). */
export const NextAppointmentBanner = ({ appointment, minutesUntil, isToday }: NextAppointmentBannerProps) => (
  <section
    aria-label="Sıradaki randevu"
    className="mb-5 flex flex-wrap items-center gap-4 rounded-card border border-[#D6E4DA] bg-[linear-gradient(90deg,#E4EEE7,#EEF3EC)] px-5 py-4"
  >
    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[11px] bg-surface text-brand" aria-hidden="true">
      <Icon name="calendar-check" size={19} />
    </span>
    <div className="min-w-0 flex-1">
      <p className="m-0 text-12.5 font-medium text-ink-2">
        Sıradaki randevu · {formatTimeUntil(minutesUntil, isToday, appointment.date)}
      </p>
      <p className="m-0 flex flex-wrap items-center gap-2.5 text-16 font-semibold">
        <span className="tabular-nums">{appointment.time}</span>
        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-ink-3" />
        <span>{appointment.clientName}</span>
        <span aria-hidden="true" className="h-1 w-1 rounded-full bg-ink-3" />
        <span className="font-medium text-ink-2">{appointment.title} · {TYPE_LABEL[appointment.type]}</span>
      </p>
    </div>
    <div className="flex flex-wrap gap-2">
      <LinkButton leftIcon="chat-circle" to={`/messages?clientId=${encodeURIComponent(appointment.clientId)}`}>Mesaj gönder</LinkButton>
      <LinkButton variant="primary" to={`/clients/${encodeURIComponent(appointment.clientId)}`}>Profili görüntüle</LinkButton>
    </div>
  </section>
);
