import type { ReactNode } from 'react';
import Icon, { type IconName } from './Icon';
import { cx } from './cx';

export type Tone = 'neutral' | 'ok' | 'warn' | 'bad' | 'info' | 'brand';

const toneClasses: Record<Tone, string> = {
  neutral: 'bg-sunk text-ink-2',
  ok: 'bg-ok-bg text-ok',
  warn: 'bg-warn-bg text-warn',
  bad: 'bg-bad-bg text-bad',
  info: 'bg-info-bg text-info',
  brand: 'bg-brand-tint text-brand',
};

export interface BadgeProps {
  tone?: Tone;
  /** "md" 26px (varsayılan), "sm" 22px. */
  size?: 'sm' | 'md';
  /** Metinden önce renkli nokta (durum rozeti, ör. "● Aktif"). */
  dot?: boolean;
  icon?: IconName;
  className?: string;
  children: ReactNode;
}

/** Prototipteki .badge: yuvarlak durum rozeti (Aktif, Dikkat, 1 gün gecikti…). */
export const Badge = ({ tone = 'neutral', size = 'md', dot = false, icon, className, children }: BadgeProps) => (
  <span
    className={cx(
      'inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full font-semibold',
      size === 'md' ? 'h-[26px] px-2.5 text-12.5' : 'h-[22px] px-2 text-11.5',
      toneClasses[tone],
      className,
    )}
  >
    {dot && <span aria-hidden="true" className="h-[7px] w-[7px] rounded-full bg-current" />}
    {icon && <Icon name={icon} size={14} />}
    {children}
  </span>
);

export interface ChipProps {
  className?: string;
  children: ReactNode;
}

/** Prototipteki .chip: kenarlıklı nötr etiket (ör. sevmedikleri, filtre özeti). */
export const Chip = ({ className, children }: ChipProps) => (
  <span
    className={cx(
      'inline-flex h-7 items-center whitespace-nowrap rounded-full border border-line bg-sunk px-[11px] text-12.5 font-medium text-ink-2',
      className,
    )}
  >
    {children}
  </span>
);

export interface TagProps {
  tone?: Tone;
  className?: string;
  children: ReactNode;
}

/** Prototipteki .tag-auto: satır içi küçük etiket (ör. "Otomatik"). */
export const Tag = ({ tone = 'info', className, children }: TagProps) => (
  <span className={cx('ml-1.5 inline-block rounded-tag px-1.5 py-px align-[1px] text-11 font-semibold', toneClasses[tone], className)}>
    {children}
  </span>
);

export interface CountPillProps {
  count: number;
  /** "brand" menüdeki dolu yeşil sayaç; "bad" kırmızı; "neutral" sekme sayacı. */
  tone?: 'brand' | 'neutral' | 'bad';
  /** Ekran okuyucu için açıklama (ör. "3 okunmamış mesaj"). Verilmezse dekoratif. */
  label?: string;
  className?: string;
}

/** Menü ve sekmelerdeki sayaç (.nav .cnt, .tabs .c). 99 üstü "99+" olarak gösterilir. */
export const CountPill = ({ count, tone = 'neutral', label, className }: CountPillProps) => (
  <span
    className={cx(
      'inline-grid h-5 min-w-5 place-items-center rounded-full px-1.5 text-11.5 font-semibold tabular-nums',
      tone === 'brand' && 'bg-brand text-white',
      tone === 'neutral' && 'bg-sunk text-ink-2',
      tone === 'bad' && 'bg-bad-bg text-bad',
      className,
    )}
  >
    <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
    {label && <span className="sr-only">{label}</span>}
  </span>
);
