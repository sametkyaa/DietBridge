import { isValidUuid } from '../../../shared/utils/uuid';

export interface BrowserNotificationPreferences {
  desktopEnabled: boolean;
  soundEnabled: boolean;
}

export const DEFAULT_BROWSER_NOTIFICATION_PREFERENCES: BrowserNotificationPreferences = {
  desktopEnabled: false,
  soundEnabled: false,
};

export const browserNotificationPreferenceKey = (userId: string): string => {
  if (!isValidUuid(userId)) throw new Error('Bildirim ayarları için oturum açmanız gerekir.');
  return `dietbridge:web-notifications:v1:${userId}`;
};

export const readBrowserNotificationPreferences = (
  storage: Pick<Storage, 'getItem'>,
  userId: string,
): BrowserNotificationPreferences => {
  const raw = storage.getItem(browserNotificationPreferenceKey(userId));
  if (!raw) return { ...DEFAULT_BROWSER_NOTIFICATION_PREFERENCES };
  try {
    const value = JSON.parse(raw);
    if (value?.version === 1 && typeof value.desktopEnabled === 'boolean' && typeof value.soundEnabled === 'boolean') {
      return { desktopEnabled: value.desktopEnabled, soundEnabled: value.soundEnabled };
    }
  } catch { /* Invalid local preferences are treated as disabled. */ }
  return { ...DEFAULT_BROWSER_NOTIFICATION_PREFERENCES };
};

export const writeBrowserNotificationPreferences = (
  storage: Pick<Storage, 'setItem'>,
  userId: string,
  preferences: BrowserNotificationPreferences,
): void => {
  storage.setItem(browserNotificationPreferenceKey(userId), JSON.stringify({ version: 1, ...preferences }));
};
