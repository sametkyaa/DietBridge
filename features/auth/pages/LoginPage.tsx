import React, { useState, useEffect } from 'react';
import { EyeOff, Eye } from 'lucide-react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { AuthLayout } from '../components/AuthLayout';
import { Button, Callout, Input } from '../../../shared/ui';

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
  const [showPassword, setShowPassword] = useState(false);
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
    <AuthLayout>
      <h1 className="m-0 text-28 font-bold tracking-[-0.4px]">DietBridge'e Giriş Yap</h1>
      <p className="m-0 mt-2 text-14 text-ink-2">Danışanlarınızı yönetmek için hesabınıza giriş yapın.</p>

      {displayError && (
        <Callout tone="bad" role="alert" className="mt-6">
          <span id="login-error">{displayError}</span>
        </Callout>
      )}

      <form onSubmit={handleLogin} className="mt-7 flex flex-col gap-4">
        <Input
          id="login-email"
          type="email"
          label="E-posta"
          leadingIcon="envelope"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ornek@email.com"
          aria-describedby={displayError ? 'login-error' : undefined}
          required
        />
        <div className="flex flex-col gap-1.5">
          <Input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            label="Şifre"
            leadingIcon="lock"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Şifrenizi girin"
            aria-describedby={displayError ? 'login-error' : undefined}
            required
            trailing={(
              <button
                type="button"
                aria-label={showPassword ? 'Şifreyi gizle' : 'Şifreyi göster'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((value) => !value)}
                className="grid h-7 w-7 place-items-center rounded-tag text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
              >
                {showPassword ? <EyeOff className="h-[17px] w-[17px]" aria-hidden="true" /> : <Eye className="h-[17px] w-[17px]" aria-hidden="true" />}
              </button>
            )}
          />
          <Link to="/forgot-password" className="self-end text-13 font-semibold text-brand hover:text-brand-hi">
            Şifremi unuttum
          </Link>
        </div>

        <Button type="submit" variant="primary" size="lg" fullWidth rightIcon="arrow-right" loading={loading || isResolvingAccess} disabled={loading || isResolvingAccess}>
          Giriş Yap
        </Button>
      </form>

      <p className="m-0 mt-8 text-center text-14 text-ink-2">
        Hesabınız yok mu?{' '}
        <Link to="/register" className="font-semibold text-brand hover:text-brand-hi">Diyetisyen başvurusu oluştur</Link>
      </p>
    </AuthLayout>
  );
};

export default LoginPage;
