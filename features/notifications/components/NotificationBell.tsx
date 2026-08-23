import React from 'react';
import { Bell } from 'lucide-react';
import { useNotificationCenter } from '../hooks/useNotificationCenter';

interface NotificationBellProps {
  className?: string;
}

const NotificationBell: React.FC<NotificationBellProps> = ({ className = '' }) => {
  const { unseenCount, isOpen, toggle } = useNotificationCenter();
  const badgeLabel = unseenCount >= 10 ? '9+' : String(unseenCount);
  const accessibleLabel = unseenCount > 0
    ? `Bildirimleri aç, ${unseenCount} okunmamış bildirim`
    : 'Bildirimleri aç';

  return (
    <button
      type="button"
      onClick={(event) => toggle(event.currentTarget)}
      className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${className}`}
      aria-label={accessibleLabel}
      aria-expanded={isOpen}
      aria-controls="notification-center-drawer"
      data-testid="notification-bell"
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {unseenCount > 0 && (
        <span
          className="absolute -right-0.5 -top-0.5 inline-flex min-h-4 min-w-4 items-center justify-center rounded-full border-2 border-white bg-red-500 px-1 text-[10px] font-bold leading-none text-white"
          aria-hidden="true"
          data-testid="notification-badge"
        >
          {badgeLabel}
        </span>
      )}
    </button>
  );
};

export default NotificationBell;
