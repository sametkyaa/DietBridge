import { createContext } from 'react';
import type { UseNotificationsResult } from '../hooks/useNotifications';
import type { useBrowserNotifications } from '../hooks/useBrowserNotifications';

export type NotificationTab = 'all' | 'unread';

export interface NotificationCenterContextValue extends UseNotificationsResult {
  browserAlerts: ReturnType<typeof useBrowserNotifications>;
  activeTab: NotificationTab;
  setActiveTab: (tab: NotificationTab) => void;
  isOpen: boolean;
  open: (opener?: HTMLElement | null) => void;
  close: () => void;
  toggle: (opener?: HTMLElement | null) => void;
}

export const NotificationCenterContext = createContext<NotificationCenterContextValue | null>(null);
