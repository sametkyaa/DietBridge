import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import SubscriptionPanel from '../../subscriptions/components/SubscriptionPanel';
import { useAuth } from '../../auth/context/AuthContext';
import { requestCurrentUserPasswordReset } from '../../auth/services/authService';
import { Badge, Button, Callout, Card, Icon, PageContainer, PageHeader, cx, type IconName, type Tone } from '../../../shared/ui';

type SettingsSection = 'account' | 'billing' | 'security';

const sectionItems: Array<{
  key: SettingsSection;
  label: string;
  description: string;
  icon: IconName;
}> = [
  { key: 'account', label: 'Hesap', description: 'Profil özeti', icon: 'user' },
  { key: 'billing', label: 'Plan ve Ödeme', description: 'Abonelik ve limit', icon: 'sliders-horizontal' },
  { key: 'security', label: 'Güvenlik ve Oturum', description: 'Şifre ve çıkış', icon: 'lock' },
];

const profileStatusLabel = (status: string | null | undefined): string => {
  switch (status) {
    case 'approved': return 'Onaylı';
    case 'pending': return 'Onay bekliyor';
    case 'rejected': return 'Reddedildi';
    default: return 'Hazır';
  }
};

const profileStatusTone = (status: string | null | undefined): Tone => {
  switch (status) {
    case 'approved': return 'ok';
    case 'pending': return 'warn';
    case 'rejected': return 'bad';
    default: return 'neutral';
  }
};

const SectionHeading = ({ id, icon, title, description, addon }: { id: string; icon: IconName; title: string; description: string; addon?: ReactNode }) => (
  <div className="flex flex-col gap-3 border-b border-line pb-5 sm:flex-row sm:items-start sm:justify-between">
    <div className="flex items-start gap-3">
      <span aria-hidden="true" className="grid h-10 w-10 shrink-0 place-items-center rounded-control bg-sunk text-brand"><Icon name={icon} size={19} /></span>
      <div>
        <h2 id={id} className="m-0 text-18 font-bold">{title}</h2>
        <p className="m-0 mt-1 text-13.5 text-ink-2">{description}</p>
      </div>
    </div>
    {addon}
  </div>
);

const SettingsPage = () => {
  const navigate = useNavigate();
  const {
    signOut,
    user,
    dietitianProfile,
    accessState,
  } = useAuth();
  const [activeSection, setActiveSection] = useState<SettingsSection>('account');
  const [isResettingPassword, setIsResettingPassword] = useState(false);
  const [resetFeedback, setResetFeedback] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);
  const [isSigningOut, setIsSigningOut] = useState(false);

  const accountEmail = user?.email?.trim() || dietitianProfile?.email?.trim() || '';
  const metadataName = user?.user_metadata?.full_name;
  const accountName = [dietitianProfile?.first_name, dietitianProfile?.last_name]
    .filter((value): value is string => Boolean(value?.trim()))
    .join(' ')
    || (typeof metadataName === 'string' ? metadataName.trim() : '')
    || 'Diyetisyen hesabı';
  const currentProfileStatus = dietitianProfile?.verification_status
    || (accessState.status === 'pending' ? 'pending' : undefined)
    || (accessState.status === 'rejected' ? 'rejected' : undefined)
    || (accessState.status === 'allowed' ? 'approved' : undefined);

  const handlePasswordReset = async () => {
    if (isResettingPassword || !accountEmail) return;

    setIsResettingPassword(true);
    setResetFeedback(null);
    try {
      const result = await requestCurrentUserPasswordReset();
      if (result.success) {
        setResetFeedback({ type: 'success', message: 'Şifre yenileme bağlantısı e-posta adresinize gönderildi.' });
      } else {
        setResetFeedback({
          type: 'error',
          message: 'userMessage' in result ? result.userMessage : 'Şifre yenileme bağlantısı gönderilemedi. Lütfen tekrar deneyin.',
        });
      }
    } catch {
      setResetFeedback({
        type: 'error',
        message: 'Şifre yenileme bağlantısı gönderilemedi. Lütfen tekrar deneyin.',
      });
    } finally {
      setIsResettingPassword(false);
    }
  };

  const handleSignOut = async () => {
    if (isSigningOut) return;
    setIsSigningOut(true);
    try {
      await signOut();
      navigate('/login');
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Çalışma alanı"
        title="Ayarlar"
        description="Hesabınızı, aboneliğinizi ve oturum güvenliğinizi tek bir yerden yönetin."
      />

      <div className="mt-6 grid grid-cols-1 gap-5 md:grid-cols-12">
        <aside className="md:col-span-4 lg:col-span-3">
          <nav className="flex gap-1.5 overflow-x-auto rounded-card border border-line bg-surface p-2 shadow-card md:flex-col" aria-label="Ayarlar bölümleri">
            {sectionItems.map(({ key, label, description, icon }) => {
              const isActive = activeSection === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveSection(key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={cx(
                    'flex min-h-11 min-w-max flex-1 items-center gap-3 rounded-control px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:shadow-focus md:flex-none',
                    isActive ? 'bg-sunk text-ink' : 'text-ink-2 hover:bg-sunk/60',
                  )}
                >
                  <Icon name={icon} size={18} className={isActive ? 'text-brand' : 'text-ink-3'} />
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap text-14 font-semibold">{label}</span>
                    <span className="hidden text-12 text-ink-3 md:block">{description}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <div className="min-w-0 md:col-span-8 lg:col-span-9">
          {activeSection === 'account' && (
            <Card as="section" padding="none" className="p-5 sm:p-6" aria-labelledby="settings-account-title">
              <SectionHeading
                id="settings-account-title"
                icon="user"
                title="Hesap"
                description="Kısa hesap ve profil özeti."
                addon={<Badge tone={profileStatusTone(currentProfileStatus)} dot className="self-start">{profileStatusLabel(currentProfileStatus)}</Badge>}
              />

              <dl className="m-0 grid gap-3 py-5 sm:grid-cols-2">
                <div className="rounded-db border border-line bg-canvas p-4">
                  <dt className="text-12 font-semibold uppercase tracking-[0.06em] text-ink-3">Ad Soyad</dt>
                  <dd className="m-0 mt-1.5 break-words text-14.5 font-semibold">{accountName}</dd>
                </div>
                <div className="rounded-db border border-line bg-canvas p-4">
                  <dt className="flex items-center gap-1.5 text-12 font-semibold uppercase tracking-[0.06em] text-ink-3"><Icon name="envelope" size={13} /> E-posta</dt>
                  <dd className="m-0 mt-1.5 break-words text-14.5 font-semibold">{accountEmail || 'Veri yok'}</dd>
                </div>
              </dl>

              <div className="flex flex-col gap-2.5 border-t border-line pt-5 sm:flex-row">
                <Button variant="secondary" onClick={() => navigate('/profile')}>Profili Görüntüle</Button>
                <Button variant="primary" leftIcon="pencil-simple" onClick={() => navigate('/profile/edit')}>Profili Düzenle</Button>
              </div>
            </Card>
          )}

          {activeSection === 'billing' && (
            <Card as="section" padding="none" className="p-5 sm:p-6" aria-labelledby="settings-billing-title">
              <SectionHeading
                id="settings-billing-title"
                icon="sliders-horizontal"
                title="Plan ve Ödeme"
                description="Mevcut aboneliğinizi, dönem bilginizi ve danışan kullanımınızı görüntüleyin."
              />
              <div className="pt-5">
                <SubscriptionPanel />
              </div>
            </Card>
          )}

          {activeSection === 'security' && (
            <Card as="section" padding="none" className="p-5 sm:p-6" aria-labelledby="settings-security-title">
              <SectionHeading
                id="settings-security-title"
                icon="lock"
                title="Güvenlik ve Oturum"
                description="Oturum erişiminizi koruyun ve hesabınızdan güvenle çıkış yapın."
              />

              <div className="py-5">
                <div className="flex flex-col gap-4 rounded-db border border-line bg-canvas p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <span aria-hidden="true" className="grid h-9 w-9 shrink-0 place-items-center rounded-control bg-surface text-ink-3 shadow-card"><Icon name="envelope" size={16} /></span>
                    <div className="min-w-0">
                      <p className="m-0 text-12 font-semibold uppercase tracking-[0.06em] text-ink-3">Hesap e-postası</p>
                      <p className="m-0 mt-1 break-words text-14.5 font-semibold">{accountEmail || 'Veri yok'}</p>
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    leftIcon="key"
                    loading={isResettingPassword}
                    disabled={isResettingPassword || !accountEmail}
                    onClick={() => void handlePasswordReset()}
                    className="shrink-0"
                  >
                    {isResettingPassword ? 'Gönderiliyor...' : 'Şifre Yenileme Bağlantısı Gönder'}
                  </Button>
                </div>
                <p className="m-0 mt-3 text-12.5 leading-5 text-ink-3">Bağlantı, bu hesabın e-posta adresine gönderilir ve şifre yenileme ekranına yönlendirir.</p>
                {resetFeedback && (
                  <Callout tone={resetFeedback.type === 'success' ? 'ok' : 'bad'} role={resetFeedback.type === 'error' ? 'alert' : 'status'} className="mt-4">
                    {resetFeedback.message}
                  </Callout>
                )}
              </div>

              <div className="flex flex-col gap-3 border-t border-line pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="m-0 text-14 font-semibold">Oturumu kapat</p>
                  <p className="m-0 mt-1 text-12.5 text-ink-2">Bu cihazdaki DietBridge oturumunuz sonlandırılır.</p>
                </div>
                <Button variant="danger" leftIcon="sign-out" loading={isSigningOut} disabled={isSigningOut} onClick={() => void handleSignOut()}>
                  {isSigningOut ? 'Çıkış yapılıyor...' : 'Çıkış Yap'}
                </Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </PageContainer>
  );
};

export default SettingsPage;
