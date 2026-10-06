import { useId, type ReactNode, type Ref } from 'react';
import Icon, { type IconName } from './Icon';
import { cx } from './cx';
import type { NativeInputProps, NativeSelectProps, NativeTextareaProps } from './nativeProps';

/* ------------------------------------------------------------------ */
/* Field                                                               */
/* ------------------------------------------------------------------ */

export interface FieldBaseProps {
  /** Görünür etiket. Etiket gizlenecekse yine verin ve `hideLabel` kullanın. */
  label?: ReactNode;
  hideLabel?: boolean;
  /** Alanın altında gösterilen yardım metni (hata varken gizlenir). */
  hint?: ReactNode;
  /** Alanla ilişkili doğrulama hatası. Verildiğinde alan aria-invalid olur. */
  error?: ReactNode;
  /** Etikete "*" ekler ve alanı required yapar. */
  required?: boolean;
  /** Etiket + alan sarmalayıcısına sınıf. */
  containerClassName?: string;
}

interface FieldProps extends FieldBaseProps {
  id: string;
  hintId: string;
  errorId: string;
  children: ReactNode;
}

/** Etiket, alan, yardım ve hata metnini prototipteki .field düzeninde dizer (7px aralık). */
export const Field = ({ id, hintId, errorId, label, hideLabel, hint, error, required, containerClassName, children }: FieldProps) => (
  <div className={cx('flex min-w-0 flex-col gap-[7px]', containerClassName)}>
    {label && (
      <label htmlFor={id} className={cx('text-13 font-semibold text-ink', hideLabel && 'sr-only')}>
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-bad">
            *
          </span>
        )}
      </label>
    )}
    {children}
    {hint && !error && (
      <p id={hintId} className="m-0 text-12.5 text-ink-3">
        {hint}
      </p>
    )}
    {error && (
      <p id={errorId} className="m-0 flex items-center gap-1.5 text-12.5 font-medium text-bad">
        <Icon name="warning-circle" size={14} />
        {error}
      </p>
    )}
  </div>
);

const useFieldIds = (explicitId: string | undefined, hint: ReactNode, error: ReactNode, describedBy: string | undefined) => {
  const generated = useId();
  const id = explicitId ?? `fld-${generated}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const ariaDescribedBy = [describedBy, error ? errorId : hint ? hintId : undefined].filter(Boolean).join(' ') || undefined;
  return { id, hintId, errorId, ariaDescribedBy };
};

/** .input kutusu: 42px, 9px köşe, odakta yeşil kenar + 3px açık yeşil hale. */
const controlBox = (invalid: boolean, disabled: boolean | undefined) =>
  cx(
    'flex w-full min-w-0 items-center gap-2.5 rounded-control border bg-surface px-[13px] text-14 text-ink transition-shadow',
    invalid
      ? 'border-bad focus-within:shadow-focus-bad'
      : 'border-line-strong focus-within:border-brand focus-within:shadow-focus',
    disabled && 'cursor-not-allowed bg-sunk opacity-70',
  );

const innerControl =
  'w-full min-w-0 flex-1 border-0 bg-transparent p-0 text-14 text-ink outline-none placeholder:text-ink-3 focus:outline-none focus:ring-0 disabled:cursor-not-allowed';

/* ------------------------------------------------------------------ */
/* Input                                                               */
/* ------------------------------------------------------------------ */

export type InputProps = FieldBaseProps & NativeInputProps & {
  /** Kutunun solundaki ikon (ör. "magnifying-glass", "calendar-blank"). */
  leadingIcon?: IconName;
  /** Kutunun sağındaki içerik (ör. birim "kg" veya şifre göster düğmesi). */
  trailing?: ReactNode;
  /** Kutunun kendisine sınıf (genişlik vb.). */
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

/** Prototipteki .input. Etiket, hata ve yardım metni aria ile alana bağlanır. */
export const Input = ({
  id: explicitId,
  label,
  hideLabel,
  hint,
  error,
  required,
  containerClassName,
  leadingIcon,
  trailing,
  className,
  disabled,
  'aria-describedby': describedBy,
  ...rest
}: InputProps) => {
  const { id, hintId, errorId, ariaDescribedBy } = useFieldIds(explicitId, hint, error, describedBy);
  const invalid = Boolean(error);
  return (
    <Field {...{ id, hintId, errorId, label, hideLabel, hint, error, required, containerClassName }}>
      <div className={cx(controlBox(invalid, disabled), 'h-[42px]', className)}>
        {leadingIcon && <Icon name={leadingIcon} size={17} className="text-ink-3" />}
        <input
          id={id}
          className={innerControl}
          disabled={disabled}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={ariaDescribedBy}
          {...rest}
        />
        {trailing}
      </div>
    </Field>
  );
};

export type SearchInputProps = InputProps & {
  /** Görünmez etiket; ekran okuyucu için zorunlu (ör. "Danışan ara"). */
  label: string;
};

/** Arama kutusu: büyüteç ikonlu, gizli etiketli Input (prototipte 260px). */
export const SearchInput = ({ label, hideLabel = true, className, ...rest }: SearchInputProps) => (
  <Input
    type="search"
    label={label}
    hideLabel={hideLabel}
    leadingIcon="magnifying-glass"
    className={cx('w-full sm:w-[260px]', className)}
    {...rest}
  />
);

/* ------------------------------------------------------------------ */
/* Select                                                              */
/* ------------------------------------------------------------------ */

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectProps = FieldBaseProps & NativeSelectProps & {
  /** Seçenekler; alternatif olarak <option> çocukları verilebilir. */
  options?: readonly SelectOption[];
  /** Boş değerli, seçilemeyen ilk seçenek (ör. "Danışan seçin"). */
  placeholder?: string;
  leadingIcon?: IconName;
  className?: string;
  ref?: Ref<HTMLSelectElement>;
};

/** Yerel <select>; prototipteki görünüm ve aşağı ok ikonuyla. Klavye ve mobil davranışı tarayıcıdan gelir. */
export const Select = ({
  id: explicitId,
  label,
  hideLabel,
  hint,
  error,
  required,
  containerClassName,
  options,
  placeholder,
  leadingIcon,
  className,
  disabled,
  children,
  'aria-describedby': describedBy,
  ...rest
}: SelectProps) => {
  const { id, hintId, errorId, ariaDescribedBy } = useFieldIds(explicitId, hint, error, describedBy);
  const invalid = Boolean(error);
  return (
    <Field {...{ id, hintId, errorId, label, hideLabel, hint, error, required, containerClassName }}>
      <div className={cx(controlBox(invalid, disabled), 'relative h-[42px] pr-0', className)}>
        {leadingIcon && <Icon name={leadingIcon} size={17} className="text-ink-3" />}
        <select
          id={id}
          className={cx(innerControl, 'h-full cursor-pointer appearance-none pr-10')}
          disabled={disabled}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={ariaDescribedBy}
          {...rest}
        >
          {placeholder !== undefined && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options?.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
          {children}
        </select>
        <Icon name="caret-down" size={16} className="pointer-events-none absolute right-[13px] text-ink-3" />
      </div>
    </Field>
  );
};

/* ------------------------------------------------------------------ */
/* Textarea                                                            */
/* ------------------------------------------------------------------ */

export type TextareaProps = FieldBaseProps & NativeTextareaProps & {
  className?: string;
  ref?: Ref<HTMLTextAreaElement>;
};

/** Prototipteki .input.area: en az 84px yükseklik. */
export const Textarea = ({
  id: explicitId,
  label,
  hideLabel,
  hint,
  error,
  required,
  containerClassName,
  className,
  disabled,
  rows = 3,
  'aria-describedby': describedBy,
  ...rest
}: TextareaProps) => {
  const { id, hintId, errorId, ariaDescribedBy } = useFieldIds(explicitId, hint, error, describedBy);
  const invalid = Boolean(error);
  return (
    <Field {...{ id, hintId, errorId, label, hideLabel, hint, error, required, containerClassName }}>
      <div className={cx(controlBox(invalid, disabled), 'items-start py-[11px]', className)}>
        <textarea
          id={id}
          rows={rows}
          className={cx(innerControl, 'min-h-[62px] resize-y leading-normal')}
          disabled={disabled}
          required={required}
          aria-invalid={invalid || undefined}
          aria-describedby={ariaDescribedBy}
          {...rest}
        />
      </div>
    </Field>
  );
};

/* ------------------------------------------------------------------ */
/* Checkbox                                                            */
/* ------------------------------------------------------------------ */

export type CheckboxProps = NativeInputProps & {
  /** Kutunun yanındaki etiket. Etiketsiz kullanımda aria-label verin. */
  label?: ReactNode;
  /** Etiketin altında soluk açıklama. */
  description?: ReactNode;
  /** "round" prototipteki .cb.r (yuvarlak). */
  shape?: 'square' | 'round';
  className?: string;
  ref?: Ref<HTMLInputElement>;
};

/** Prototipteki .cb: 20px kutu. Yerel checkbox görünmez ama odaklanabilir kalır (Space ile değişir). */
export const Checkbox = ({ id: explicitId, label, description, shape = 'square', className, disabled, ...rest }: CheckboxProps) => {
  const generated = useId();
  const id = explicitId ?? `cb-${generated}`;
  const descriptionId = description ? `${id}-desc` : undefined;
  return (
    <label
      htmlFor={id}
      className={cx('inline-flex items-start gap-2.5 text-14 text-ink', disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer', className)}
    >
      <span className="relative mt-px inline-grid shrink-0">
        <input
          id={id}
          type="checkbox"
          disabled={disabled}
          aria-describedby={descriptionId}
          className="peer absolute inset-0 m-0 h-full w-full cursor-[inherit] opacity-0"
          {...rest}
        />
        <span
          aria-hidden="true"
          className={cx(
            'grid h-5 w-5 place-items-center border-[1.5px] border-line-strong bg-surface text-transparent transition-colors',
            shape === 'round' ? 'rounded-full' : 'rounded-[6px]',
            'peer-checked:border-brand peer-checked:bg-brand peer-checked:text-white',
            'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand',
          )}
        >
          <Icon name="check" size={13} />
        </span>
      </span>
      {(label || description) && (
        <span className="flex min-w-0 flex-col">
          {label && <span className="font-medium">{label}</span>}
          {description && (
            <span id={descriptionId} className="text-12.5 text-ink-3">
              {description}
            </span>
          )}
        </span>
      )}
    </label>
  );
};

/* ------------------------------------------------------------------ */
/* Toggle                                                              */
/* ------------------------------------------------------------------ */

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Görünür etiket. Görünür etiket yoksa `ariaLabel` zorunludur. */
  label?: ReactNode;
  ariaLabel?: string;
  description?: ReactNode;
  disabled?: boolean;
  /** İşlem sürerken anahtarı kilitler. */
  busy?: boolean;
  id?: string;
  className?: string;
}

/** Açma/kapama anahtarı: role="switch", Space/Enter ile değişir. */
export const Toggle = ({ checked, onChange, label, ariaLabel, description, disabled = false, busy = false, id: explicitId, className }: ToggleProps) => {
  const generated = useId();
  const id = explicitId ?? `tg-${generated}`;
  const labelId = label ? `${id}-label` : undefined;
  const descriptionId = description ? `${id}-desc` : undefined;
  const locked = disabled || busy;
  return (
    <div className={cx('flex items-start gap-3', className)}>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-label={labelId ? undefined : ariaLabel}
        aria-describedby={descriptionId}
        aria-busy={busy || undefined}
        disabled={locked}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-px inline-flex h-[22px] w-[38px] shrink-0 items-center rounded-full transition-colors',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          'disabled:cursor-not-allowed disabled:opacity-60',
          checked ? 'bg-brand' : 'bg-line-strong',
        )}
      >
        <span
          aria-hidden="true"
          className={cx(
            'absolute left-[3px] h-4 w-4 rounded-full bg-white shadow-seg transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
      {(label || description) && (
        <div className="flex min-w-0 flex-col">
          {label && (
            <label id={labelId} htmlFor={id} className={cx('text-14 font-medium text-ink', locked ? 'cursor-not-allowed' : 'cursor-pointer')}>
              {label}
            </label>
          )}
          {description && (
            <span id={descriptionId} className="text-12.5 text-ink-3">
              {description}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* RadioCards                                                          */
/* ------------------------------------------------------------------ */

export interface RadioCardOption<T extends string = string> {
  value: T;
  label: ReactNode;
  icon?: IconName;
  disabled?: boolean;
}

export interface RadioCardsProps<T extends string> {
  /** Grup başlığı (fieldset legend). */
  legend: ReactNode;
  hideLegend?: boolean;
  /** Yerel radyo adı; sayfada benzersiz olmalı. */
  name: string;
  options: readonly RadioCardOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  columns?: 2 | 3 | 4;
  error?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/**
 * Prototipteki .opt: kart görünümlü tek seçim (ör. Görüşme türü: Görüntülü / Yüz yüze / Telefon).
 * Yerel radyo düğmeleri kullanır; ok tuşlarıyla seçim tarayıcıdan gelir.
 */
export const RadioCards = <T extends string>({
  legend,
  hideLegend = false,
  name,
  options,
  value,
  onChange,
  columns = 3,
  error,
  disabled = false,
  className,
}: RadioCardsProps<T>) => {
  const generated = useId();
  const errorId = `rc-${generated}-error`;
  return (
    <fieldset className={cx('m-0 flex min-w-0 flex-col gap-[7px] border-0 p-0', className)} aria-describedby={error ? errorId : undefined} disabled={disabled}>
      <legend className={cx('mb-[7px] p-0 text-13 font-semibold text-ink', hideLegend && 'sr-only')}>{legend}</legend>
      <div className={cx('grid gap-2.5', columns === 2 && 'grid-cols-2', columns === 3 && 'grid-cols-1 sm:grid-cols-3', columns === 4 && 'grid-cols-2 sm:grid-cols-4')}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <label
              key={option.value}
              className={cx(
                'relative flex h-11 items-center justify-center gap-2 rounded-control border text-14 font-semibold transition-colors',
                'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand',
                selected ? 'border-brand bg-brand-tint text-brand' : 'border-line-strong text-ink-2 hover:bg-surface-hover',
                option.disabled || disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
              )}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                disabled={option.disabled}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.icon && <Icon name={option.icon} size={18} />}
              {option.label}
            </label>
          );
        })}
      </div>
      {error && (
        <p id={errorId} className="m-0 flex items-center gap-1.5 text-12.5 font-medium text-bad">
          <Icon name="warning-circle" size={14} />
          {error}
        </p>
      )}
    </fieldset>
  );
};
