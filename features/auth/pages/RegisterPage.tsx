import React, { useState } from 'react';
import { EyeOff, Eye } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import { registerDietitian, RegistrationData } from '../../dietitians/services/dietitianService';
import { AuthLayout } from '../components/AuthLayout';
import { PasswordStrengthMeter } from '../components/PasswordStrengthMeter';
import { PASSWORD_MIN_LENGTH } from '../utils/passwordStrength';
import { Button, Callout, Icon, Input, LinkButton, cx } from '../../../shared/ui';

const APPLICATION_STEPS = [
  { title: 'Hesabınızı oluşturun', text: 'Ad, e-posta ve şifre' },
  { title: 'Mesleki bilgilerinizi girin', text: 'E-posta doğrulamasından sonra: üniversite, mezuniyet, uzmanlık ve diploma' },
  { title: 'Başvurunuz incelensin', text: 'Onaylandığınızda panele erişim açılır' },
];

const ApplicationSteps = ({ current }: { current: number }) => (
  <>
    <h2 className="m-0 max-w-md text-30 font-bold leading-tight tracking-[-0.4px]">Başvurunuz üç adımda tamamlanır.</h2>
    <ol className="m-0 flex max-w-md list-none flex-col gap-5 p-0">
      {APPLICATION_STEPS.map((step, index) => (
        <li key={step.title} className="flex items-start gap-3.5">
          <span aria-hidden="true" className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full text-14 font-bold', index <= current ? 'bg-white text-brand' : 'bg-white/15 text-white')}>
            {index < current ? <Icon name="check" size={16} /> : index + 1}
          </span>
          <span>
            <b className="block text-15 font-semibold">{step.title}</b>
            <span className="block text-14 text-white/80">{step.text}</span>
          </span>
        </li>
      ))}
    </ol>
  </>
);

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
    isConfirmed: false,
    kvkkAccepted: false,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleCheckboxChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, isConfirmed: e.target.checked }));
  };

  const handleKvkkChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({ ...prev, kvkkAccepted: e.target.checked }));
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

    if (formData.password.length < PASSWORD_MIN_LENGTH) {
      setError(`Şifre en az ${PASSWORD_MIN_LENGTH} karakter olmalıdır.`);
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

    if (!formData.kvkkAccepted) {
      setError("Lütfen KVKK Aydınlatma Metni'ni okuduğunuzu onaylayın.");
      return;
    }
    setLoading(true);

    const payload: RegistrationData = {
      email: formData.email,
      password: formData.password,
      firstName: normalizedFirstName,
      lastName: normalizedLastName,
      termsAccepted: formData.isConfirmed,
      kvkkAccepted: formData.kvkkAccepted,
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
      <AuthLayout aside={<ApplicationSteps current={1} />}>
        <span aria-hidden="true" className="grid h-14 w-14 place-items-center rounded-card bg-ok-bg text-ok"><Icon name="envelope" size={26} /></span>
        <h1 className="m-0 mt-5 text-26 font-bold tracking-[-0.3px]">E-posta adresinizi doğrulayın</h1>
        <p className="m-0 mt-3 text-15 leading-7 text-ink-2">
          <b className="font-semibold text-ink">{confirmationEmail}</b> adresine gönderilen bağlantıyı açın.
          Doğrulama sonrasında mesleki başvurunuzu tamamlayabilirsiniz.
        </p>
        <LinkButton to="/login" variant="primary" size="lg" fullWidth className="mt-7">Giriş Sayfasına Dön</LinkButton>
      </AuthLayout>
    );
  }

  const passwordMismatch = formData.passwordConfirm.length > 0 && formData.password !== formData.passwordConfirm;
  const passwordToggle = (
    <button
      type="button"
      aria-label={showPasswords ? 'Şifreleri gizle' : 'Şifreleri göster'}
      aria-pressed={showPasswords}
      onClick={() => setShowPasswords(previous => !previous)}
      className="grid h-7 w-7 place-items-center rounded-tag text-ink-3 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
    >
      {showPasswords ? <EyeOff className="h-[17px] w-[17px]" aria-hidden="true" /> : <Eye className="h-[17px] w-[17px]" aria-hidden="true" />}
    </button>
  );

  return (
    <AuthLayout aside={<ApplicationSteps current={0} />}>
      <ol className="m-0 mb-5 flex list-none flex-wrap gap-3 p-0 text-12.5 font-semibold" aria-label="Başvuru adımları">
        {['Hesap', 'Mesleki bilgiler', 'İnceleme'].map((label, index) => (
          <li key={label} aria-current={index === 0 ? 'step' : undefined} className={cx('inline-flex items-center gap-1.5', index === 0 ? 'text-brand' : 'text-ink-3')}>
            <span className={cx('grid h-5 w-5 place-items-center rounded-full text-11', index === 0 ? 'bg-brand text-white' : 'border border-line-strong')}>{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <h1 className="m-0 text-28 font-bold tracking-[-0.4px]">Diyetisyen başvurusu</h1>
      <p className="m-0 mt-2 text-14 text-ink-2">Önce hesabınızı oluşturun; e-posta doğrulamasından sonra mesleki bilgilerinizi ve diplomanızı ekleyeceksiniz.</p>

      {error && (
        <Callout tone="bad" role="alert" className="mt-5">
          <span id="register-error">{error}</span>
        </Callout>
      )}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input id="register-first-name" name="firstName" label="Ad" autoComplete="given-name" required value={formData.firstName} onChange={handleChange} placeholder="Adınız" aria-describedby={error ? 'register-error' : undefined} />
          <Input id="register-last-name" name="lastName" label="Soyad" autoComplete="family-name" required value={formData.lastName} onChange={handleChange} placeholder="Soyadınız" aria-describedby={error ? 'register-error' : undefined} />
        </div>
        <Input id="register-email" type="email" name="email" label="E-posta" leadingIcon="envelope" autoComplete="email" required value={formData.email} onChange={handleChange} placeholder="ornek@eposta.com" aria-describedby={error ? 'register-error' : undefined} />
        <div className="flex flex-col gap-2">
          <Input
            id="register-password"
            type={showPasswords ? 'text' : 'password'}
            name="password"
            label="Şifre"
            leadingIcon="lock"
            autoComplete="new-password"
            required
            value={formData.password}
            onChange={handleChange}
            placeholder={`En az ${PASSWORD_MIN_LENGTH} karakter`}
            aria-describedby="register-password-strength"
            trailing={passwordToggle}
          />
          <PasswordStrengthMeter id="register-password-strength" password={formData.password} />
        </div>
        <Input
          id="register-password-confirm"
          type={showPasswords ? 'text' : 'password'}
          name="passwordConfirm"
          label="Şifre Tekrar"
          leadingIcon="lock"
          autoComplete="new-password"
          required
          value={formData.passwordConfirm}
          onChange={handleChange}
          placeholder="Şifrenizi tekrar girin"
          error={passwordMismatch ? 'Şifreler eşleşmiyor.' : undefined}
        />

        <div className="flex flex-col gap-2.5 rounded-db border border-line bg-surface p-3.5">
          <label htmlFor="confirm-license" className="flex items-start gap-2.5 text-13.5 leading-6 text-ink-2">
            <input type="checkbox" id="confirm-license" checked={formData.isConfirmed} onChange={handleCheckboxChange} className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--db-brand))]" />
            <span>Lisanslı bir diyetisyen olduğumu ve <a href="https://dietbridge.com.tr/kullanim-kosullari" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">Kullanım Koşulları</a>'nı kabul ediyorum.</span>
          </label>
          <label htmlFor="confirm-kvkk" className="flex items-start gap-2.5 text-13.5 leading-6 text-ink-2">
            <input type="checkbox" id="confirm-kvkk" checked={formData.kvkkAccepted} onChange={handleKvkkChange} className="mt-1 h-4 w-4 shrink-0 accent-[rgb(var(--db-brand))]" />
            <span><a href="https://dietbridge.com.tr/kvkk" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand hover:underline">KVKK Aydınlatma Metni</a>'ni okudum ve kişisel verilerimin işlenmesini kabul ediyorum.</span>
          </label>
        </div>

        <Button type="submit" variant="primary" size="lg" fullWidth rightIcon="arrow-right" loading={loading} disabled={loading}>
          Hesap Oluştur
        </Button>
      </form>

      <p className="m-0 mt-7 text-center text-14 text-ink-2">
        Zaten hesabınız var mı? <Link to="/login" className="font-semibold text-brand hover:text-brand-hi">Giriş Yap</Link>
      </p>
    </AuthLayout>
  );
};

export default RegisterPage;
