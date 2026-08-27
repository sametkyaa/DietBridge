
import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { APP_LOGO } from '../../../shared/constants';
import { ArrowRight, Mail, Lock, AlertCircle } from 'lucide-react';
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
    <div className="min-h-screen bg-gradient-to-br from-emerald-50 to-teal-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-3xl shadow-xl w-full max-w-md p-8 md:p-12 border border-slate-100">
        
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-emerald-100 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
            <img src={APP_LOGO} alt="DietBridge" className="h-12 w-12 object-contain" />
          </div>
          <h1 className="text-2xl font-bold text-slate-800">DietBridge'e Giriş Yap</h1>
          <p className="text-slate-500 mt-2 text-center text-sm">
            Danışanlarınızı yönetmek için hesabınıza erişin.
          </p>
        </div>

        {displayError && (
          <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-3 rounded-xl mb-6 text-sm flex items-start gap-2">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <span>{displayError}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-5">
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

          <div className="space-y-1.5">
            <label className="text-sm font-bold text-slate-700 ml-1">Şifre</label>
            <div className="relative">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-12 pr-4 py-3.5 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all text-slate-800 font-medium"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || isResolvingAccess}
            className="w-full bg-primary hover:bg-primary-dark text-white font-bold py-4 rounded-xl shadow-lg shadow-primary/30 transition-all flex items-center justify-center gap-2 active:scale-[0.98] disabled:opacity-70 disabled:cursor-not-allowed mt-4"
          >
            {loading || isResolvingAccess ? (
              <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <>
                Giriş Yap <ArrowRight className="w-5 h-5" />
              </>
            )}
          </button>

          <div className="text-center mt-4">
            <Link to="/forgot-password" className="text-sm text-primary font-bold hover:underline transition-colors">
              Şifremi unuttum
            </Link>
          </div>
        </form>

        <div className="mt-8 text-center">
          <p className="text-slate-500 text-sm">
            Hesabınız yok mu?{' '}
            <Link to="/register" className="text-primary font-bold hover:underline">Kayıt Ol</Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
