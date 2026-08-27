import { useState } from 'react';
import {
  AlertCircle,
  BadgeCheck,
  CreditCard,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import SubscriptionPanel from '../../subscriptions/components/SubscriptionPanel';
import { useAuth } from '../../auth/context/AuthContext';
import { requestCurrentUserPasswordReset } from '../../auth/services/authService';

type SettingsSection = 'account' | 'billing' | 'security';

const sectionItems: Array<{
  key: SettingsSection;
  label: string;
  description: string;
  icon: LucideIcon;
}> = [
  { key: 'account', label: 'Hesap', description: 'Profil özeti', icon: UserRound },
  { key: 'billing', label: 'Plan ve Ödeme', description: 'Abonelik ve limit', icon: CreditCard },
  { key: 'security', label: 'Güvenlik ve Oturum', description: 'Şifre ve çıkış', icon: ShieldCheck },
];

const profileStatusLabel = (status: string | null | undefined): string => {
  switch (status) {
    case 'approved': return 'Onaylı';
    case 'pending': return 'Onay bekliyor';
    case 'rejected': return 'Reddedildi';
    default: return 'Hazır';
  }
};

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
    <div className="mx-auto min-h-screen max-w-7xl p-4 md:p-8">
      <header className="mb-8">
        <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary">Çalışma alanı</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-800">Ayarlar</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-500">
          Hesabınızı, aboneliğinizi ve oturum güvenliğinizi tek bir yerden yönetin.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-12">
        <aside className="md:col-span-4 lg:col-span-3">
          <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2 shadow-sm md:flex-col" aria-label="Ayarlar bölümleri">
            {sectionItems.map(({ key, label, description, icon: Icon }) => {
              const isActive = activeSection === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setActiveSection(key)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex min-w-max flex-1 items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 md:flex-none md:px-4 ${isActive ? 'bg-emerald-50 text-emerald-700' : 'text-slate-600 hover:bg-slate-50'}`}
                >
                  <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-primary' : 'text-slate-400'}`} aria-hidden="true" />
                  <span className="min-w-0">
                    <span className="block whitespace-nowrap text-sm font-semibold">{label}</span>
                    <span className="hidden text-xs text-slate-400 md:block">{description}</span>
                  </span>
                </button>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 md:col-span-8 lg:col-span-9">
          {activeSection === 'account' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="settings-account-title">
              <div className="flex flex-col gap-4 border-b border-slate-100 pb-6 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="mb-3 inline-flex rounded-xl bg-emerald-50 p-2.5 text-primary"><UserRound className="h-5 w-5" aria-hidden="true" /></div>
                  <h2 id="settings-account-title" className="text-xl font-bold text-slate-800">Hesap</h2>
                  <p className="mt-1 text-sm text-slate-500">Kısa hesap ve profil özeti.</p>
                </div>
                <div className="inline-flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700">
                  <BadgeCheck className="h-4 w-4" aria-hidden="true" />
                  {profileStatusLabel(currentProfileStatus)}
                </div>
              </div>

              <dl className="grid gap-4 py-6 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ad Soyad</dt>
                  <dd className="mt-2 break-words text-sm font-semibold text-slate-800">{accountName}</dd>
                </div>
                <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-4">
                  <dt className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400"><Mail className="h-3.5 w-3.5" aria-hidden="true" /> E-posta</dt>
                  <dd className="mt-2 break-words text-sm font-semibold text-slate-800">{accountEmail || 'Veri yok'}</dd>
                </div>
              </dl>

              <div className="flex flex-col gap-3 border-t border-slate-100 pt-6 sm:flex-row">
                <button
                  type="button"
                  onClick={() => navigate('/profile')}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  Profili Görüntüle
                </button>
                <button
                  type="button"
                  onClick={() => navigate('/profile/edit')}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-primary-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
                >
                  Profili Düzenle
                </button>
              </div>
            </section>
          )}

          {activeSection === 'billing' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="settings-billing-title">
              <div className="mb-6 border-b border-slate-100 pb-6">
                <div className="mb-3 inline-flex rounded-xl bg-blue-50 p-2.5 text-blue-600"><CreditCard className="h-5 w-5" aria-hidden="true" /></div>
                <h2 id="settings-billing-title" className="text-xl font-bold text-slate-800">Plan ve Ödeme</h2>
                <p className="mt-1 text-sm text-slate-500">Mevcut aboneliğinizi ve danışan kullanımınızı görüntüleyin.</p>
              </div>
              <SubscriptionPanel />
            </section>
          )}

          {activeSection === 'security' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7" aria-labelledby="settings-security-title">
              <div className="border-b border-slate-100 pb-6">
                <div className="mb-3 inline-flex rounded-xl bg-violet-50 p-2.5 text-violet-600"><ShieldCheck className="h-5 w-5" aria-hidden="true" /></div>
                <h2 id="settings-security-title" className="text-xl font-bold text-slate-800">Güvenlik ve Oturum</h2>
                <p className="mt-1 text-sm text-slate-500">Oturum erişiminizi koruyun ve hesabınızdan güvenle çıkış yapın.</p>
              </div>

              <div className="py-6">
                <div className="flex flex-col gap-4 rounded-xl border border-slate-100 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="rounded-lg bg-white p-2 text-slate-500 shadow-sm"><Mail className="h-4 w-4" aria-hidden="true" /></div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Hesap e-postası</p>
                      <p className="mt-1 break-words text-sm font-semibold text-slate-800">{accountEmail || 'Veri yok'}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handlePasswordReset()}
                    disabled={isResettingPassword || !accountEmail}
                    className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isResettingPassword ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
                    {isResettingPassword ? 'Gönderiliyor...' : 'Şifre Yenileme Bağlantısı Gönder'}
                  </button>
                </div>
                <p className="mt-3 text-xs leading-5 text-slate-400">Bağlantı, bu hesabın e-posta adresine gönderilir ve şifre yenileme ekranına yönlendirir.</p>
                {resetFeedback && (
                  <div className={`mt-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${resetFeedback.type === 'success' ? 'border-emerald-100 bg-emerald-50 text-emerald-700' : 'border-red-100 bg-red-50 text-red-700'}`} role={resetFeedback.type === 'error' ? 'alert' : 'status'}>
                    {resetFeedback.type === 'success' ? <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
                    <span>{resetFeedback.message}</span>
                  </div>
                )}
              </div>

              <div className="flex flex-col gap-3 border-t border-slate-100 pt-6 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="text-sm font-semibold text-slate-800">Oturumu kapat</p>
                  <p className="mt-1 text-xs text-slate-500">Bu cihazdaki DietBridge oturumunuz sonlandırılır.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void handleSignOut()}
                  disabled={isSigningOut}
                  className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 transition-colors hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSigningOut ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
                  {isSigningOut ? 'Çıkış yapılıyor...' : 'Çıkış Yap'}
                </button>
              </div>
            </section>
          )}
        </main>
      </div>
    </div>
  );
};

export default SettingsPage;
