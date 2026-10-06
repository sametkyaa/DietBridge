import { Link, NavLink } from 'react-router-dom';
import { APP_LOGO_MARK } from '../constants';
import { useAuth } from '../../features/auth/context/AuthContext';
import { usePlatformAdminAccess } from '../../features/admin/hooks/usePlatformAdminAccess';
import { useDietitianAvatarUrl } from '../hooks/useDietitianAvatarUrl';
import { useUnreadCounts } from '../../features/chat/context/UnreadCountsContext';
import { Avatar, CountPill, Icon, cx, type IconName } from '../ui';

interface NavItem {
  icon: IconName;
  label: string;
  /** Alt menüde yer kazanmak için kısa ad. */
  shortLabel?: string;
  path: string;
  /** Gerçek veriye bağlanınca menüde sayaç gösterir (ör. okunmamış mesaj). */
  count?: number;
}

interface NavGroup {
  /** Grup başlığı; ilk grup başlıksızdır. */
  title?: string;
  items: NavItem[];
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cx(
    'relative flex h-10 items-center gap-3 rounded-control px-3 text-14 font-medium transition-colors',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    isActive
      ? 'bg-brand-tint font-semibold text-brand before:absolute before:-left-3.5 before:bottom-2 before:top-2 before:w-[3px] before:rounded-r-[3px] before:bg-brand'
      : 'text-ink-2 hover:bg-surface-hover hover:text-ink',
  );

/** Menünün altındaki diyetisyen kartı (.me): profil sayfasına gider. */
const SidebarProfileLink = () => {
  const { dietitianProfile } = useAuth();
  const avatarUrl = useDietitianAvatarUrl();
  const fullName = [dietitianProfile?.first_name, dietitianProfile?.last_name]
    .map((part) => part?.trim())
    .filter(Boolean)
    .join(' ');
  const displayName = fullName ? `Dyt. ${fullName}` : 'Profilim';

  return (
    <Link
      to="/profile"
      aria-label={`Profil: ${displayName}`}
      className="mt-6 flex items-center gap-2.5 rounded-xl border border-line p-2.5 transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Avatar name={fullName || 'DietBridge'} src={avatarUrl} />
      <span className="min-w-0 flex-1">
        <b className="block truncate text-13.5 font-semibold">{displayName}</b>
        <span className="block text-12 text-ink-3">Diyetisyen</span>
      </span>
      <Icon name="caret-right" size={16} className="text-ink-3" />
    </Link>
  );
};

const Sidebar = () => {
  const { accessState, session } = useAuth();
  const adminAccess = usePlatformAdminAccess({
    enabled: accessState.status === 'allowed',
    userId: session?.user.id ?? null,
  });
  const { state: unreadState } = useUnreadCounts();
  const unreadMessageCount = unreadState.status === 'success' ? unreadState.total : undefined;

  const navItems: NavItem[] = [
    { icon: 'house', label: 'Panelim', path: '/' },
    { icon: 'calendar-blank', label: 'Randevular', path: '/appointments' },
    { icon: 'chat-circle', label: 'Mesajlar', path: '/messages', count: unreadMessageCount },
    { icon: 'users', label: 'Danışanlar', path: '/clients' },
    { icon: 'fork-knife', label: 'Öğün takibi', path: '/meal-tracking' },
    { icon: 'chart-bar', label: 'Analizler', path: '/analytics' },
    { icon: 'calendar-dots', label: 'Beslenme planı', shortLabel: 'Plan', path: '/meal-plans' },
    { icon: 'bowl-food', label: 'Tarifler', path: '/recipes' },
    { icon: 'note-pencil', label: 'Notlar', path: '/notes' },
    { icon: 'gear', label: 'Ayarlar', path: '/settings' },
  ];
  const byPath = (path: string) => navItems.find((item) => item.path === path) as NavItem;
  const accountItems = adminAccess.status === 'authorized'
    ? [byPath('/settings'), { icon: 'squares-four', label: 'Yönetim', path: '/admin' } satisfies NavItem]
    : [byPath('/settings')];
  const navGroups: NavGroup[] = [
    { items: [byPath('/'), byPath('/appointments'), byPath('/messages')] },
    { title: 'Danışanlar', items: [byPath('/clients'), byPath('/meal-tracking'), byPath('/analytics')] },
    { title: 'Kaynaklar', items: [byPath('/meal-plans'), byPath('/recipes'), byPath('/notes')] },
    { title: 'Hesap', items: accountItems },
  ];

  // Subset for mobile bottom nav to avoid overcrowding
  const mobileNavPaths = ['/', '/appointments', '/clients', '/meal-plans', '/messages'] as const;
  const mobileNavItems = mobileNavPaths
    .map((path) => navItems.find((item) => item.path === path))
    .filter((item): item is (typeof navItems)[number] => item !== undefined);

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="fixed left-0 top-0 z-20 hidden h-screen w-sidebar shrink-0 flex-col overflow-y-auto border-r border-line bg-surface px-3.5 pb-3.5 pt-5 text-14 text-ink md:flex">
        <NavLink
          to="/"
          end
          aria-label="Panelim'e git"
          className="flex items-center gap-2.5 rounded-control px-2.5 pb-[18px] pt-0.5 text-17 font-bold tracking-[-0.2px] text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <img src={APP_LOGO_MARK} alt="" className="h-9 w-[46px] shrink-0 object-contain" />
          <span>DietBridge</span>
        </NavLink>

        <nav aria-label="Ana menü" className="flex flex-col gap-0.5">
          {navGroups.map((group, groupIndex) => (
            <div
              key={group.title ?? 'genel'}
              role="group"
              aria-labelledby={group.title ? `menu-grup-${groupIndex}` : undefined}
              className="flex flex-col gap-0.5"
            >
              {group.title && (
                <p
                  id={`menu-grup-${groupIndex}`}
                  className="mx-3 mb-1.5 mt-4 text-11 font-semibold uppercase tracking-[0.07em] text-ink-3"
                >
                  {group.title}
                </p>
              )}
              {group.items.map((item) => (
                <NavLink key={item.path} to={item.path} end={item.path === '/'} className={navLinkClass}>
                  {({ isActive }) => (
                    <>
                      <Icon name={item.icon} className={isActive ? 'text-brand' : 'text-ink-3'} />
                      <span className="truncate">{item.label}</span>
                      {typeof item.count === 'number' && item.count > 0 && (
                        <CountPill count={item.count} tone="brand" className="ml-auto" label={`${item.count} okunmamış`} />
                      )}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <SidebarProfileLink />
      </aside>

      {/* Mobile Bottom Navigation */}
      <nav
        aria-label="Alt menü"
        className="fixed bottom-0 left-0 right-0 z-50 flex max-w-full items-center justify-around overflow-x-hidden border-t border-line bg-surface px-2 py-1.5 shadow-[0_-4px_6px_-1px_rgba(24,34,29,0.05)] md:hidden"
      >
        {mobileNavItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              cx(
                'flex min-w-0 flex-col items-center gap-1 rounded-control px-2 py-1.5 transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand',
                isActive ? 'text-brand' : 'text-ink-3 hover:text-ink-2',
              )
            }
          >
            <Icon name={item.icon} size={22} />
            <span className="truncate text-10 font-medium">{item.shortLabel ?? item.label}</span>
          </NavLink>
        ))}
      </nav>
    </>
  );
};

export default Sidebar;
