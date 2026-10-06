import type { ReactNode } from 'react';
import { Card } from './Card';
import Icon, { type IconName } from './Icon';
import { Skeleton } from './States';
import { cx } from './cx';

export interface KpiTileProps {
  label: ReactNode;
  /** İki tonlu ikon önerilir (ör. "users-three-duotone"); marka renginde 22px çizilir. */
  icon?: IconName;
  value: ReactNode;
  /** Değerin yanında küçük birim (ör. "kg"). */
  unit?: ReactNode;
  /** Değerin altındaki açıklama satırı. */
  hint?: ReactNode;
  /** Açıklamanın başında renkli vurgu (ör. "▲ 3 puan"). */
  trend?: { text: ReactNode; tone: 'ok' | 'bad' | 'neutral' };
  /** Veri yüklenirken değer yerine iskelet gösterir. */
  loading?: boolean;
  className?: string;
}

/**
 * Prototipteki .kpi kutucuğu: ikon + etiket, büyük değer, açıklama.
 * Değeri yalnızca gerçek veriden verin; veri yoksa "—" gösterin.
 */
export const KpiTile = ({ label, icon, value, unit, hint, trend, loading = false, className }: KpiTileProps) => (
  <Card padding="none" className={cx('flex flex-col gap-1 px-5 py-[18px]', className)} aria-busy={loading || undefined}>
    <p className="m-0 flex items-center gap-2 text-13 font-medium text-ink-2">
      {icon && <Icon name={icon} size={22} className="text-brand" />}
      {label}
    </p>
    {loading ? (
      <Skeleton className="my-1 h-7 w-20" />
    ) : (
      <p className="m-0 text-28 font-bold tracking-[-0.6px] text-ink tabular-nums">
        {value}
        {unit && <small className="ml-[3px] text-15 font-semibold tracking-normal text-ink-2">{unit}</small>}
      </p>
    )}
    {(hint || trend) && (
      <p className="m-0 text-12.5 text-ink-3">
        {trend && (
          <span className={cx('font-semibold', trend.tone === 'ok' && 'text-ok', trend.tone === 'bad' && 'text-bad', trend.tone === 'neutral' && 'text-ink-2')}>
            {trend.text}
          </span>
        )}
        {trend && hint && ' '}
        {hint}
      </p>
    )}
  </Card>
);

export interface KpiGridProps {
  columns?: 3 | 4;
  className?: string;
  children: ReactNode;
}

/** KPI kutucuklarını 3 veya 4 sütunlu ızgarada dizer (dar ekranda tek sütun). */
export const KpiGrid = ({ columns = 4, className, children }: KpiGridProps) => (
  <div
    className={cx(
      'mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2',
      columns === 4 ? 'xl:grid-cols-4' : 'lg:grid-cols-3',
      className,
    )}
  >
    {children}
  </div>
);
