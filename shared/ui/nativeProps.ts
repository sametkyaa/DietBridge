import type {
  ButtonHTMLAttributes,
  CSSProperties,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TdHTMLAttributes,
  TextareaHTMLAttributes,
  ThHTMLAttributes,
} from 'react';

/*
 * Bu repoda @types/react kurulu değil; React'in HTML öznitelik tipleri `any` olarak çözülür ve
 * bir arayüzü onlardan türetmek hiçbir alan kazandırmaz. Aşağıdaki tipler, React tipleri varsa
 * onları kullanır; yoksa bileşenlerin okuduğu alanları açıkça tanımlayan, geri kalan DOM
 * özniteliklerine (aria-*, data-*, olay işleyicileri) izin veren bir yedeğe düşer.
 */
type IsAny<T> = 0 extends 1 & T ? true : false;

interface LooseDomProps {
  id?: string;
  className?: string;
  style?: CSSProperties;
  title?: string;
  role?: string;
  tabIndex?: number;
  children?: ReactNode;
  'aria-describedby'?: string;
  'aria-label'?: string;
  [attribute: string]: unknown;
}

interface LooseFormControlProps extends LooseDomProps {
  name?: string;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  autoComplete?: string;
}

export type NativeDivProps = IsAny<HTMLAttributes<HTMLElement>> extends true ? LooseDomProps : HTMLAttributes<HTMLElement>;

export type NativeButtonProps = IsAny<ButtonHTMLAttributes<HTMLButtonElement>> extends true
  ? LooseFormControlProps & { type?: 'button' | 'submit' | 'reset' }
  : ButtonHTMLAttributes<HTMLButtonElement>;

export type NativeInputProps = IsAny<InputHTMLAttributes<HTMLInputElement>> extends true
  ? LooseFormControlProps & { type?: string; value?: string | number | readonly string[]; checked?: boolean }
  : Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>;

export type NativeSelectProps = IsAny<SelectHTMLAttributes<HTMLSelectElement>> extends true
  ? LooseFormControlProps & { value?: string | number | readonly string[] }
  : Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'>;

export type NativeTextareaProps = IsAny<TextareaHTMLAttributes<HTMLTextAreaElement>> extends true
  ? LooseFormControlProps & { rows?: number; value?: string }
  : TextareaHTMLAttributes<HTMLTextAreaElement>;

export type NativeTableProps = IsAny<HTMLAttributes<HTMLTableElement>> extends true ? LooseDomProps : HTMLAttributes<HTMLTableElement>;
export type NativeTableSectionProps = IsAny<HTMLAttributes<HTMLTableSectionElement>> extends true
  ? LooseDomProps
  : HTMLAttributes<HTMLTableSectionElement>;
export type NativeRowProps = IsAny<HTMLAttributes<HTMLTableRowElement>> extends true ? LooseDomProps : HTMLAttributes<HTMLTableRowElement>;
export type NativeThProps = IsAny<ThHTMLAttributes<HTMLTableCellElement>> extends true
  ? LooseDomProps & { scope?: string; colSpan?: number }
  : ThHTMLAttributes<HTMLTableCellElement>;
export type NativeTdProps = IsAny<TdHTMLAttributes<HTMLTableCellElement>> extends true
  ? LooseDomProps & { colSpan?: number; rowSpan?: number }
  : TdHTMLAttributes<HTMLTableCellElement>;
