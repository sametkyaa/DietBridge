import { Icon, cx } from '../../../shared/ui';
import { iconButtonClasses } from '../../../shared/ui/buttonStyles';
import { useNotificationCenter } from '../hooks/useNotificationCenter';

interface NotificationBellProps {
  className?: string;
}

const NotificationBell = ({ className = '' }: NotificationBellProps) => {
  const { unseenCount, isOpen, toggle } = useNotificationCenter();
  const badgeLabel = unseenCount >= 10 ? '9+' : String(unseenCount);
  const accessibleLabel = unseenCount > 0
    ? `Bildirimleri aç, ${unseenCount} okunmamış bildirim`
    : 'Bildirimleri aç';

  return (
    <button
      type="button"
      onClick={(event) => toggle(event.currentTarget)}
      className={cx(iconButtonClasses(), className)}
      aria-label={accessibleLabel}
      aria-expanded={isOpen}
      aria-controls="notification-center-drawer"
      data-testid="notification-bell"
    >
      <Icon name="bell" size={19} />
      {unseenCount > 0 && (
        <span
          className="absolute -right-1 -top-1 inline-grid h-[18px] min-w-[18px] place-items-center rounded-full border-2 border-surface bg-bad px-1 text-10 font-bold leading-none text-white"
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
