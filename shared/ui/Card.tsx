import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { cx } from './cx';
import type { NativeDivProps } from './nativeProps';

type CardElement = 'div' | 'section' | 'article' | 'aside' | 'li';

export type CardProps = NativeDivProps & {
  as?: CardElement;
  /** "md" prototipteki .cp dolgusu (20px 22px). Tablo/liste kartlarında "none" kullanın. */
  padding?: 'none' | 'sm' | 'md';
};

const paddings = { none: '', sm: 'p-4', md: 'px-[22px] py-5' } as const;

/** Prototipteki .card: beyaz yüzey, ince kenar, 14px köşe, hafif gölge. */
export const Card = ({ as: Element = 'div', padding = 'md', className, children, ...rest }: CardProps) => (
  <Element
    className={cx('rounded-card border border-line bg-surface shadow-card', paddings[padding], className)}
    {...rest}
  >
    {children}
  </Element>
);

export interface CardHeaderProps {
  title: ReactNode;
  /** Başlık düzeyi; sayfa içindeki kart başlıkları için varsayılan h2. */
  as?: 'h2' | 'h3';
  /** Başlığın hemen yanında (ör. sayı rozeti). */
  addon?: ReactNode;
  /** Sağ tarafta düğmeler. */
  actions?: ReactNode;
  /** Sağ tarafta "Tümü →" tarzı bağlantı. */
  link?: { to: string; label: string };
  /** Başlık altında kısa açıklama. */
  description?: ReactNode;
  /** Kart dolgusuz kullanılıyorsa başlığa dolgu ekler. */
  padded?: boolean;
  className?: string;
  id?: string;
}

/** Prototipteki .ch: 16px yarı kalın başlık + sağda eylem veya bağlantı. */
export const CardHeader = ({
  title,
  as: Heading = 'h2',
  addon,
  actions,
  link,
  description,
  padded = false,
  className,
  id,
}: CardHeaderProps) => (
  <div className={cx('mb-3.5 flex items-center gap-2.5', padded && 'px-[22px] pt-5', className)}>
    <div className="min-w-0">
      <div className="flex items-center gap-2.5">
        <Heading id={id} className="m-0 text-16 font-semibold tracking-[-0.1px] text-ink">
          {title}
        </Heading>
        {addon}
      </div>
      {description && <p className="m-0 mt-0.5 text-13 text-ink-2">{description}</p>}
    </div>
    {(actions || link) && (
      <div className="ml-auto flex shrink-0 items-center gap-2">
        {actions}
        {link && (
          <Link
            to={link.to}
            className="inline-flex items-center gap-1 rounded-tag text-13 font-semibold text-brand hover:text-brand-hi focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {link.label}
            <Icon name="arrow-right" size={15} />
          </Link>
        )}
      </div>
    )}
  </div>
);

/** Prototipteki .hr: kart içinde ince ayraç. */
export const Divider = ({ className }: { className?: string }) => (
  <hr className={cx('my-3.5 h-px border-0 bg-line', className)} />
);
