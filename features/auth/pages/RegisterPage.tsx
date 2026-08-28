
import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { APP_LOGO } from '../../../shared/constants';
import { nutritionUniversities } from '../../../shared/constants/nutritionUniversities';
import { User, Mail, Phone, Lock, BookOpen, Briefcase, Award, FileText, Upload, CheckCircle2, AlertCircle, ArrowRight, BarChart3, ShieldCheck, Users, Info } from 'lucide-react';
import { registerDietitian, RegistrationData } from '../../dietitians/services/dietitianService';

const RegisterPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    passwordConfirm: '',
    university: '',
    graduationDate: '',
    experienceYears: '',
    specialization: '',
    bio: '',
    isConfirmed: false
  });

  const [diplomaFile, setDiplomaFile] = useState<File | null>(null);
  const [showUniversityDropdown, setShowUniversityDropdown] = useState(false);
  const universityRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (universityRef.current && !universityRef.current.contains(event.target as Node)) {
        setShowUniversityDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredUniversities = nutritionUniversities.filter(u =>
    u.toLocaleLowerCase('tr-TR').includes(formData.university.toLocaleLowerCase('tr-TR'))
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, isConfirmed: e.target.checked }));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];

      // Client-side Validation
      const maxSize = 5 * 1024 * 1024; // 5MB
      if (file.size > maxSize) {
        setError("Dosya boyutu 5MB'dan büyük olamaz.");
        e.target.value = ''; // Reset input
        setDiplomaFile(null);
        return;
      }

      if (file.type !== 'application/pdf') {
        setError("Lütfen geçerli bir PDF dosyası yükleyiniz.");
        e.target.value = ''; // Reset input
        setDiplomaFile(null);
        return;
      }

      setDiplomaFile(file);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfoMessage(null);

    const normalizedFirstName = formData.firstName?.trim() || '';
    const normalizedLastName = formData.lastName?.trim() || '';

    if (!normalizedFirstName || !normalizedLastName) {
      setError("Lütfen adınızı ve soyadınızı eksiksiz girin.");
      return;
    }

    // Validation
    if (!formData.university) {
      setError("Lütfen üniversitenizi seçin.");
      return;
    }
    if (!nutritionUniversities.includes(formData.university)) {
      setError("Lütfen listeden geçerli bir üniversite seçin.");
      return;
    }
    if (!formData.graduationDate) {
      setError("Lütfen mezuniyet tarihinizi seçin.");
      return;
    }
    const selectedDate = new Date(formData.graduationDate);
    if (selectedDate > new Date()) {
      setError("Mezuniyet tarihi gelecekte olamaz.");
      return;
    }
    if (selectedDate.getFullYear() < 1950) {
      setError("Lütfen geçerli bir mezuniyet tarihi seçin.");
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
    if (!diplomaFile) {
      setError("Lütfen diplomanızı yükleyin.");
      return;
    }

    setLoading(true);

    const payload: RegistrationData = {
      email: formData.email,
      password: formData.password,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      phone: formData.phone,
      university: formData.university,
      graduationYear: new Date(formData.graduationDate).getFullYear().toString(),
      experienceYears: formData.experienceYears,
      specialization: formData.specialization,
      bio: formData.bio,
      diplomaFile: diplomaFile
    };

    const result = await registerDietitian(payload);

    if (result.success && result.status === 'complete') {
      setIsSuccess(true);
    } else if (result.status === 'email_confirmation_required') {
      setInfoMessage(result.error || 'Hesabınızı etkinleştirmek için e-posta adresinizi doğrulayın.');
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

  // Success Screen
  if (isSuccess) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f3faf7] px-4 py-8">
        <div className="w-full max-w-lg rounded-[2rem] border border-slate-100 bg-white p-8 text-center shadow-[0_24px_70px_rgba(15,23,42,0.1)] sm:p-12">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="h-10 w-10" aria-hidden="true" />
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-[#10233f]">Başvuru Alındı!</h2>
          <p className="mt-4 text-base leading-7 text-slate-500">
            Kaydınız başarı ile oluşturulmuştur. <br />
            Onay sürecinden sonra e-posta ile iletişime geçilecektir.
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
            <p className="mt-5 max-w-sm text-base leading-7 text-slate-500">DietBridge'e katılarak danışan yönetimini tek yerden kolaylaştırın.</p>
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
              <h2 className="mt-3 text-3xl font-semibold tracking-tight text-[#10233f]">Diyetisyen Kaydı</h2>
              <p className="mt-1 max-w-xl text-sm leading-6 text-slate-500">DietBridge'e katılarak danışan yönetimini tek yerden kolaylaştırın.</p>
            </div>

            {error && (
              <div id="register-error" role="alert" className="mt-5 flex items-start gap-3 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-600">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
            )}

            {infoMessage && (
              <div id="register-info" role="status" className="mt-3 flex items-start gap-3 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-700">
                <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <span>{infoMessage}</span>
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
                  <div className="space-y-1">
                    <label htmlFor="register-phone" className="text-xs font-semibold text-[#10233f]">Telefon</label>
                    <div className="relative">
                      <Phone className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      <input id="register-phone" type="tel" name="phone" required value={formData.phone} onChange={handleChange} placeholder="5XX XXX XX XX" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
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
                      <input id="register-password" type="password" name="password" required value={formData.password} onChange={handleChange} placeholder="En az 8 karakter" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="register-password-confirm" className="text-xs font-semibold text-[#10233f]">Şifre Tekrar</label>
                    <div className="relative">
                      <Lock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      <input id="register-password-confirm" type="password" name="passwordConfirm" required value={formData.passwordConfirm} onChange={handleChange} placeholder="Şifrenizi tekrar girin" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                    </div>
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200/80 bg-slate-50/40 p-4" aria-labelledby="professional-info-heading">
                <div className="flex items-center gap-3 border-b border-slate-200/80 pb-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <Briefcase className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 id="professional-info-heading" className="text-base font-semibold text-[#10233f]">Mesleki Bilgiler</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Mesleki deneyiminiz ve uzmanlık alanınız.</p>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="register-university" className="text-xs font-semibold text-[#10233f]">Üniversite</label>
                    <div className="relative" ref={universityRef}>
                      <BookOpen className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      <input
                        id="register-university"
                        type="text"
                        name="university"
                        required
                        value={formData.university}
                        onChange={(e) => {
                          handleChange(e);
                          setShowUniversityDropdown(true);
                        }}
                        onFocus={() => setShowUniversityDropdown(true)}
                        autoComplete="off"
                        placeholder="Üniversite adı yazın veya seçin"
                        aria-expanded={showUniversityDropdown}
                        aria-controls="university-options"
                        aria-describedby={error ? 'register-error' : undefined}
                        className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
                      />
                      {showUniversityDropdown && (
                        <div id="university-options" role="listbox" className="absolute z-20 mt-2 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white py-1 shadow-xl">
                          {filteredUniversities.length > 0 ? filteredUniversities.map(uni => (
                            <button
                              type="button"
                              role="option"
                              aria-selected={formData.university === uni}
                              key={uni}
                              onClick={() => {
                                setFormData(prev => ({ ...prev, university: uni }));
                                setShowUniversityDropdown(false);
                              }}
                              className="block w-full border-b border-slate-100 px-4 py-3 text-left text-sm text-slate-700 transition last:border-0 hover:bg-emerald-50 focus:bg-emerald-50 focus:outline-none"
                            >
                              {uni}
                            </button>
                          )) : (
                            <div className="px-4 py-3 text-center text-sm text-slate-500">Eşleşen üniversite bulunamadı.</div>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="register-graduation-date" className="text-xs font-semibold text-[#10233f]">Mezuniyet Tarihi</label>
                    <input id="register-graduation-date" type="date" name="graduationDate" required value={formData.graduationDate} onChange={handleChange} max={new Date().toISOString().split('T')[0]} min="1950-01-01" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor="register-experience" className="text-xs font-semibold text-[#10233f]">Deneyim (Yıl)</label>
                    <input id="register-experience" type="number" name="experienceYears" required value={formData.experienceYears} onChange={handleChange} placeholder="Örn. 3" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="register-specialization" className="text-xs font-semibold text-[#10233f]">Uzmanlık Alanı</label>
                    <div className="relative">
                      <Award className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                      <input id="register-specialization" type="text" name="specialization" required value={formData.specialization} onChange={handleChange} placeholder="Örn: Sporcu Beslenmesi, Obezite, Diyabet" aria-describedby={error ? 'register-error' : undefined} className="min-h-11 w-full rounded-xl border border-slate-200 bg-white pl-11 pr-4 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                    </div>
                  </div>
                  <div className="space-y-1 md:col-span-2">
                    <label htmlFor="register-bio" className="text-xs font-semibold text-[#10233f]">Hakkında (Biyografi)</label>
                    <textarea id="register-bio" rows={4} name="bio" required value={formData.bio} onChange={handleChange} placeholder="Kendinizden ve yaklaşımınızdan kısaca bahsedin..." aria-describedby={error ? 'register-error' : undefined} className="h-[112px] w-full resize-none rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800 outline-none transition placeholder:text-slate-400 focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10" />
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200/80 bg-slate-50/40 p-4" aria-labelledby="document-heading">
                <div className="flex items-center gap-3 border-b border-slate-200/80 pb-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <FileText className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div>
                    <h3 id="document-heading" className="text-base font-semibold text-[#10233f]">Belge Doğrulama</h3>
                    <p className="mt-0.5 text-xs text-slate-500">Diyetisyenlik belgenizi güvenle paylaşın.</p>
                  </div>
                </div>
                <label htmlFor="diploma-upload" className={`mt-3 flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed p-3 transition ${error?.includes('Dosya') ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-white hover:border-emerald-300 hover:bg-emerald-50/30'}`}>
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl ${error?.includes('Dosya') ? 'bg-red-100 text-red-500' : 'bg-emerald-50 text-emerald-600'}`}>
                    <Upload className="h-5 w-5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-[#10233f]">Diploma Belgesi</span>
                    <span className="mt-1 block text-xs leading-5 text-slate-500">PDF formatında yükleyin · Maks. 5 MB</span>
                    {diplomaFile ? (
                      <span className="mt-2 block truncate text-xs font-semibold text-emerald-600">Seçilen dosya: {diplomaFile.name}</span>
                    ) : (
                      <span className="mt-3 inline-flex rounded-lg bg-emerald-500 px-3 py-2 text-xs font-semibold text-white shadow-sm">Dosya seç</span>
                    )}
                  </span>
                  <FileText className="hidden h-5 w-5 shrink-0 text-slate-300 sm:block" aria-hidden="true" />
                  <input id="diploma-upload" type="file" accept="application/pdf" onChange={handleFileChange} className="sr-only" />
                </label>
              </section>

              <div className="flex items-start gap-3 rounded-2xl border border-emerald-100 bg-emerald-50/70 p-3">
                <input type="checkbox" id="confirm-license" checked={formData.isConfirmed} onChange={handleCheckboxChange} className="mt-1 h-4 w-4 rounded border-slate-300 text-primary focus:ring-2 focus:ring-emerald-500/30" />
                <label htmlFor="confirm-license" className="text-sm leading-6 text-slate-600">
                  Lisanslı bir diyetisyen olduğumu, verdiğim bilgilerin doğruluğunu ve <a href="https://dietbridge.com.tr/kullanim-kosullari" target="_blank" rel="noopener noreferrer" className="font-semibold text-emerald-700 hover:underline">Kullanım Koşulları</a>'nı kabul ediyorum.
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
                    Kaydı Tamamla <ArrowRight className="h-5 w-5" aria-hidden="true" />
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
