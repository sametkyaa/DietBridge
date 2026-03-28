
import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { APP_LOGO } from '../../../shared/constants';
import { User, Mail, Phone, Lock, BookOpen, Briefcase, Award, FileText, Upload, CheckCircle2, AlertCircle, ArrowRight } from 'lucide-react';
import { registerDietitian, RegistrationData } from '../../dietitians/services/dietitianService';

const RegisterPage = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);

  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    password: '',
    passwordConfirm: '',
    university: '',
    graduationYear: '',
    experienceYears: '',
    specialization: '',
    bio: '',
    isConfirmed: false
  });

  const [diplomaFile, setDiplomaFile] = useState<File | null>(null);

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

    // Validation
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
      firstName: formData.firstName,
      lastName: formData.lastName,
      phone: formData.phone,
      university: formData.university,
      graduationYear: formData.graduationYear,
      experienceYears: formData.experienceYears,
      specialization: formData.specialization,
      bio: formData.bio,
      diplomaFile: diplomaFile
    };

    const result = await registerDietitian(payload);

    if (result.success) {
      setIsSuccess(true);
    } else {
      setError(result.error || "Kayıt sırasında bir hata oluştu.");
    }
    setLoading(false);
  };

  // Success Screen
  if (isSuccess) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center p-4">
        <div className="bg-white p-8 md:p-12 rounded-3xl shadow-xl max-w-lg w-full text-center border border-slate-100 animate-in fade-in zoom-in duration-300">
          <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6 shadow-sm">
            <CheckCircle2 className="w-10 h-10 text-emerald-600" />
          </div>
          <h2 className="text-2xl font-bold text-slate-800 mb-4">Başvuru Alındı!</h2>
          <p className="text-slate-600 mb-8 leading-relaxed text-lg">
            Kaydınız başarı ile oluşturulmuştur. <br />
            Onay sürecinden sonra e-posta ile iletişime geçilecektir.
          </p>
          <Link 
            to="/login" 
            className="block w-full bg-primary hover:bg-primary-dark text-white font-bold py-3.5 rounded-xl transition-all shadow-lg shadow-primary/30"
          >
            Giriş Sayfasına Dön
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto bg-white rounded-3xl shadow-xl overflow-hidden border border-slate-100">
        
        <div className="bg-white p-8 md:p-12">
          <div className="flex flex-col items-center mb-10">
            <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
              <img src={APP_LOGO} alt="Logo" className="w-10 h-10 object-contain" />
            </div>
            <h1 className="text-3xl font-bold text-slate-800 text-center">Diyetisyen Kaydı</h1>
            <p className="text-slate-500 mt-2 text-center text-sm">
              DietBridge ailesine katılmak için bilgilerinizi eksiksiz doldurun.
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-8 text-sm flex items-start gap-2">
              <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-8">
            
            {/* Personal Info Section */}
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <User className="w-5 h-5 text-emerald-600" /> Kişisel Bilgiler
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Ad</label>
                  <input type="text" name="firstName" required value={formData.firstName} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Soyad</label>
                  <input type="text" name="lastName" required value={formData.lastName} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">E-posta</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="email" name="email" required value={formData.email} onChange={handleChange} className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Telefon</label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="tel" name="phone" required value={formData.phone} onChange={handleChange} className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                  </div>
                </div>
              </div>
            </div>

            {/* Security Section */}
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Lock className="w-5 h-5 text-emerald-600" /> Güvenlik
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Şifre</label>
                  <input type="password" name="password" required value={formData.password} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Şifre Tekrar</label>
                  <input type="password" name="passwordConfirm" required value={formData.passwordConfirm} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
              </div>
            </div>

            {/* Professional Info Section */}
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <Briefcase className="w-5 h-5 text-emerald-600" /> Mesleki Bilgiler
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="col-span-1 md:col-span-2 space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Üniversite / Bölüm</label>
                  <div className="relative">
                    <BookOpen className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="text" name="university" required value={formData.university} onChange={handleChange} placeholder="Örn: Hacettepe Üniversitesi - Beslenme ve Diyetetik" className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Mezuniyet Yılı</label>
                  <input type="number" name="graduationYear" required value={formData.graduationYear} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Deneyim (Yıl)</label>
                  <input type="number" name="experienceYears" required value={formData.experienceYears} onChange={handleChange} className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                </div>
                <div className="col-span-1 md:col-span-2 space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Uzmanlık Alanı</label>
                  <div className="relative">
                    <Award className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input type="text" name="specialization" required value={formData.specialization} onChange={handleChange} placeholder="Örn: Sporcu Beslenmesi, Obezite, Diyabet" className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm" />
                  </div>
                </div>
                <div className="col-span-1 md:col-span-2 space-y-1.5">
                  <label className="text-sm font-bold text-slate-700">Hakkında (Biyografi)</label>
                  <textarea rows={4} name="bio" required value={formData.bio} onChange={handleChange} placeholder="Kendinizden ve yaklaşımınızdan kısaca bahsedin..." className="w-full px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-sm resize-none" />
                </div>
              </div>
            </div>

            {/* Document Upload */}
            <div>
              <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                <FileText className="w-5 h-5 text-emerald-600" /> Belge Doğrulama
              </h3>
              <div className={`border-2 border-dashed rounded-2xl p-6 transition-colors ${error?.includes('Dosya') ? 'border-red-300 bg-red-50' : 'border-slate-200 bg-slate-50 hover:bg-slate-100'}`}>
                <div className="flex flex-col items-center justify-center text-center">
                  <Upload className={`w-8 h-8 mb-2 ${error?.includes('Dosya') ? 'text-red-400' : 'text-slate-400'}`} />
                  <p className="text-sm font-bold text-slate-700">Diploma Belgesi</p>
                  <p className="text-xs text-slate-500 mb-4">PDF formatında yükleyin (Maks. 5MB).</p>
                  <input 
                    type="file" 
                    accept="application/pdf"
                    onChange={handleFileChange}
                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-white hover:file:bg-primary-dark cursor-pointer" 
                  />
                  {diplomaFile && <p className="text-xs text-emerald-600 font-bold mt-2">Seçilen dosya: {diplomaFile.name}</p>}
                </div>
              </div>
            </div>

            {/* Terms */}
            <div className="flex items-start gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
               <div className="relative flex items-center mt-1">
                 <input 
                    type="checkbox" 
                    id="confirm-license"
                    checked={formData.isConfirmed}
                    onChange={handleCheckboxChange}
                    className="h-4 w-4 rounded border-slate-300 text-primary focus:ring-primary"
                 />
               </div>
               <label htmlFor="confirm-license" className="text-sm text-slate-600">
                 Lisanslı bir diyetisyen olduğumu, verdiğim bilgilerin doğruluğunu ve <a href="#" className="text-emerald-700 font-bold hover:underline">Kullanım Koşulları</a>'nı kabul ediyorum.
               </label>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-4 rounded-xl shadow-lg shadow-primary/30 transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  Kaydı Tamamla <CheckCircle2 className="w-5 h-5" />
                </>
              )}
            </button>

            <div className="text-center mt-4">
              <p className="text-slate-500 text-sm">
                Zaten hesabınız var mı? <Link to="/login" className="text-primary font-bold hover:underline">Giriş Yap</Link>
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RegisterPage;
