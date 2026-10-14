import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../../auth/context/AuthContext';
import type { NotificationItem } from '../types/notification';
import {
  browserNotificationPreferenceKey,
  DEFAULT_BROWSER_NOTIFICATION_PREFERENCES,
  readBrowserNotificationPreferences,
  writeBrowserNotificationPreferences,
  type BrowserNotificationPreferences,
} from '../services/browserNotificationPreferences';
import { createBrowserNotificationAlerts } from '../services/browserNotificationAlerts';
import { createNotificationSound } from '../services/notificationSound';

type BrowserPermission = NotificationPermission | 'unsupported';
const permission = (): BrowserPermission => (
  typeof window !== 'undefined' && window.isSecureContext && 'Notification' in window
    ? Notification.permission : 'unsupported'
);

export const useBrowserNotifications = (openCenter: () => void) => {
  const { user, accessState } = useAuth();
  const ownerId = accessState.status === 'allowed' ? user?.id ?? null : null;
  const currentOwner = useRef(ownerId);
  currentOwner.current = ownerId;
  const [preferences, setPreferences] = useState(DEFAULT_BROWSER_NOTIFICATION_PREFERENCES);
  const [desktopPermission, setDesktopPermission] = useState<BrowserPermission>(permission);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isEnablingDesktop, setIsEnablingDesktop] = useState(false);
  const [soundReady, setSoundReady] = useState(false);
  const runtimeRef = useRef<{
    ownerId: string;
    preferences: BrowserNotificationPreferences;
    sound: ReturnType<typeof createNotificationSound>;
    alerts: ReturnType<typeof createBrowserNotificationAlerts>;
  } | null>(null);

  useEffect(() => {
    setPreferences(DEFAULT_BROWSER_NOTIFICATION_PREFERENCES);
    setFeedback(null);
    setIsEnablingDesktop(false);
    setSoundReady(false);
    if (!ownerId) return;
    const sound = createNotificationSound();
    let storage: Storage;
    try { storage = window.localStorage; }
    catch { setFeedback('Bu tarayıcı bildirim tercihlerini saklamaya izin vermiyor.'); return; }
    const runtime = {
      ownerId, sound,
      preferences: { ...DEFAULT_BROWSER_NOTIFICATION_PREFERENCES },
      alerts: createBrowserNotificationAlerts({
        userId: ownerId,
        storage,
        locks: navigator.locks,
        hasFocus: () => document.hasFocus(),
      }),
    };
    runtimeRef.current = runtime;
    const load = () => {
      try {
        runtime.preferences = readBrowserNotificationPreferences(window.localStorage, ownerId);
        setPreferences(runtime.preferences);
      } catch { setFeedback('Bildirim ayarları okunamadı. Tarayıcının yerel depolama iznini kontrol edin.'); }
      setDesktopPermission(permission());
    };
    load();
    const unlock = () => {
      if (!runtime.preferences.soundEnabled) return;
      void sound.unlock().then((ready) => {
        if (runtimeRef.current === runtime) setSoundReady(ready);
      }).catch(() => {
        if (runtimeRef.current === runtime) setFeedback('Ses açılamadı. Sesi dene butonuyla tekrar deneyin.');
      });
    };
    const syncStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === browserNotificationPreferenceKey(ownerId)) load();
    };
    window.addEventListener('storage', syncStorage);
    window.addEventListener('focus', load);
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    return () => {
      runtimeRef.current = null;
      sound.dispose();
      window.removeEventListener('storage', syncStorage);
      window.removeEventListener('focus', load);
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [ownerId]);

  const save = useCallback((next: BrowserNotificationPreferences): boolean => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.ownerId !== currentOwner.current) return false;
    try {
      writeBrowserNotificationPreferences(window.localStorage, runtime.ownerId, next);
      runtime.preferences = next;
      setPreferences(next);
      setFeedback(null);
      return true;
    } catch {
      setFeedback('Tercih kaydedilemedi. Tarayıcının yerel depolama iznini kontrol edin.');
      return false;
    }
  }, []);

  const setDesktopEnabled = useCallback(async (enabled: boolean) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.ownerId !== currentOwner.current || isEnablingDesktop) return;
    if (!enabled) { save({ ...runtime.preferences, desktopEnabled: false }); return; }
    const currentPermission = permission();
    setDesktopPermission(currentPermission);
    if (currentPermission === 'unsupported' || currentPermission === 'denied') return;
    setIsEnablingDesktop(true);
    try {
      const result = currentPermission === 'granted' ? 'granted' : await Notification.requestPermission();
      if (runtimeRef.current !== runtime || runtime.ownerId !== currentOwner.current) return;
      setDesktopPermission(result);
      if (result === 'granted') save({ ...runtime.preferences, desktopEnabled: true });
      else setFeedback('Masaüstü bildirimleri açılmadı. Tarayıcı site izinlerinden bildirimlere izin verebilirsiniz.');
    } catch { if (runtimeRef.current === runtime) setFeedback('Bildirim izni alınamadı. Tarayıcı site izinlerini kontrol edin.'); }
    finally { if (runtimeRef.current === runtime) setIsEnablingDesktop(false); }
  }, [isEnablingDesktop, save]);

  const setSoundEnabled = useCallback(async (enabled: boolean) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.ownerId !== currentOwner.current) return;
    if (!save({ ...runtime.preferences, soundEnabled: enabled }) || !enabled) return;
    try {
      const ready = await runtime.sound.unlock();
      if (runtimeRef.current === runtime) {
        setSoundReady(ready);
        if (!ready) setFeedback('Bu tarayıcı bildirim sesini başlatamadı. Sesi dene butonuyla tekrar deneyin.');
      }
    } catch { if (runtimeRef.current === runtime) setFeedback('Ses başlatılamadı. Sesi dene butonuyla tekrar deneyin.'); }
  }, [save]);

  const testSound = useCallback(async () => {
    const runtime = runtimeRef.current;
    if (!runtime || !runtime.preferences.soundEnabled) return;
    try {
      const ready = await runtime.sound.unlock();
      if (runtimeRef.current !== runtime || currentOwner.current !== runtime.ownerId || !runtime.preferences.soundEnabled) return;
      setSoundReady(ready);
      setFeedback(ready && runtime.sound.play() ? 'Deneme sesi çalındı.' : 'Ses çalınamadı. Sekmenin ve cihazın ses ayarlarını kontrol edin.');
    } catch { if (runtimeRef.current === runtime) setFeedback('Ses çalınamadı. Sekmenin ve cihazın ses ayarlarını kontrol edin.'); }
  }, []);

  const receiveNotification = useCallback((notification: NotificationItem) => {
    const runtime = runtimeRef.current;
    if (!runtime || runtime.ownerId !== currentOwner.current) return;
    const current = () => runtimeRef.current === runtime && currentOwner.current === runtime.ownerId;
    const alertError = () => { if (current()) setFeedback('Bildirim uyarısı gösterilemedi. Tarayıcı izinlerini kontrol edin.'); };
    void runtime.alerts.receive(notification, 'sound', () => current() && runtime.preferences.soundEnabled && runtime.sound.isReady(), runtime.sound.play).catch(alertError);
    void runtime.alerts.receive(notification, 'desktop', () => current() && runtime.preferences.desktopEnabled && permission() === 'granted', () => {
      // Generic copy keeps names and health/message details off the lock screen.
      const banner = new Notification('DietBridge', {
        body: notification.category === 'chat_message' ? 'Yeni bir mesajınız var.' : 'Yeni bir bildiriminiz var.',
        tag: `dietbridge:${runtime.ownerId}`, silent: true,
      });
      banner.onclick = () => { banner.close(); if (current()) { window.focus(); openCenter(); } };
      return true;
    }).catch(alertError);
  }, [openCenter]);

  const seedNotifications = useCallback((notifications: readonly NotificationItem[]) => {
    runtimeRef.current?.alerts.seed(notifications);
  }, []);

  return {
    preferences, desktopPermission, feedback, isEnablingDesktop, soundReady,
    setDesktopEnabled, setSoundEnabled, testSound, receiveNotification, seedNotifications,
  };
};
