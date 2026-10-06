import { cx } from '../../../shared/ui';
import { evaluatePasswordStrength } from '../utils/passwordStrength';

const BAR_TONE = ['bg-bad', 'bg-bad', 'bg-warn', 'bg-brand', 'bg-ok'] as const;
const TEXT_TONE = ['text-bad', 'text-bad', 'text-warn', 'text-brand', 'text-ok'] as const;

export const PasswordStrengthMeter = ({ password, id }: { password: string; id?: string }) => {
  if (!password) return null;
  const strength = evaluatePasswordStrength(password);
  return (
    <div id={id} className="flex flex-col gap-1.5" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="grid flex-1 grid-cols-4 gap-1" aria-hidden="true">
          {[1, 2, 3, 4].map((step) => (
            <span key={step} className={cx('h-1.5 rounded-full', strength.level >= step ? BAR_TONE[strength.level] : 'bg-sunk')} />
          ))}
        </div>
        <span className={cx('text-12 font-semibold', TEXT_TONE[strength.level])}>Şifre gücü: {strength.label}</span>
      </div>
      {strength.hints.length > 0 && <span className="text-12 text-ink-3">Öneri: {strength.hints.join(' · ')}</span>}
    </div>
  );
};
