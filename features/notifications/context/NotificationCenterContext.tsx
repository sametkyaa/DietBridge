import React, {
  PropsWithChildren,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useNotifications } from '../hooks/useNotifications';
import { useBrowserNotifications } from '../hooks/useBrowserNotifications';
import {
  NotificationCenterContext,
  type NotificationTab,
} from './notificationCenterStore';

export const NotificationCenterProvider = ({ children }: PropsWithChildren) => {
  const [activeTab, setActiveTab] = useState<NotificationTab>('all');
  const [isOpen, setIsOpen] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);

  const open = useCallback((opener?: HTMLElement | null): void => {
    openerRef.current = opener ?? (
      typeof document !== 'undefined' && document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null
    );
    setIsOpen(true);
  }, []);

  const openFromBanner = useCallback(() => open(), [open]);
  const browserAlerts = useBrowserNotifications(openFromBanner);
  const notificationState = useNotifications({
    pageSize: 25,
    unreadOnly: activeTab === 'unread',
    onNotification: browserAlerts.receiveNotification,
  });
  const { seedNotifications } = browserAlerts;
  useEffect(() => { seedNotifications(notificationState.notifications); }, [notificationState.notifications, seedNotifications]);

  const close = useCallback((): void => {
    setIsOpen(false);
    const opener = openerRef.current;
    if (opener) {
      const restoreFocus = () => opener.focus();
      if (typeof window !== 'undefined') window.requestAnimationFrame(restoreFocus);
      else restoreFocus();
    }
  }, []);

  const toggle = useCallback((opener?: HTMLElement | null): void => {
    if (isOpen) close();
    else open(opener);
  }, [close, isOpen, open]);

  return (
    <NotificationCenterContext.Provider value={{
      ...notificationState,
      browserAlerts,
      activeTab,
      setActiveTab,
      isOpen,
      open,
      close,
      toggle,
    }}>
      {children}
    </NotificationCenterContext.Provider>
  );
};
