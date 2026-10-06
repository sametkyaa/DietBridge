import type { ReactNode, Ref } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import Icon, { type IconName } from './Icon';
import Spinner from './Spinner';
import {
  BUTTON_ICON_SIZE,
  buttonClasses,
  iconButtonClasses,
  type ButtonSize,
  type ButtonVariant,
  type IconButtonSize,
  type IconButtonVariant,
} from './buttonStyles';
import type { NativeButtonProps } from './nativeProps';

export type ButtonProps = NativeButtonProps & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Metinden önce gösterilen ikon. */
  leftIcon?: IconName;
  /** Metinden sonra gösterilen ikon. */
  rightIcon?: IconName;
  /** İşlem sürerken: düğmeyi kilitler, aria-busy ekler, ikonu dönen göstergeyle değiştirir. */
  loading?: boolean;
  fullWidth?: boolean;
  ref?: Ref<HTMLButtonElement>;
};

/**
 * Prototipteki .btn. Varsayılan tür "button"dur; form gönderimi için type="submit" verin.
 * `loading` true iken tekrar gönderim engellenir.
 */
export const Button = ({
  variant = 'secondary',
  size = 'md',
  leftIcon,
  rightIcon,
  loading = false,
  fullWidth = false,
  disabled,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) => {
  const iconSize = BUTTON_ICON_SIZE[size];
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {loading ? <Spinner size={iconSize - 2} /> : leftIcon && <Icon name={leftIcon} size={iconSize} />}
      {children}
      {rightIcon && <Icon name={rightIcon} size={iconSize} />}
    </button>
  );
};

export interface LinkButtonProps extends LinkProps {
  variant?: ButtonVariant;
  size?: ButtonSize;
  leftIcon?: IconName;
  rightIcon?: IconName;
  fullWidth?: boolean;
  children?: ReactNode;
}

/** Düğme görünümünde react-router bağlantısı (sayfa geçişleri için). */
export const LinkButton = ({
  variant = 'secondary',
  size = 'md',
  leftIcon,
  rightIcon,
  fullWidth = false,
  className,
  children,
  ...rest
}: LinkButtonProps) => {
  const iconSize = BUTTON_ICON_SIZE[size];
  return (
    <Link
      className={buttonClasses({ variant, size, fullWidth, className })}
      {...rest}
    >
      {leftIcon && <Icon name={leftIcon} size={iconSize} />}
      {children}
      {rightIcon && <Icon name={rightIcon} size={iconSize} />}
    </Link>
  );
};

export type IconButtonProps = NativeButtonProps & {
  icon: IconName;
  /** Zorunlu erişilebilir ad (ör. "Bildirimler", "Kapat"). Aynı zamanda ipucu (title) olarak gösterilir. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Sağ üstte kırmızı nokta (ör. okunmamış bildirim). */
  dot?: boolean;
  iconSize?: number;
  ref?: Ref<HTMLButtonElement>;
};

/** Prototipteki .ib: 38x38 (sm: 32x32) yalnızca ikonlu düğme. */
export const IconButton = ({
  icon,
  label,
  variant = 'outline',
  size = 'md',
  dot = false,
  iconSize,
  className,
  type = 'button',
  title,
  ...rest
}: IconButtonProps) => (
  <button
    type={type}
    aria-label={label}
    title={title ?? label}
    className={iconButtonClasses({ variant, size, className })}
    {...rest}
  >
    <Icon name={icon} size={iconSize ?? (size === 'md' ? 19 : 17)} />
    {dot && (
      <span
        aria-hidden="true"
        className="absolute right-[9px] top-2 h-[7px] w-[7px] rounded-full border-2 border-surface bg-bad"
      />
    )}
  </button>
);
