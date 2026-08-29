import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertCircle, CheckCircle2, FileText, Info, Upload } from 'lucide-react';
import { APP_LOGO } from '../../../shared/constants';
import { nutritionUniversities } from '../../../shared/constants/nutritionUniversities';
import { useAuth } from '../context/AuthContext';
import {
  completeDietitianRegistration,
  DietitianCompletionData,
  DietitianOnboardingState,
  getCurrentDietitianOnboarding,
  validateDiplomaFile,
} from '../../dietitians/services/dietitianService';
import {
  getCanonicalDiplomaPath,
  getRegistrationCompleteness,
  isCanonicalDiplomaPath,
} from '../utils/registrationCompleteness';

interface CompletionFormData {
  phone: string;
  university: string;
  graduationDate: string;
  experienceYears: string;
  specialization: string;
  bio: string;
}

const MIN_GRADUATION_YEAR = 1950;

interface GraduationDateParts {
  year: number;
  month: number;
  day: number;
}

const getTodayDateInputValue = (): string => {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${today.getFullYear()}-${month}-${day}`;
};

const isLeapYear = (year: number): boolean => year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);

const getDaysInMonth = (year: number, month: number): number => {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

const parseGraduationDate = (value: string): GraduationDateParts | null => {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > getDaysInMonth(year, month)) return null;
  return { year, month, day };
};

const getGraduationYearFromDate = (value: string): number | null => parseGraduationDate(value)?.year ?? null;

const getRouteMessage = (state: unknown): string | null => {
  if (!state || typeof state !== 'object') return null;
  const message = (state as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : null;
};

const toFormData = (state: DietitianOnboardingState): CompletionFormData => {
  return {
    phone: state.phone,
    university: state.university,
    graduationDate: '',
    experienceYears: state.experienceYears === null ? '' : String(state.experienceYears),
    specialization: state.specialization,
    bio: state.bio,
  };
};

const CompleteRegistrationPage = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { accessState, refreshAccess } = useAuth();
  const [onboarding, setOnboarding] = useState<DietitianOnboardingState | null>(null);
  const [formData, setFormData] = useState<CompletionFormData | null>(null);
  const [diplomaFile, setDiplomaFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(getRouteMessage(location.state));

  useEffect(() => {
    if (accessState.status === 'allowed') {
      navigate('/', { replace: true });
    }
  }, [accessState.status, navigate]);

  useEffect(() => {
    let cancelled = false;
    const loadOnboarding = async () => {
      const result = await getCurrentDietitianOnboarding();
      if (cancelled) return;
      if (!result.success || !result.data) {
        setError(result.error || 'Profil kurulumu yüklenemedi.');
      } else {
        setOnboarding(result.data);
        setFormData(toFormData(result.data));
      }
      setLoading(false);
    };
    void loadOnboarding();
    return () => {
      cancelled = true;
    };
  }, []);

  const hasExistingDiploma = Boolean(
    onboarding && isCanonicalDiplomaPath(onboarding.diplomaUrl, onboarding.userId),
  );

  const handleChange = (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = event.target;
    setFormData(previous => previous ? { ...previous, [name]: value } : previous);
    setError(null);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setError(null);
    const file = event.target.files?.[0] || null;
    if (!file) {
      setDiplomaFile(null);
      return;
    }
    const validation = validateDiplomaFile(file);
    if (validation.status === 'invalid') {
      setError(validation.userMessage);
      event.target.value = '';
      setDiplomaFile(null);
      return;
    }
    setDiplomaFile(file);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!onboarding || !formData) return;
    setError(null);
    setInfoMessage(null);

    const normalizedFormData: CompletionFormData = {
      ...formData,
      phone: formData.phone.trim(),
      university: formData.university.trim(),
      graduationDate: formData.graduationDate.trim(),
      experienceYears: formData.experienceYears.trim(),
      specialization: formData.specialization.trim(),
      bio: formData.bio.trim(),
    };
    setFormData(normalizedFormData);

    const todayDate = getTodayDateInputValue();
    const parsedGraduationDate = normalizedFormData.graduationDate
      ? parseGraduationDate(normalizedFormData.graduationDate)
      : null;
    if (normalizedFormData.graduationDate && !parsedGraduationDate) {
      setError('Lütfen geçerli bir mezuniyet tarihi seçin.');
      return;
    }
    if (normalizedFormData.graduationDate && normalizedFormData.graduationDate > todayDate) {
      setError('Gelecekte bir mezuniyet tarihi seçilemez.');
      return;
    }

    const graduationYear = getGraduationYearFromDate(normalizedFormData.graduationDate)
      ?? onboarding.graduationYear;
    const currentYear = Number(todayDate.slice(0, 4));
    if (
      graduationYear === null
      || !Number.isInteger(graduationYear)
      || graduationYear < MIN_GRADUATION_YEAR
      || graduationYear > currentYear
    ) {
      setError('Lütfen geçerli bir mezuniyet tarihi seçin.');
      return;
    }

    if (!nutritionUniversities.includes(normalizedFormData.university)) {
      setError('Lütfen listeden geçerli bir üniversite seçin.');
      return;
    }

    const prospectiveDiplomaPath = diplomaFile
      ? getCanonicalDiplomaPath(onboarding.userId)
      : onboarding.diplomaUrl || '';
    const completeness = getRegistrationCompleteness({
      userId: onboarding.userId,
      fullName: onboarding.fullName,
      email: onboarding.email,
      phone: normalizedFormData.phone,
      university: normalizedFormData.university,
      graduationYear: String(graduationYear),
      experienceYears: normalizedFormData.experienceYears,
      specialization: normalizedFormData.specialization,
      bio: normalizedFormData.bio,
      diplomaUrl: prospectiveDiplomaPath,
    });
    if (!completeness.isComplete) {
      setError('Lütfen eksik başvuru bilgilerini ve diploma belgesini tamamlayın.');
      return;
    }

    setSaving(true);
    const payload: DietitianCompletionData = {
      phone: normalizedFormData.phone,
      university: normalizedFormData.university,
      graduationYear: String(graduationYear),
      experienceYears: normalizedFormData.experienceYears,
      specialization: normalizedFormData.specialization,
      bio: normalizedFormData.bio,
      diplomaFile,
    };
    const result = await completeDietitianRegistration(payload);
    if (!result.success) {
      setError(result.error || 'Profil kurulumu tamamlanamadı.');
      setSaving(false);
      return;
    }

    await refreshAccess();
    navigate('/', { replace: true });
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center bg-background-light text-slate-500">Profil kurulumu yükleniyor...</div>;
  }

  if (!formData || !onboarding) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background-light p-4">
        <div className="bg-white rounded-3xl shadow-xl max-w-lg w-full p-8 text-center">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-4" />
          <p className="text-slate-700">{error || 'Profil kurulumu yüklenemedi.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 py-10 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-3xl shadow-xl border border-slate-100 overflow-hidden">
        <div className="p-8 md:p-12">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4">
              <img src={APP_LOGO} alt="DietBridge" className="h-12 w-12 object-contain" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800 text-center">Başvuruyu Tamamla</h1>
            <p className="text-slate-500 mt-2 text-center text-sm">
              Başvurunuz henüz tamamlanmamış. Eksik bilgileri tamamlayıp başvurunuzu incelemeye gönderin.
            </p>
          </div>

          {infoMessage && (
            <div className="bg-blue-50 border border-blue-100 text-blue-700 px-4 py-3 rounded-xl mb-6 text-sm flex items-start gap-2">
              <Info className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{infoMessage}</span>
            </div>
          )}
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-6 text-sm flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-5 py-4">
              <p className="text-sm font-bold text-[#10233f]">{onboarding.fullName}</p>
              <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-700">
                {onboarding.email}
                <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                <span className="sr-only">E-posta doğrulandı</span>
              </p>
            </div>

            <div className="grid grid-cols-1 gap-5">
              <div className="space-y-1.5">
                <label htmlFor="completion-phone" className="text-sm font-bold text-slate-700">Telefon</label>
                <input id="completion-phone" name="phone" type="tel" required value={formData.phone} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm" />
              </div>
            </div>

            <div className="pt-5 border-t border-slate-100 space-y-5">
              <h2 className="text-lg font-bold text-slate-800">Mesleki Bilgiler</h2>
              <div className="space-y-1.5">
                <label htmlFor="completion-university" className="text-sm font-bold text-slate-700">Üniversite</label>
                <input id="completion-university" name="university" list="dietitian-universities" required value={formData.university} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm" />
                <datalist id="dietitian-universities">
                  {nutritionUniversities.map(university => <option key={university} value={university} />)}
                </datalist>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div className="space-y-1.5">
                  <label htmlFor="completion-graduation-date" className="text-sm font-bold text-slate-700">Mezuniyet Tarihi</label>
                  <input id="completion-graduation-date" name="graduationDate" type="date" min={`${MIN_GRADUATION_YEAR}-01-01`} max={getTodayDateInputValue()} required={onboarding.graduationYear === null} value={formData.graduationDate} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm" aria-describedby={onboarding.graduationYear === null ? undefined : 'completion-graduation-date-help'} />
                  {onboarding.graduationYear !== null && (
                    <p id="completion-graduation-date-help" className="text-xs text-slate-500">Mevcut mezuniyet yılı ({onboarding.graduationYear}) korunur. Yeni bir tarih seçerseniz yıl güncellenir.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <label htmlFor="completion-experience-years" className="text-sm font-bold text-slate-700">Deneyim (Yıl)</label>
                  <input id="completion-experience-years" name="experienceYears" type="number" min="0" step="any" required value={formData.experienceYears} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm" />
                </div>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="completion-specialization" className="text-sm font-bold text-slate-700">Uzmanlık Alanı</label>
                <input id="completion-specialization" name="specialization" required value={formData.specialization} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm" />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="completion-bio" className="text-sm font-bold text-slate-700">Biyografi</label>
                <textarea id="completion-bio" name="bio" rows={5} required value={formData.bio} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary text-sm resize-none" />
              </div>
            </div>

            <div className="pt-5 border-t border-slate-100">
              <div className="border-2 border-dashed border-slate-200 bg-slate-50 rounded-2xl p-6 text-center">
                <Upload className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                <p className="text-sm font-bold text-slate-700">Diploma Belgesi</p>
                <p className="text-xs text-slate-500 mb-4">{hasExistingDiploma ? 'Kayıtlı belge mevcut. Gerekirse yeni bir PDF ile değiştirebilirsiniz.' : 'PDF formatında yükleyin (Maks. 5MB).'}</p>
                <input type="file" accept="application/pdf" required={!hasExistingDiploma} onChange={handleFileChange} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-white hover:file:bg-primary-dark cursor-pointer" />
                {hasExistingDiploma && !diplomaFile && (
                  <p className="mt-3 text-xs text-emerald-700 flex items-center justify-center gap-1"><CheckCircle2 className="w-4 h-4" /> Diploma yolu kayıtlı</p>
                )}
                {diplomaFile && (
                  <p className="mt-3 text-xs text-emerald-700 flex items-center justify-center gap-1"><FileText className="w-4 h-4" /> Yeni PDF seçildi</p>
                )}
              </div>
            </div>

            <button type="submit" disabled={saving} className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-4 rounded-xl shadow-lg shadow-primary/30 transition-all disabled:opacity-70 disabled:cursor-not-allowed">
              {saving ? 'Başvuru gönderiliyor...' : 'Başvuruyu Tamamla'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
};

export default CompleteRegistrationPage;
