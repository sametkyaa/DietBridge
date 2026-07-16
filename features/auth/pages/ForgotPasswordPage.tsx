import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient';
import { APP_LOGO } from '../../../shared/constants';
import { ArrowLeft, Mail, AlertCircle, CheckCircle2 } from 'lucide-react';

const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!email.trim() || !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError('Lütfen geçerli bir e-posta adresi girin.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: `${window.location.origin}/reset-password`,
      });

      if (resetError) {
        setError('Şifre sıfırlama işlemi sırasında bir hata oluştu. Lütfen tekrar deneyin.');
      } else {
        setSuccess(true);
      }
    } catch (resetException) {
      console.error('Password reset request failed:', resetException);
      setError('Şifre sıfırlama işlemi sırasında bir hata oluştu. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md p-8 md:p-12 border border-slate-100">
        
        <button 
          onClick={() => navigate('/login')}
          className="flex items-center gap-2 text-slate-400 hover:text-slate-600 font-medium mb-6 transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Giriş sayfasına dön
        </button>

        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
            <img src={APP_LOGO} alt="DietBridge" className="h-12 w-12 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Şifremi Unuttum</h1>
          <p className="text-slate-500 mt-2 text-center text-sm">
            Şifrenizi sıfırlamak için hesabınıza kayıtlı e-posta adresini girin.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-6 text-sm flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {success ? (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 p-6 rounded-xl text-center space-y-4">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
            <p className="font-medium text-sm leading-relaxed">
              Şifre sıfırlama isteğiniz alındı. Hesabınız varsa e-posta kutunuza bir bağlantı gönderilecektir.
              Lütfen e-posta kutunuzu (ve spam klasörünü) kontrol edin.
            </p>
          </div>
        ) : (
          <form onSubmit={handleResetPassword} className="space-y-5">
            <div className="space-y-1.5">
              <label className="text-sm font-bold text-slate-700 ml-1">E-posta</label>
              <div className="relative">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="ornek@dietbridge.com"
                  className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-800 font-medium"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-4 rounded-xl shadow-lg shadow-primary/30 transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed mt-4"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Sıfırlama Bağlantısı Gönder'
              )}
            </button>
          </form>
        )}
      </div>
    </div>
  );
};

export default ForgotPasswordPage;
