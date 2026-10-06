import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Icon, IconButton, type IconName } from '../../../shared/ui';
import type { Client } from '../../../shared/types';
import { clientMessagesPath, clientPlanNavigation } from '../utils/clientRoutes';

const MENU_WIDTH = 216;

/**
 * Row action menu. Rendered in a portal with fixed positioning so the table's
 * horizontal scroll container never clips it. Escape closes and returns focus.
 */
export const ClientActionsMenu = ({ client }: { client: Client }) => {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const firstMenuItemRef = useRef<HTMLButtonElement>(null);
  const isActive = client.status === 'Aktif';

  const closeMenu = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    if (restoreFocus) window.requestAnimationFrame(() => moreButtonRef.current?.focus());
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    const rect = moreButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    const estimatedHeight = 4 * 44 + 12;
    const openUp = rect.bottom + estimatedHeight > window.innerHeight - 8 && rect.top > estimatedHeight;
    setPosition({
      top: openUp ? rect.top - estimatedHeight - 4 : rect.bottom + 4,
      left: Math.max(8, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - 8)),
    });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleOutsidePointer = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) return;
      if (menuRef.current?.contains(event.target) || moreButtonRef.current?.contains(event.target)) return;
      closeMenu();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu(true);
      }
    };
    const handleViewportChange = () => closeMenu();
    const focusFrame = window.requestAnimationFrame(() => firstMenuItemRef.current?.focus());
    document.addEventListener('pointerdown', handleOutsidePointer);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', handleViewportChange);
    window.addEventListener('scroll', handleViewportChange, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', handleOutsidePointer);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', handleViewportChange);
      window.removeEventListener('scroll', handleViewportChange, true);
    };
  }, [closeMenu, isOpen]);

  if (!isActive) {
    return (
      <IconButton
        icon="dots-three-vertical"
        label={`${client.name} için işlemler kullanılamıyor`}
        title="Onay bekleyen danışanlar için aktif ilişki gerektiren işlemler kullanılamaz."
        variant="bare"
        size="sm"
        disabled
      />
    );
  }

  const plan = clientPlanNavigation(client.id);
  const items: Array<{ label: string; icon: IconName; to: string; state?: unknown }> = [
    { label: 'Profili Görüntüle', icon: 'user', to: `/clients/${client.id}` },
    { label: 'Mesaj Gönder', icon: 'chat-circle', to: clientMessagesPath(client.id) },
    { label: 'Öğün Takibi', icon: 'fork-knife', to: `/clients/${client.id}/meal-tracking` },
    { label: 'Planı Düzenle', icon: 'pencil-simple', to: plan.to, state: plan.state },
  ];

  return (
    <div onClick={(event) => event.stopPropagation()}>
      <IconButton
        ref={moreButtonRef}
        icon="dots-three-vertical"
        label={`${client.name} için daha fazla işlem`}
        variant="bare"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      />
      {isOpen && position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`${client.name} işlemleri`}
          style={{ position: 'fixed', top: position.top, left: position.left, width: MENU_WIDTH }}
          className="z-[55] rounded-db border border-line bg-surface p-1.5 shadow-pop"
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
            event.preventDefault();
            const buttons: HTMLButtonElement[] = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
            const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
            buttons[next]?.focus();
          }}
        >
          {items.map((item, index) => (
            <button
              key={item.label}
              ref={index === 0 ? firstMenuItemRef : undefined}
              type="button"
              role="menuitem"
              className="flex min-h-11 w-full items-center gap-2.5 rounded-[7px] px-3 text-left text-13.5 font-medium text-ink-2 hover:bg-surface-hover hover:text-ink focus-visible:bg-surface-hover focus-visible:text-ink focus-visible:outline-none"
              onClick={() => { closeMenu(); navigate(item.to, item.state ? { state: item.state } : undefined); }}
            >
              <Icon name={item.icon} size={17} className="text-ink-3" />
              {item.label}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
};
