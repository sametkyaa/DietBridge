import { useContext } from 'react';
import {
  NotificationCenterContext,
  type NotificationCenterContextValue,
} from '../context/notificationCenterStore';

export const useNotificationCenter = (): NotificationCenterContextValue => {
  const context = useContext(NotificationCenterContext);
  if (!context) {
    throw new Error('useNotificationCenter must be used inside NotificationCenterProvider.');
  }
  return context;
};
