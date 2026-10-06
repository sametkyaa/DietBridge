import type { ReactNode } from 'react';
import { APP_LOGO } from '../../../shared/constants';
import { Icon, type IconName } from '../../../shared/ui';
import { LEGAL_LINKS } from '../utils/legalLinks';

const FEATURES: Array<{ icon: IconName; title: string; text: string }> = [
  { icon: 'users', title: 'Danışan takibi', text: 'Ölçümler, hedefler ve 7 günlük öğün uyumu tek ekranda.' },
  { icon: 'calendar-blank', title: 'Plan ve randevu', text: 'Haftalık beslenme planı, tarifler ve randevu takvimi.' },
  { icon: 'chat-circle', title: 'Mesajlaşma', text: 'Danışanlarınızla uygulama içinden güvenli yazışma.' },
];

export interface AuthLayoutProps {
  children: ReactNode;
  /** Right-hand panel content; defaults to the product overview. */
  aside?: ReactNode;
}

/**
 * Shared shell for login, registration and password pages: form column on
 * the left, a calm brand panel on the right (hidden on small screens). The
 * panel only states what the product does; it shows no sample client data.
 */
export const AuthLayout = ({ children, aside }: AuthLayoutProps) => (
  <div className="min-h-screen bg-canvas text-ink lg:grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <div className="flex min-h-screen flex-col px-5 py-6 sm:px-10 lg:px-16">
      <div className="flex items-center gap-2.5">
        <img src={APP_LOGO} alt="" className="h-9 w-9 object-contain" />
        <span className="text-17 font-bold tracking-[-0.2px]">DietBridge</span>
      </div>
      <main className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-10">{children}</main>
      <footer className="flex flex-wrap gap-x-4 gap-y-1 text-12 text-ink-3">
        <span>© {new Date().getFullYear()} DietBridge</span>
        <a href={LEGAL_LINKS.terms} target="_blank" rel="noopener noreferrer" className="hover:text-ink">Kullanım koşulları</a>
        <a href={LEGAL_LINKS.kvkk} target="_blank" rel="noopener noreferrer" className="hover:text-ink">KVKK</a>
      </footer>
    </div>
    <aside className="hidden min-h-screen flex-col justify-center gap-8 bg-brand px-14 py-12 text-white lg:flex">
      {aside ?? (
        <>
          <h2 className="m-0 max-w-md text-30 font-bold leading-tight tracking-[-0.4px]">Danışan takibiniz, tek bir yerde.</h2>
          <ul className="m-0 flex max-w-md list-none flex-col gap-5 p-0">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex items-start gap-3.5">
                <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-db bg-white/15"><Icon name={feature.icon} size={19} /></span>
                <span>
                  <b className="block text-15 font-semibold">{feature.title}</b>
                  <span className="block text-14 text-white/80">{feature.text}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </aside>
  </div>
);
