import { Fragment } from 'react';
import { useAuth } from '../context/AuthContext';
import { AuthLayout } from '../components/AuthLayout';
import { Badge, Button, Callout, Icon, cx, type IconName } from '../../../shared/ui';

const formatDateTime = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('tr-TR', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  }).format(date);
};

type StepState = 'done' | 'current' | 'failed';

interface TimelineStep {
  title: string;
  detail: string | null;
  state: StepState;
}

const STEP_ICON: Record<StepState, IconName> = { done: 'check', current: 'hourglass-duotone', failed: 'x' };

/**
 * Application status for pending and rejected dietitians. Each step uses the
 * real profile fields (created_at, diploma_url, verification_status,
 * verified_at, rejection_reason); no review duration is promised.
 */
const VerificationStatusPage = () => {
  const { dietitianProfile, signOut } = useAuth();

  const isRejected = dietitianProfile?.verification_status === 'rejected';
  const steps: TimelineStep[] = [
    { title: 'Hesap oluşturuldu', detail: formatDateTime(dietitianProfile?.created_at), state: 'done' },
    {
      title: 'Mesleki bilgiler ve diploma gönderildi',
      detail: dietitianProfile?.diploma_url ? null : 'Diploma bekleniyor',
      state: dietitianProfile?.diploma_url ? 'done' : 'current',
    },
    {
      title: 'Uzman incelemesi',
      detail: isRejected ? formatDateTime(dietitianProfile?.verified_at) ?? 'Sonuçlandı' : 'Bekleniyor',
      state: isRejected ? 'failed' : 'current',
    },
  ];

  return (
    <AuthLayout>
      <Badge tone={isRejected ? 'bad' : 'warn'} dot className="self-start">{isRejected ? 'Onaylanmadı' : 'İncelemede'}</Badge>
      {isRejected ? (
        <>
          <h1 className="m-0 mt-4 text-28 font-bold tracking-[-0.4px]">Hesabınız Onaylanmadı</h1>
          <p className="m-0 mt-2 text-15 leading-7 text-ink-2">Başvurunuz incelendi ancak şu an için onaylanamadı.</p>
          {dietitianProfile?.rejection_reason && (
            <Callout tone="bad" className="mt-4">
              <b className="block">Red Nedeni:</b>
              <span className="whitespace-pre-wrap break-words">{dietitianProfile.rejection_reason}</span>
            </Callout>
          )}
        </>
      ) : (
        <>
          <h1 className="m-0 mt-4 text-28 font-bold tracking-[-0.4px]">Başvurunuz İncelemede</h1>
          <p className="m-0 mt-2 text-15 leading-7 text-ink-2">
            Başvurunuz alınmıştır. Diploma belgeniz inceleniyor. Onay sonrası sisteme erişebileceksiniz.
          </p>
        </>
      )}

      <ol className="m-0 mt-7 flex list-none flex-col p-0" aria-label="Başvuru durumu">
        {steps.map((step, index) => (
          <Fragment key={step.title}>
            <li className="relative flex gap-3.5 pb-6 last:pb-0">
              {index < steps.length - 1 && <span aria-hidden="true" className="absolute left-[15px] top-8 h-[calc(100%-2rem)] w-px bg-line-strong" />}
              <span
                aria-hidden="true"
                className={cx(
                  'grid h-8 w-8 shrink-0 place-items-center rounded-full',
                  step.state === 'done' ? 'bg-ok text-white' : step.state === 'failed' ? 'bg-bad text-white' : 'border-2 border-warn bg-warn-bg text-warn',
                )}
              >
                <Icon name={STEP_ICON[step.state]} size={15} />
              </span>
              <div className="min-w-0 pt-1">
                <b className="block text-14.5 font-semibold">{step.title}</b>
                {step.detail && <span className="block text-13 text-ink-2">{step.detail}</span>}
                <span className="sr-only">{step.state === 'done' ? 'Tamamlandı' : step.state === 'failed' ? 'Onaylanmadı' : 'Sürüyor'}</span>
              </div>
            </li>
          </Fragment>
        ))}
      </ol>

      <Button variant="secondary" size="lg" fullWidth leftIcon="sign-out" onClick={signOut} className="mt-8">
        Çıkış Yap
      </Button>
    </AuthLayout>
  );
};

export default VerificationStatusPage;
