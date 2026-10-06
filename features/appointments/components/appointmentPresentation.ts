import type { Appointment } from '../../../shared/types';
import type { IconName, Tone } from '../../../shared/ui';

export const APPOINTMENT_TYPE_META: Record<Appointment['type'], { label: string; short: string; icon: IconName; chip: string; dot: string }> = {
  Yüzyüze: { label: 'Yüz yüze', short: 'yüz yüze', icon: 'users', chip: 'bg-ok-bg text-ok-ink', dot: 'bg-ok' },
  'Görüntülü Görüşme': { label: 'Görüntülü', short: 'görüntülü', icon: 'video-camera', chip: 'bg-info-bg text-info', dot: 'bg-info' },
  'Telefon Görüşmesi': { label: 'Telefon', short: 'telefon', icon: 'phone', chip: 'bg-warn-bg text-warn-ink', dot: 'bg-warn' },
};

export const APPOINTMENT_STATUS_META: Record<Appointment['status'], { label: string; tone: Tone }> = {
  upcoming: { label: 'Planlandı', tone: 'brand' },
  completed: { label: 'Tamamlandı', tone: 'ok' },
  cancelled: { label: 'İptal edildi', tone: 'neutral' },
};

export const formatDurationLabel = (duration: Appointment['duration']): string => {
  const minutes = Number(duration);
  if (!Number.isFinite(minutes) || minutes <= 0) return '';
  return minutes === 60 ? '1 saat' : `${minutes} dk`;
};
