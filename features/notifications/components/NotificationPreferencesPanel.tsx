import { Badge, Button, Callout, Card, Icon, cx } from '../../../shared/ui';
import { useNotificationCenter } from '../hooks/useNotificationCenter';

const PreferenceSwitch = ({ label, description, checked, disabled, onChange, id }: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (enabled: boolean) => void;
}) => (
  <div className="flex items-center justify-between gap-4 rounded-db border border-line bg-canvas p-4">
    <div className="min-w-0">
      <p id={`${id}-label`} className="m-0 text-14 font-semibold">{label}</p>
      <p id={`${id}-description`} className="m-0 mt-1 text-12.5 leading-5 text-ink-2">{description}</p>
    </div>
    <button
      type="button" role="switch" aria-checked={checked}
      aria-labelledby={`${id}-label`} aria-describedby={`${id}-description`}
      disabled={disabled} onClick={() => onChange(!checked)}
      className={cx('flex min-h-11 shrink-0 items-center gap-2 rounded-control px-2 text-12.5 font-semibold focus-visible:outline-none focus-visible:shadow-focus disabled:cursor-not-allowed disabled:opacity-50', checked ? 'text-brand' : 'text-ink-2')}
    >
      <span aria-hidden="true" className={cx('flex h-6 w-11 items-center rounded-full px-1 transition-colors', checked ? 'justify-end bg-brand' : 'justify-start bg-line')}>
        <span className="h-4 w-4 rounded-full bg-white shadow-card" />
      </span>
      <span aria-hidden="true">{checked ? 'Açık' : 'Kapalı'}</span>
    </button>
  </div>
);

const NotificationPreferencesPanel = () => {
  const { browserAlerts } = useNotificationCenter();
  const { preferences, desktopPermission, feedback, isEnablingDesktop, soundReady } = browserAlerts;
  const denied = desktopPermission === 'denied';
  const unsupported = desktopPermission === 'unsupported';
  return (
    <Card as="section" padding="none" className="p-5 sm:p-6" aria-labelledby="settings-notifications-title">
      <div className="flex items-start gap-3 border-b border-line pb-5">
        <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-sunk text-brand"><Icon name="bell" size={19} /></span>
        <div>
          <h2 id="settings-notifications-title" className="m-0 text-18 font-bold">Bildirimler</h2>
          <p className="m-0 mt-1 text-13.5 text-ink-2">Yeni bildirimler için masaüstü uyarısını ve sesi ayrı ayrı yönetin.</p>
        </div>
      </div>
      <div className="space-y-4 py-5">
        <PreferenceSwitch id="desktop-notifications" label="Masaüstü bildirimleri"
          description="Panel açıkken yeni mesaj ve bildirimleri masaüstünde göster."
          checked={preferences.desktopEnabled}
          disabled={isEnablingDesktop || (!preferences.desktopEnabled && (denied || unsupported))}
          onChange={(enabled) => void browserAlerts.setDesktopEnabled(enabled)} />
        <Badge tone={denied ? 'warn' : 'neutral'}>{isEnablingDesktop ? 'İzin bekleniyor' : unsupported ? 'Bu tarayıcıda desteklenmiyor' : denied ? 'Tarayıcı izni kapalı' : desktopPermission === 'granted' ? 'Tarayıcı izni açık' : 'Açarken tarayıcı izni istenir'}</Badge>
        {denied && <p className="m-0 text-12.5 text-ink-2">Adres çubuğundaki site ayarlarından bildirimlere izin verin, sonra bu sayfaya dönün.</p>}
        <PreferenceSwitch id="notification-sound" label="Bildirim sesi"
          description="Panel açıkken gelen yeni bildirimlerde kısa bir ses çal."
          checked={preferences.soundEnabled} onChange={(enabled) => void browserAlerts.setSoundEnabled(enabled)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="secondary" disabled={!preferences.soundEnabled} onClick={() => void browserAlerts.testSound()}>Sesi dene</Button>
          {preferences.soundEnabled && !soundReady && <p className="m-0 text-12.5 text-ink-2">Sesi başlatmak için sayfaya tıklayın veya Sesi dene butonunu kullanın.</p>}
        </div>
        {feedback && <Callout tone="info" role="status">{feedback}</Callout>}
      </div>
      <p className="m-0 border-t border-line pt-5 text-12.5 leading-5 text-ink-3">Tercihler bu hesap için yalnızca bu tarayıcıda saklanır ve otomatik kaydedilir. Bildirim merkezindeki kayıtlar korunur. Panel tamamen kapalıyken bu uyarılar gelmez. Ses için sekmenin ve cihazın sesi açık olmalıdır.</p>
    </Card>
  );
};

export default NotificationPreferencesPanel;
