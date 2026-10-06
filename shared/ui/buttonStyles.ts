import { cx } from './cx';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-solid' | 'lime';
export type ButtonSize = 'sm' | 'md' | 'lg';

const base =
  'inline-flex items-center justify-center gap-2 whitespace-nowrap border font-semibold transition-colors ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand ' +
  'disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

const variants: Record<ButtonVariant, string> = {
  primary: 'border-brand bg-brand text-white hover:border-brand-hi hover:bg-brand-hi disabled:hover:bg-brand',
  secondary: 'border-line-strong bg-surface text-ink hover:bg-surface-hover disabled:hover:bg-surface',
  ghost: 'border-transparent bg-transparent text-ink-2 hover:bg-surface-hover hover:text-ink',
  danger: 'border-bad-line bg-surface text-bad hover:bg-bad-bg disabled:hover:bg-surface',
  'danger-solid': 'border-bad bg-bad text-white hover:brightness-95',
  lime: 'border-brand-lime bg-brand-lime text-brand-lime-ink hover:brightness-95',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 rounded-control px-3 text-13',
  md: 'h-[38px] rounded-control px-4 text-13.5',
  lg: 'h-[46px] rounded-control px-5 text-15',
};

export const BUTTON_ICON_SIZE: Record<ButtonSize, number> = { sm: 15, md: 17, lg: 18 };

export interface ButtonStyleOptions {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
}

/** Düğme görünümünü <Link>, <a> veya <label> gibi başka öğelere uygulamak için. */
export const buttonClasses = ({ variant = 'secondary', size = 'md', fullWidth = false, className }: ButtonStyleOptions = {}) =>
  cx(base, variants[variant], sizes[size], fullWidth && 'w-full', className);

export type IconButtonVariant = 'outline' | 'bare';
export type IconButtonSize = 'sm' | 'md';

export const iconButtonClasses = ({
  variant = 'outline',
  size = 'md',
  className,
}: { variant?: IconButtonVariant; size?: IconButtonSize; className?: string } = {}) =>
  cx(
    'relative inline-grid shrink-0 place-items-center rounded-control border text-ink-2 transition-colors hover:bg-surface-hover hover:text-ink',
    'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    'disabled:cursor-not-allowed disabled:opacity-60',
    variant === 'outline' ? 'border-line-strong bg-surface' : 'border-transparent bg-transparent',
    size === 'md' ? 'h-[38px] w-[38px]' : 'h-8 w-8',
    className,
  );
