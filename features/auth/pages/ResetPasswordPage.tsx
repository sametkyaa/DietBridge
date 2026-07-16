import React, { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../../../lib/supabaseClient';
import { APP_LOGO } from '../../../shared/constants';
import { Lock, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isValidSession, setIsValidSession] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    // 1. Check URL parameters for errors (Supabase recovery errors often come in hash or search)
    const hashStr = window.location.hash;
    const searchStr = window.location.search;
    
    // Convert hash to URLSearchParams
    const hashParams = new URLSearchParams(hashStr.replace('#', '?'));
    const searchParams = new URLSearchParams(searchStr);
    
    const errorCode = hashParams.get('error_code') || searchParams.get('error_code') || hashParams.get('error') || searchParams.get('error');
    const errorDesc = hashParams.get('error_description') || searchParams.get('error_description');

    if (errorCode === 'otp_expired') {
      setError('Şifre sıfırlama bağlantısının süresi dolmuş veya bağlantı daha önce kullanılmış. Lütfen tekrar şifre sıfırlama maili isteyin.');
      setIsValidSession(false);
      return;
    } else if (errorCode) {
      setError(errorDesc || 'Şifre sıfırlama bağlantısı geçersiz veya hatalı.');
      setIsValidSession(false);
      return;
    }

    // A normal authenticated session is not sufficient for password recovery.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (!active) return;
      if (event === 'PASSWORD_RECOVERY') {
        setIsValidSession(true);
        setError(null);
      } else if (event === 'SIGNED_OUT') {
        setIsValidSession(false);
      }
    });

    void supabase.auth.getSession().catch((sessionError: unknown) => {
      console.error('Password recovery session check failed:', sessionError);
    });

    // Fallback: If after 2 seconds we still don't have a valid session and no error, mark as invalid
    const timeout = setTimeout(() => {
      setIsValidSession(current => {
        if (active && current === null && !errorCode) {
          setError('Geçerli bir şifre sıfırlama oturumu bulunamadı. Lütfen tekrar şifre sıfırlama bağlantısı isteyin.');
          return false;
        }
        return current;
      });
    }, 2000);

    return () => {
      active = false;
      subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword.length < 6) {
      setError('Şifre en az 6 karakter olmalıdır.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setError('Şifreler eşleşmiyor. Lütfen kontrol edin.');
      return;
    }

    setLoading(true);
    setError(null);
    setSuccess(false);

    try {
      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      });

      if (updateError) {
        setError('Şifre güncellenirken bir hata oluştu. Lütfen tekrar deneyin.');
        return;
      }

      setSuccess(true);
      const { error: signOutError } = await supabase.auth.signOut();
      if (signOutError) console.error('Password recovery sign-out failed:', signOutError);

      setTimeout(() => {
        navigate('/login');
      }, 3000);
    } catch (updateException) {
      console.error('Password update failed:', updateException);
      setError('Şifre güncellenirken bir hata oluştu. Lütfen tekrar deneyin.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md p-8 md:p-12 border border-slate-100">
        
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
            <img src={APP_LOGO} alt="DietBridge" className="h-12 w-12 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">Yeni Şifre Belirle</h1>
          <p className="text-slate-500 mt-2 text-center text-sm">
            DietBridge hesabınız için yeni bir şifre oluşturun.
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-6 text-sm flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex flex-col gap-2">
              <span>{error}</span>
              {(error.includes('süresi dolmuş') || error.includes('Geçerli bir şifre sıfırlama oturumu bulunamadı')) && (
                 <Link to="/forgot-password" className="font-bold underline hover:text-red-700 inline-block mt-1">
                   Tekrar Şifre Sıfırlama İsteği Gönder
                 </Link>
              )}
            </div>
          </div>
        )}

        {success ? (
          <div className="bg-emerald-50 border border-emerald-100 text-emerald-700 p-6 rounded-xl text-center space-y-4">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" />
            <p className="font-medium text-sm leading-relaxed">
              Şifreniz başarıyla güncellendi. Giriş sayfasına yönlendiriliyorsunuz...
            </p>
          </div>
        ) : (
          isValidSession === true && (
            <form onSubmit={handleUpdatePassword} className="space-y-5">
              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700 ml-1">Yeni Şifre</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                  <input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-800 font-medium"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-bold text-slate-700 ml-1">Yeni Şifre (Tekrar)</label>
                <div className="relative">
                  <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    minLength={6}
                    className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-800 font-medium"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading || !newPassword || !confirmPassword}
                className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-4 rounded-xl shadow-lg shadow-primary/30 transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed mt-4"
              >
                {loading ? (
                  <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <>
                    Şifreyi Güncelle <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>
            </form>
          )
        )}
        
        {isValidSession === null && !error && !success && (
          <div className="text-center py-6 text-slate-500">
             <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-3" />
             <p className="text-sm">Oturum kontrol ediliyor...</p>
          </div>
        )}

      </div>
    </div>
  );
};

export default ResetPasswordPage;
