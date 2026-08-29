
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { APP_LOGO } from '../../../shared/constants';
import { User, Mail, Lock, CheckCircle2, AlertCircle, ArrowRight, BarChart3, ShieldCheck, Users, Eye, EyeOff } from 'lucide-react';
import { registerDietitian, RegistrationData } from '../../dietitians/services/dietitianService';

const RegisterPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmationEmail, setConfirmationEmail] = useState<string | null>(null);
  const [showPasswords, setShowPasswords] = useState(false);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    passwordConfirm: '',
    isConfirmed: false
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, isConfirmed: e.target.checked }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const normalizedFirstName = formData.firstName?.trim() || '';
    const normalizedLastName = formData.lastName?.trim() || '';

    if (!normalizedFirstName || !normalizedLastName) {
      setError("Lütfen adınızı ve soyadınızı eksiksiz girin.");
      return;
    }

    if (formData.password !== formData.passwordConfirm) {
      setError("Şifreler eşleşmiyor.");
      return;
    }
    if (!formData.isConfirmed) {
      setError("Lütfen lisanslı diyetisyen olduğunuzu onaylayın.");
      return;
    }
    setLoading(true);

    const payload: RegistrationData = {
      email: formData.email,
      password: formData.password,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
    };

    const result = await registerDietitian(payload);

    if (result.success && result.status === 'email_confirmation_required') {
      setConfirmationEmail(formData.email.trim());
    } else if (result.status === 'incomplete_profile') {
      setLoading(false);
      navigate('/complete-registration', {
        replace: true,
        state: { message: result.error || 'Profil kurulumu tamamlanmadı.' },
      });
      return;
    } else {
      setError(result.error || "Kayıt sırasında bir hata oluştu.");
    }
    setLoading(false);
  };

  if (confirmationEmail) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3faf7] px-4 py-8">
        <div className="w-full max-w-lg rounded-[2rem] border border-slate-100 bg-white p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.1)] sm:p-12">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-10 w-10" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#10233f]">E-posta adresinizi doğrulayın</h2>
          <p className="mt-4 text-base leading-7 text-slate-500">
            <span className="font-semibold text-slate-700">{confirmationEmail}</span> adresine gönderilen bağlantıyı açın.
            Doğrulama sonrasında mesleki başvurunuzu tamamlayabilirsiniz.
          </p>
          <Link
            to="/login"
            className="mt-8 inline-flex min-h-14 w-full items-center justify-center rounded-xl bg-primary px-5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-primary-dark focus:outline-none focus:ring-4 focus:ring-emerald-500/20"
          >
            Giriş Sayfasına Dön
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#f3faf7] text-slate-900">
      <div className="mx-auto flex w-full max-w-[1560px] flex-col gap-4 px-4 py-3 sm:px-6 lg:flex-row lg:items-start lg:gap-6 lg:px-10 lg:py-4">
        <aside className="relative flex min-h-[360px] flex-col overflow-hidden rounded-[2rem] border border-white/80 bg-white/75 px-6 py-6 shadow-[0_24px_70px_rgba(29,78,57,0.08)] backdrop-blur sm:px-8 sm:py-8 lg:sticky lg:top-4 lg:min-h-[calc(100vh-2rem)] lg:w-[360px] lg:shrink-0 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0 lg:py-3 lg:shadow-none">
          <div className="pointer-events-none absolute -bottom-40 -left-36 h-80 w-80 rounded-full border-[28px] border-emerald-100/60 lg:-left-48" aria-hidden="true" />
          <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-emerald-100/50 blur-3xl" aria-hidden="true" />

          <div className="relative flex items-center gap-3">
            <img src={APP_LOGO} alt="DietBridge" className="h-10 w-10 object-contain" />
            <span className="text-xl font-semibold tracking-tight text-[#10233f]">DietBridge</span>
          </div>

          <div className="relative mt-10 lg:mt-16">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">DİYETİSYENLER İÇİN AKILLI YÖNETİM</p>
            <h1 className="mt-5 text-4xl font-semibold leading-[1.08] tracking-tight text-[#10233f]">Diyetisyen Kaydı</h1>
            <p className="mt-5 max-w-sm text-base leading-7 text-slate-500">Önce hesabınızı oluşturun, e-posta doğrulamasından sonra mesleki başvurunuzu tamamlayın.</p>
          </div>

          <div className="relative mt-8 space-y-4 lg:mt-12">
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-600 shadow-sm">
                <Users className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#10233f]">Danışan Yönetimi</p>
                <p className="mt-1 text-sm leading-5 text-slate-500">Tüm danışanlarınızı düzenli olarak takip edin ve ilerlemelerini kolayca yönetin.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-600 shadow-sm">
                <BarChart3 className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#10233f]">Akıllı Takip</p>
                <p className="mt-1 text-sm leading-5 text-slate-500">Gelişmeleri analiz edin, raporlar oluşturun ve süreci veriye dayalı yönetin.</p>
              </div>
            </div>
            <div className="flex items-start gap-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-emerald-100 bg-white text-emerald-600 shadow-sm">
                <ShieldCheck className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-[#10233f]">Güvenli ve Güvenilir</p>
                <p className="mt-1 text-sm leading-5 text-slate-500">Verileriniz bizimle güvende. Yüksek güvenlik standartları ile korunur.</p>
              </div>
            </div>
          </div>

          <div className="relative mt-8 border-t border-slate-200/80 pt-5 text-xs text-slate-400 lg:mt-auto">
            <p>© 2025 DietBridge. Tüm hakları saklıdır.</p>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
              <span>Gizlilik Politikası</span>
              <span aria-hidden="true">·</span>
              <span>Kullanım Şartları</span>
            </div>
          </div>
        </aside>

        <main className="w-full lg:flex-1">
          <div className="mx-auto max-w-[1000px] rounded-[2rem] border border-slate-100 bg-white px-4 py-5 shadow-[0_24px_70px_rgba(15,23,42,0.1)] sm:px-7 sm:py-6 lg:px-10 lg:py-6">
            <div className="flex flex-col items-center text-center">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-50">
                <img src={APP_LOGO} alt="DietBridge" className="h-7 w-7 object-contain" />
              </div>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#10233f]">Hesap Oluştur</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">Diyetisyen başvurunuz için hesap bilgilerinizi oluşturun.</p>
            </div>

            {error && (
              <div id="register-error" role="alert" className="mt-5 flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            <form onSubmit={handleSubmit} className="mt-6 space-y-3">
              <section className="rounded-2xl border border-slate-200/80 bg-slate-50/40 p-4" aria-labelledby="personal-info-heading">
                <div className="flex items-center gap-3 border-b border-slate-200/80 pb-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <User className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 id="personal-info-heading" className="text-base font-semibold text-[#10233f]">Kişisel Bilgiler</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Sizi tanımamız için temel bilgilerinizi paylaşın.</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="register-first-name" className="text-xs font-semibold text-[#10233f]">Ad</label>
                    <input id="register-first-name" type="text" name="firstName" required value={formData.firstName} onChange={handleChange} placeholder="Adınızı girin" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="register-last-name" className="text-xs font-semibold text-[#10233f]">Soyad</label>
                    <input id="register-last-name" type="text" name="lastName" required value={formData.lastName} onChange={handleChange} placeholder="Soyadınızı girin" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="register-email" className="text-xs font-semibold text-[#10233f]">E-posta</label>
                    <div className="relative">
                      <Mail className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      <input id="register-email" type="email" name="email" required value={formData.email} onChange={handleChange} placeholder="ornek@eposta.com" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200/80 bg-slate-50/40 p-4" aria-labelledby="security-heading">
                <div className="flex items-center gap-3 border-b border-slate-200/80 pb-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <Lock className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 id="security-heading" className="text-base font-semibold text-[#10233f]">Güvenlik</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Hesabınız için güçlü bir şifre oluşturun.</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1">
                    <label htmlFor="register-password" className="text-xs font-semibold text-[#10233f]">Şifre</label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      <input id="register-password" type={showPasswords ? 'text' : 'password'} name="password" required value={formData.password} onChange={handleChange} placeholder="En az 8 karakter" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-12 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                      <button
                        type="button"
                        aria-label={showPasswords ? 'Şifreleri gizle' : 'Şifreleri göster'}
                        aria-pressed={showPasswords}
                        onClick={() => setShowPasswords(previous => !previous)}
                        className="absolute right-3 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 transition hover:text-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                      >
                        {showPasswords ? <EyeOff className="h-4 w-4" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}
                      </button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="register-password-confirm" className="text-xs font-semibold text-[#10233f]">Şifre Tekrar</label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      <input id="register-password-confirm" type={showPasswords ? 'text' : 'password'} name="passwordConfirm" required value={formData.passwordConfirm} onChange={handleChange} placeholder="Şifrenizi tekrar girin" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                    </div>
                  </div>
                </div>
              </section>

              <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3">
                <input type="checkbox" id="confirm-license" checked={formData.isConfirmed} onChange={handleCheckboxChange} className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-emerald-500/30" />
                <label htmlFor="confirm-license" className="text-sm leading-6 text-slate-600">
                  Lisanslı bir diyetisyen olduğumu ve <a href="https://dietbridge.com.tr/kullanim-kosullari" target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 hover:underline">Kullanım Koşulları</a>'nı kabul ediyorum.
                </label>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="inline-flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-sm font-semibold text-white shadow-lg shadow-emerald-500/20 transition hover:bg-primary-dark focus:outline-none focus:ring-4 focus:ring-emerald-500/20 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-70"
              >
                {loading ? (
                  <div className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                ) : (
                  <>
                    Hesap Oluştur <ArrowRight className="h-5 w-5" aria-hidden="true" />
                  </>
                )}
              </button>

              <div className="border-t border-slate-100 pt-5 text-center">
                <p className="text-sm text-slate-500">
                  Zaten hesabınız var mı? <Link to="/login" className="font-semibold text-emerald-600 hover:text-emerald-700 hover:underline focus:outline-none focus:ring-2 focus:ring-emerald-500/30">Giriş Yap</Link>
                </p>
              </div>
            </form>
          </div>
        </main>
      </div>
    </div>
  );
};

export default RegisterPage;
