import { createContext, useContext, type ReactNode } from 'react';
import { Avatar, type AvatarTone } from './Avatar';
import { Card } from './Card';
import Icon from './Icon';
import { cx } from './cx';
import type {
  NativeDivProps,
  NativeRowProps,
  NativeTableProps,
  NativeTableSectionProps,
  NativeTdProps,
  NativeThProps,
} from './nativeProps';

type Density = 'default' | 'compact';
const DensityContext = createContext<Density>('default');

export type TableCardProps = NativeDivProps & {
  children: ReactNode;
};

/** Tabloyu saran kart (.card.tcard): köşeleri kırpar, dar ekranda yatay kaydırma verir. */
export const TableCard = ({ className, children, ...rest }: TableCardProps) => (
  <Card padding="none" className={cx('overflow-hidden', className)} {...rest}>
    <div className="overflow-x-auto">{children}</div>
  </Card>
);

export type TableProps = NativeTableProps & {
  /** "compact" satır yüksekliği 46px, varsayılan 60px. */
  density?: Density;
  /** Ekran okuyucu için tablo başlığı (görünmez). */
  caption?: string;
  children: ReactNode;
};

/** Prototipteki table.t. THead/TBody/Tr/Th/Td ile birlikte kullanın. */
export const Table = ({ density = 'default', caption, className, children, ...rest }: TableProps) => (
  <DensityContext.Provider value={density}>
    <table className={cx('w-full border-collapse text-14 text-ink', className)} {...rest}>
      {caption && <caption className="sr-only">{caption}</caption>}
      {children}
    </table>
  </DensityContext.Provider>
);

export const THead = ({ className, children, ...rest }: NativeTableSectionProps) => (
  <thead className={className} {...rest}>
    {children}
  </thead>
);

export const TBody = ({ className, children, ...rest }: NativeTableSectionProps) => (
  <tbody className={cx('[&>tr:last-child>td]:border-b-0 [&>tr:hover>td]:bg-surface-alt', className)} {...rest}>
    {children}
  </tbody>
);

export type TrProps = NativeRowProps & {
  /** Seçili satır vurgusu. */
  selected?: boolean;
};

export const Tr = ({ selected = false, className, children, ...rest }: TrProps) => (
  <tr aria-selected={selected || undefined} className={cx(selected && '[&>td]:bg-brand-tint', className)} {...rest}>
    {children}
  </tr>
);

type Align = 'left' | 'right' | 'center';
const alignClass: Record<Align, string> = { left: 'text-left', right: 'text-right', center: 'text-center' };
const edgePadding = 'first:pl-5 last:pr-5';

export type ThProps = NativeThProps & {
  align?: Align;
};

export const Th = ({ align = 'left', scope = 'col', className, children, ...rest }: ThProps) => (
  <th
    scope={scope}
    className={cx(
      'h-11 whitespace-nowrap border-b border-line bg-surface-alt px-4 text-12.5 font-semibold text-ink-2',
      alignClass[align],
      edgePadding,
      className,
    )}
    {...rest}
  >
    {children}
  </th>
);

export type TdProps = NativeTdProps & {
  align?: Align;
  /** Uzun içerikte satır kaydırmaya izin verir (varsayılan: tek satır). */
  wrap?: boolean;
  /** Sayılar için eşit genişlikli rakamlar. */
  numeric?: boolean;
};

export const Td = ({ align = 'left', wrap = false, numeric = false, className, children, ...rest }: TdProps) => {
  const density = useContext(DensityContext);
  return (
    <td
      className={cx(
        'border-b border-line px-4 align-middle',
        density === 'compact' ? 'h-[46px]' : 'h-[60px]',
        wrap ? 'whitespace-normal py-3' : 'whitespace-nowrap',
        numeric && 'tabular-nums',
        alignClass[align],
        edgePadding,
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
};

export interface PersonCellProps {
  name: string;
  /** Altta soluk satır (ör. e-posta). */
  subtitle?: ReactNode;
  avatarSrc?: string | null;
  avatarTone?: AvatarTone;
  className?: string;
}

/** Prototipteki .who: avatar + kalın ad + soluk alt satır. Bağlantı gerekiyorsa bir Link içine sarın. */
export const PersonCell = ({ name, subtitle, avatarSrc, avatarTone, className }: PersonCellProps) => (
  <span className={cx('flex min-w-0 items-center gap-3', className)}>
    <Avatar name={name} src={avatarSrc} tone={avatarTone} />
    <span className="min-w-0">
      <b className="block truncate font-semibold">{name}</b>
      {subtitle && <span className="block truncate text-12.5 font-normal text-ink-3">{subtitle}</span>}
    </span>
  </span>
);

export interface TableFooterProps {
  /** Solda özet metni (ör. "27 danışandan 1–8 gösteriliyor"). */
  summary?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Prototipteki .tfoot: tablo kartının alt şeridi. */
export const TableFooter = ({ summary, children, className }: TableFooterProps) => (
  <div className={cx('flex flex-wrap items-center gap-2 border-t border-line px-5 py-3 text-13 text-ink-2', className)}>
    {summary && <span>{summary}</span>}
    {children && <div className="ml-auto flex items-center gap-2">{children}</div>}
  </div>
);

export interface PaginationProps {
  /** 1 tabanlı geçerli sayfa. */
  page: number;
  pageCount: number;
  onPageChange: (page: number) => void;
  /** Gösterilecek en fazla sayfa düğmesi (varsayılan 5). */
  maxButtons?: number;
  className?: string;
}

const pageButton =
  'inline-grid h-[34px] min-w-[34px] place-items-center rounded-[8px] border px-2 text-13 font-semibold tabular-nums transition-colors ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-40';

/** Prototipteki .pg sayfalama. Tek sayfa varsa hiçbir şey çizmez. */
export const Pagination = ({ page, pageCount, onPageChange, maxButtons = 5, className }: PaginationProps) => {
  if (pageCount <= 1) return null;
  const half = Math.floor(maxButtons / 2);
  const start = Math.max(1, Math.min(page - half, pageCount - maxButtons + 1));
  const end = Math.min(pageCount, start + maxButtons - 1);
  const pages = Array.from({ length: end - start + 1 }, (_, index) => start + index);
  return (
    <nav aria-label="Sayfalama" className={cx('flex items-center gap-2', className)}>
      <button
        type="button"
        className={cx(pageButton, 'border-line-strong bg-surface text-ink-2 hover:bg-surface-hover')}
        onClick={() => onPageChange(page - 1)}
        disabled={page <= 1}
        aria-label="Önceki sayfa"
      >
        <Icon name="caret-left" size={16} />
      </button>
      {pages.map((value) => (
        <button
          key={value}
          type="button"
          onClick={() => onPageChange(value)}
          aria-current={value === page ? 'page' : undefined}
          aria-label={`Sayfa ${value}`}
          className={cx(
            pageButton,
            value === page ? 'border-brand bg-brand text-white' : 'border-line-strong bg-surface text-ink hover:bg-surface-hover',
          )}
        >
          {value}
        </button>
      ))}
      <button
        type="button"
        className={cx(pageButton, 'border-line-strong bg-surface text-ink-2 hover:bg-surface-hover')}
        onClick={() => onPageChange(page + 1)}
        disabled={page >= pageCount}
        aria-label="Sonraki sayfa"
      >
        <Icon name="caret-right" size={16} />
      </button>
    </nav>
  );
};
