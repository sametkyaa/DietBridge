import type { CSSProperties, ReactNode } from 'react';
import { Button } from './Button';
import Icon, { type IconName } from './Icon';
import Spinner from './Spinner';
import { cx } from './cx';

export interface SkeletonProps {
  className?: string;
  style?: CSSProperties;
  /** Daire biçiminde (avatar yer tutucusu). */
  circle?: boolean;
}

/** Yükleme sırasında içerik yer tutucusu. Boyutu className ile verin (ör. "h-4 w-32"). */
export const Skeleton = ({ className, style, circle = false }: SkeletonProps) => (
  <span
    aria-hidden="true"
    className={cx('block animate-pulse bg-sunk', circle ? 'rounded-full' : 'rounded-tag', className)}
    style={style}
  />
);

export interface LoadingStateProps {
  /** Ekran okuyucuya ve (spinner türünde) ekrana yazılan metin. */
  label?: string;
  /** "spinner": ortalanmış gösterge + metin; "skeleton": satır iskeletleri. */
  variant?: 'spinner' | 'skeleton';
  /** skeleton türünde satır sayısı. */
  rows?: number;
  className?: string;
}

/** Yükleniyor durumu. role="status" ile duyurulur; boş veya hata durumundan ayrı tutun. */
export const LoadingState = ({ label = 'Yükleniyor…', variant = 'spinner', rows = 4, className }: LoadingStateProps) => {
  if (variant === 'skeleton') {
    return (
      <div role="status" aria-live="polite" className={cx('flex flex-col', className)}>
        <span className="sr-only">{label}</span>
        {Array.from({ length: rows }, (_, index) => (
          <div key={index} className="flex items-center gap-3 border-t border-line px-5 py-3.5 first:border-t-0">
            <Skeleton circle className="h-9 w-9" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-3.5 w-2/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
            <Skeleton className="h-3.5 w-16" />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div
      role="status"
      aria-live="polite"
      className={cx('flex flex-col items-center justify-center gap-3 px-6 py-12 text-13.5 text-ink-2', className)}
    >
      <Spinner size={22} className="text-brand" />
      <span>{label}</span>
    </div>
  );
};

export interface EmptyStateProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: IconName;
  /** Birincil eylem (ör. "Danışan davet et" düğmesi). */
  action?: ReactNode;
  /** Kart içinde daha az dikey boşluk. */
  compact?: boolean;
  className?: string;
}

/** Boş durum: veri başarıyla yüklendi ama gösterilecek kayıt yok. */
export const EmptyState = ({ title, description, icon, action, compact = false, className }: EmptyStateProps) => (
  <div className={cx('flex flex-col items-center text-center', compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12', className)}>
    {icon && (
      <span className="grid h-11 w-11 place-items-center rounded-[11px] bg-sunk text-ink-3">
        <Icon name={icon} size={21} />
      </span>
    )}
    <p className="m-0 text-15 font-semibold text-ink">{title}</p>
    {description && <p className="m-0 max-w-sm text-13.5 text-ink-2">{description}</p>}
    {action && <div className="mt-1 flex flex-wrap justify-center gap-2">{action}</div>}
  </div>
);

export interface ErrorStateProps {
  title?: ReactNode;
  /** Kullanıcıya gösterilecek anlaşılır mesaj. Teknik Supabase hata nesnesini vermeyin. */
  description?: ReactNode;
  /** Verilirse "Tekrar dene" düğmesi gösterilir. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Yeniden deneme sürerken düğmeyi kilitler. */
  retrying?: boolean;
  compact?: boolean;
  className?: string;
}

/** Hata durumu: yükleme başarısız oldu. role="alert" ile duyurulur. */
export const ErrorState = ({
  title = 'Veriler yüklenemedi',
  description = 'Bağlantınızı kontrol edip tekrar deneyin.',
  onRetry,
  retryLabel = 'Tekrar dene',
  retrying = false,
  compact = false,
  className,
}: ErrorStateProps) => (
  <div role="alert" className={cx('flex flex-col items-center text-center', compact ? 'gap-2 px-4 py-6' : 'gap-3 px-6 py-12', className)}>
    <span className="grid h-11 w-11 place-items-center rounded-[11px] bg-bad-bg text-bad">
      <Icon name="warning-circle" size={21} />
    </span>
    <p className="m-0 text-15 font-semibold text-ink">{title}</p>
    {description && <p className="m-0 max-w-sm text-13.5 text-ink-2">{description}</p>}
    {onRetry && (
      <Button size="sm" loading={retrying} onClick={onRetry} className="mt-1">
        {retryLabel}
      </Button>
    )}
  </div>
);

export type CalloutTone = 'info' | 'warn' | 'bad' | 'ok' | 'mute';

const calloutTones: Record<CalloutTone, { box: string; icon: IconName }> = {
  info: { box: 'bg-info-bg text-info', icon: 'info' },
  warn: { box: 'bg-warn-bg text-warn-ink', icon: 'warning' },
  bad: { box: 'bg-bad-bg text-bad', icon: 'warning-circle' },
  ok: { box: 'bg-ok-bg text-ok-ink', icon: 'check-circle' },
  mute: { box: 'bg-sunk text-ink-2', icon: 'info' },
};

export interface CalloutProps {
  tone?: CalloutTone;
  /** Varsayılan ikon tonu izler; `false` ikonu gizler. */
  icon?: IconName | false;
  /** "alert" form hataları gibi hemen duyurulması gerekenler için. */
  role?: 'alert' | 'status';
  className?: string;
  children: ReactNode;
}

/** Prototipteki .callout: ikonlu bilgi/uyarı kutusu (ör. modal içindeki "bu hafta 1 randevunuz daha var"). */
export const Callout = ({ tone = 'info', icon, role, className, children }: CalloutProps) => {
  const toneStyle = calloutTones[tone];
  const iconName = icon === false ? null : icon ?? toneStyle.icon;
  return (
    <div role={role} className={cx('flex items-start gap-2.5 rounded-db px-[13px] py-[11px] text-13', toneStyle.box, className)}>
      {iconName && <Icon name={iconName} size={16} className="mt-0.5" />}
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
};

export interface ProgressBarProps {
  /** 0–100 arası değer; aralık dışı değerler sınırlandırılır. */
  value: number;
  tone?: 'brand' | 'warn' | 'bad';
  /** Erişilebilir ad (ör. "Öğün uyumu"). */
  label: string;
  /** Ekran okuyucu için değer metni (ör. "%86"). */
  valueText?: string;
  className?: string;
}

/** Prototipteki .prog: 8px yuvarlak ilerleme çubuğu. */
export const ProgressBar = ({ value, tone = 'brand', label, valueText, className }: ProgressBarProps) => {
  const clamped = Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(clamped)}
      aria-valuetext={valueText}
      className={cx('h-2 flex-1 overflow-hidden rounded-full bg-sunk', className)}
    >
      <span
        className={cx(
          'block h-full rounded-full',
          tone === 'brand' && 'bg-brand',
          tone === 'warn' && 'bg-[#D9A24C]',
          tone === 'bad' && 'bg-[#D56A5F]',
        )}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
};
