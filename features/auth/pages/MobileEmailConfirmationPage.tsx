import { useEffect, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, LoaderCircle, Smartphone } from 'lucide-react';
import { AuthLayout } from '../components/AuthLayout';
import { confirmMobileEmail, type MobileEmailConfirmationResult } from '../services/mobileEmailConfirmationService';
import { MOBILE_EMAIL_CONFIRMATION_PATH, parseMobileEmailCallback } from '../utils/mobileEmailConfirmation';

const messages = {
  success: { title: 'E-posta adresin doğrulandı', description: 'Hesabın için e-posta doğrulaması tamamlandı. DietBridge mobil uygulamasını açıp e-posta adresin ve şifrenle giriş yapabilirsin.' },
  expired: { title: 'Doğrulama bağlantısının süresi dolmuş', description: 'Bu bağlantının süresi dolmuş veya bağlantı daha önce kullanılmış. Daha önce doğruladıysan mobil uygulamadan giriş yapmayı dene. Doğrulamadıysan güncel doğrulama e-postasındaki bağlantıyı kullan.' },
  invalid: { title: 'Doğrulama bağlantısı geçersiz', description: 'E-posta doğrulaması bu bağlantı üzerinden doğrulanamadı. Gelen kutundaki güncel doğrulama bağlantısını aç. Hesabını daha önce doğruladıysan mobil uygulamadan giriş yapabilirsin.' },
  error: { title: 'Doğrulama kontrol edilemedi', description: 'Bağlantını kontrol edip tekrar dene. E-posta doğrulaması tamamlanmışsa DietBridge mobil uygulamasından giriş yapabilirsin.' },
};

export default function MobileEmailConfirmationPage() {
  const [callback, setCallback] = useState(() => parseMobileEmailCallback(window.location.search, window.location.hash));
  const [result, setResult] = useState<MobileEmailConfirmationResult | null>(null);
  const request = useRef<Promise<MobileEmailConfirmationResult> | null>(null);

  useEffect(() => {
    const readNewCallback = () => {
      request.current = null;
      setResult(null);
      setCallback(parseMobileEmailCallback(window.location.search, window.location.hash));
    };
    window.addEventListener('hashchange', readNewCallback);
    return () => window.removeEventListener('hashchange', readNewCallback);
  }, []);

  useEffect(() => {
    let active = true;
    // Remove tokens before any user navigation; never persist or log callback credentials.
    window.history.replaceState(window.history.state, '', MOBILE_EMAIL_CONFIRMATION_PATH);
    request.current ??= confirmMobileEmail(callback);
    void request.current.then((next) => { if (active) setResult(next); });
    return () => { active = false; };
  }, [callback]);

  const retry = async () => {
    setResult(null);
    setResult(await confirmMobileEmail(callback));
  };
  const message = result ? messages[result.status] : { title: 'E-posta doğrulaması kontrol ediliyor', description: 'Lütfen kısa bir süre bekle.' };
  const StatusIcon = !result ? LoaderCircle : result.status === 'success' ? CheckCircle2 : AlertCircle;

  return (
    <AuthLayout aside={(
      <div className="max-w-md space-y-4">
        <Smartphone size={40} aria-hidden="true" />
        <h2 className="text-30 font-bold leading-tight">Bir sonraki adım mobil uygulamada</h2>
        <p className="text-15 text-white/80">DietBridge hesabına mobil uygulamadan giriş yaparak beslenme takibine devam edebilirsin.</p>
      </div>
    )}>
      <div role="status" aria-live="polite" className="space-y-5">
        <StatusIcon size={44} aria-hidden="true" className={!result ? 'animate-spin text-brand' : result.status === 'success' ? 'text-brand' : 'text-ink-2'} />
        <h1 className="text-28 font-bold leading-tight text-ink">{message.title}</h1>
        <p className="text-15 leading-relaxed text-ink-2">{message.description}</p>
        {result?.status === 'success' ? (
          <p className="rounded-db bg-brand/10 p-4 text-14 text-ink">Mobil uygulamada <strong>Giriş yap</strong> ekranını kullanabilirsin.</p>
        ) : null}
        {result?.status === 'error' ? (
          <button type="button" onClick={() => void retry()} className="min-h-11 rounded-db bg-brand px-5 py-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand">Tekrar dene</button>
        ) : null}
      </div>
    </AuthLayout>
  );
}
