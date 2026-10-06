import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon';
import { cx } from './cx';

export interface PageHeaderProps {
  title: ReactNode;
  /** Başlığın üstünde küçük soluk satır (ör. "Pazar, 4 Ekim 2026"). */
  eyebrow?: ReactNode;
  /** Başlığın altında açıklama (ör. danışan özeti). */
  description?: ReactNode;
  /** Başlığın hemen sağında (ör. "Aktif" rozeti). */
  titleAddon?: ReactNode;
  /** Başlığın solunda (ör. danışan profilinde büyük avatar). */
  leading?: ReactNode;
  /** Üstte "← Danışanlara dön" bağlantısı. */
  back?: { to: string; label: string };
  /** Sağ tarafta arama, bildirim, birincil düğme vb. */
  actions?: ReactNode;
  className?: string;
}

/**
 * Prototipteki .ph sayfa başlığı: 26px kalın h1, isteğe bağlı üst satır, açıklama ve sağda eylemler.
 * Her sayfada tek bir h1 olmalı; PageHeader bunu sağlar.
 */
export const PageHeader = ({ title, eyebrow, description, titleAddon, leading, back, actions, className }: PageHeaderProps) => (
  <header className={cx('mb-[22px]', className)}>
    {back && (
      <Link
        to={back.to}
        className="mb-2.5 inline-flex items-center gap-1.5 rounded-tag text-13 text-ink-2 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <Icon name="arrow-left" size={16} />
        {back.label}
      </Link>
    )}
    <div className="flex flex-wrap items-start gap-3 md:flex-nowrap">
      {leading}
      <div className="min-w-0 flex-1">
        {eyebrow && <p className="m-0 text-13 text-ink-3">{eyebrow}</p>}
        <div className="flex flex-wrap items-center gap-2.5">
          <h1 className="m-0 text-26 font-bold tracking-[-0.5px] text-ink">{title}</h1>
          {titleAddon}
        </div>
        {description && <div className="mt-1 text-14 text-ink-2">{description}</div>}
      </div>
      {actions && <div className="flex w-full flex-wrap items-center gap-3 md:w-auto md:flex-nowrap">{actions}</div>}
    </div>
  </header>
);

export interface PageContainerProps {
  /** "wide" (varsayılan) prototipteki .page: 28px 32px 40px dolgu, en fazla 1440px. "full" sohbet gibi kenarsız ekranlar için. */
  variant?: 'wide' | 'full';
  className?: string;
  children: ReactNode;
}

/** Sayfa içeriğini kabuk içinde prototipteki boşluklarla yerleştirir. */
export const PageContainer = ({ variant = 'wide', className, children }: PageContainerProps) => (
  <div className={cx(variant === 'wide' ? 'max-w-[1440px] px-4 py-5 md:px-8 md:pb-10 md:pt-7' : 'h-full', 'text-14 text-ink', className)}>
    {children}
  </div>
);
