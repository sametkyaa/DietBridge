
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { APP_LOGO } from '../../../shared/constants';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Cloud,
  Lock,
  Mail,
  MessageCircle,
  ShieldCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const getSafeReturnPath = (state: unknown): string => {
  if (!state || typeof state !== 'object') return '/';
  const candidate = (state as { from?: unknown }).from;
  return typeof candidate === 'string' && candidate.startsWith('/') && !candidate.startsWith('//')
    ? candidate
    : '/';
};

const LoginPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, accessState, authError } = useAuth();
  const returnPath = getSafeReturnPath(location.state);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (location.state?.error) {
      setError(location.state.error);
      // Clean up the state so it doesn't persist on refresh
      window.history.replaceState({}, document.title);
    }
  }, [location.state]);

  useEffect(() => {
    if (accessState.status === 'incomplete_registration') {
      navigate('/complete-registration', { replace: true });
      return;
    }
    if (['allowed', 'pending', 'rejected', 'blocked_missing_role', 'blocked_missing_dietitian_profile', 'access_error'].includes(accessState.status)) {
      navigate(returnPath, { replace: true });
    }
  }, [accessState.status, navigate, returnPath]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const result = await signIn(email, password);
    if (!result.success) setError(result.error || 'Giriş yapılamadı.');
    setLoading(false);
  };

  const displayError = error || authError || ('message' in accessState ? accessState.message : null);
  const isResolvingAccess = accessState.status === 'initializing' || accessState.status === 'resolving_access';

  return (
    <div className="min-h-screen bg-[#f3faf7] text-slate-900">
      <div className="mx-auto flex min-h-screen w-full max-w-[1560px] flex-col gap-6 px-4 py-4 sm:px-6 lg:flex-row lg:items-stretch lg:gap-8 lg:px-10 lg:py-6">
        <section className="relative flex min-h-[430px] flex-1 flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white/75 px-7 py-8 shadow-[0_24px_70px_rgba(29,78,57,0.08)] backdrop-blur sm:px-10 sm:py-10 lg:min-h-[calc(100vh-3rem)] lg:px-12 lg:pt-9 lg:pb-16">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-emerald-100/60 blur-3xl" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-40 -left-28 h-80 w-80 rounded-full border-[30px] border-emerald-100/50" aria-hidden="true" />
          <div className="pointer-events-none absolute right-10 top-12 grid grid-cols-4 gap-3 opacity-40" aria-hidden="true">
            {Array.from({ length: 16 }).map((_, index) => (
              <span key={index} className="h-1.5 w-1.5 rounded-full bg-emerald-200" />
            ))}
          </div>

          <div className="relative flex items-center gap-3">
            <img src={APP_LOGO} alt="DietBridge" className="h-10 w-10 object-contain" />
            <span className="text-xl font-semibold tracking-tight text-[#10233f]">DietBridge</span>
          </div>

          <div className="relative mt-14 max-w-2xl sm:mt-20 lg:mt-16">
            <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-emerald-600">DİYETİSYENLER İÇİN AKILLI YÖNETİM</p>
            <h2 className="max-w-2xl text-4xl font-semibold leading-[1.08] tracking-tight text-[#10233f] sm:text-5xl xl:text-[3.65rem]">
              Diyetisyen yönetimini{' '}
              <span className="text-emerald-500">tek merkezde toplayın</span>
            </h2>
            <p className="mt-4 max-w-xl text-base leading-7 text-slate-500 sm:text-lg">
              Danışan takibi, öğün planları, analizler ve mesajlaşmayı tek bir düzenli sistemde yönetin. DietBridge ile sürecinizi daha hızlı, daha düzenli ve daha profesyonel yönetin.
            </p>
          </div>

          <div className="relative mt-10 grid max-w-2xl gap-4 sm:mt-14 sm:grid-cols-3 sm:gap-5 lg:mt-auto lg:pt-10">
            <div className="flex items-start gap-3 sm:block">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-600 sm:mb-4">
                <Users className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="pt-2 text-sm font-semibold leading-5 text-[#10233f] sm:pt-0">Danışan takibi ve ilerleme analizi</p>
            </div>
            <div className="flex items-start gap-3 sm:block">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-600 sm:mb-4">
                <CalendarDays className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="pt-2 text-sm font-semibold leading-5 text-[#10233f] sm:pt-0">Beslenme planları ve öğün yönetimi</p>
            </div>
            <div className="flex items-start gap-3 sm:block">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-emerald-50 text-emerald-600 sm:mb-4">
                <MessageCircle className="h-5 w-5" aria-hidden="true" />
              </div>
              <p className="pt-2 text-sm font-semibold leading-5 text-[#10233f] sm:pt-0">Mesajlaşma ve günlük süreç kontrolü</p>
            </div>
          </div>

          <div className="relative mt-10 grid gap-3 border-t border-slate-200/80 pt-6 sm:mt-12 sm:grid-cols-3 sm:gap-5 lg:mt-8">
            <div className="flex items-center gap-3">
              <ShieldCheck className="h-7 w-7 shrink-0 text-emerald-500" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-[#10233f]">Verileriniz güvende</p>
                <p className="mt-1 text-[11px] text-slate-500">256-bit şifreleme ile korunur</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Lock className="h-7 w-7 shrink-0 text-emerald-500" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-[#10233f]">KVKK uyumlu</p>
                <p className="mt-1 text-[11px] text-slate-500">Kişisel verileriniz korunur</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Cloud className="h-7 w-7 shrink-0 text-emerald-500" aria-hidden="true" />
              <div>
                <p className="text-xs font-semibold text-[#10233f]">Güvenilir altyapı</p>
                <p className="mt-1 text-[11px] text-slate-500">Kesintisiz ve hızlı hizmet</p>
              </div>
            </div>
          </div>
        </section>

        <section className="flex w-full items-center lg:max-w-[500px] lg:flex-[0.72]">
          <div className="w-full rounded-[2rem] border border-slate-100 bg-white px-6 py-8 shadow-[0_24px_70px_rgba(15,23,42,0.1)] sm:px-10 sm:py-11 lg:px-11">
            <div className="flex flex-col items-center text-center">
              <div className="flex items-center gap-3">
                <img src={APP_LOGO} alt="DietBridge" className="h-11 w-11 object-contain" />
                <span className="text-2xl font-semibold tracking-tight text-[#10233f]">DietBridge</span>
              </div>
              <h1 className="mt-10 text-3xl font-semibold tracking-tight text-[#10233f]">DietBridge'e Giriş Yap</h1>
              <p className="mt-3 max-w-sm text-sm leading-6 text-slate-500">Danışanlarınızı yönetmek için hesabınıza erişin.</p>
            </div>

            {displayError && (
              <div id="login-error" role="alert" className="mt-8 flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{displayError}</span>
              </div>
            )}

            <form onSubmit={handleLogin} className="mt-9 space-y-5">
              <div className="space-y-2">
                <label htmlFor="login-email" className="text-sm font-semibold text-[#10233f]">E-posta</label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    id="login-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="ornek@email.com"
                    aria-describedby={displayError ? 'login-error' : undefined}
                    className="min-h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label htmlFor="login-password" className="text-sm font-semibold text-[#10233f]">Şifre</label>
                <div className="relative">
                  <Lock className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                  <input
                    id="login-password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Şifrenizi girin"
                    aria-describedby={displayError ? 'login-error' : undefined}
                    className="min-h-14 w-full rounded-xl border border-slate-200 bg-white pl-12 pr-4 text-sm font-medium text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || isResolvingAccess}
                className="mt-3 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-primary-dark focus:outline-none focus:ring-4 focus:ring-emerald-500/20 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading || isResolvingAccess ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    Giriş Yap <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </>
                )}
              </button>

              <div className="text-center">
                <Link to="/forgot-password" className="text-sm font-semibold text-emerald-600 transition hover:text-emerald-700 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-500/30">
                  Şifremi unuttum
                </Link>
              </div>
            </form>

            <div className="mt-10 border-t border-slate-100 pt-7 text-center">
              <p className="text-sm text-slate-500">
                Hesabınız yok mu?{' '}
                <Link to="/register" className="font-semibold text-emerald-600 transition hover:text-emerald-700 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-500/30">Kayıt Ol</Link>
              </p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
};

export default LoginPage;
