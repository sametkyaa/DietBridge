import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { CountPill } from './Badge';
import Icon, { type IconName } from './Icon';
import { cx } from './cx';

export interface TabItem<T extends string = string> {
  value: T;
  label: ReactNode;
  /** Sekme adının yanındaki sayaç. */
  count?: number;
  /** "bad" kırmızı sayaç (ör. Geciken). */
  countTone?: 'neutral' | 'bad';
  icon?: IconName;
  disabled?: boolean;
}

const tabId = (idBase: string, value: string) => `${idBase}-tab-${value}`;
const panelId = (idBase: string, value: string) => `${idBase}-panel-${value}`;

/** Ok tuşları, Home ve End ile odak taşır; devre dışı öğeleri atlar. `activate` seçimi de değiştirir. */
const moveFocus = (
  event: KeyboardEvent<HTMLElement>,
  container: HTMLElement | null,
  selector: string,
  activate: boolean,
) => {
  if (!container) return;
  const keys = ['ArrowRight', 'ArrowLeft', 'Home', 'End'];
  if (!keys.includes(event.key)) return;
  const items = Array.from(container.querySelectorAll<HTMLButtonElement>(selector)).filter((item) => !item.disabled);
  const current = items.indexOf(document.activeElement as HTMLButtonElement);
  if (items.length === 0) return;
  event.preventDefault();
  let next = current;
  if (event.key === 'ArrowRight') next = (current + 1) % items.length;
  if (event.key === 'ArrowLeft') next = (current - 1 + items.length) % items.length;
  if (event.key === 'Home') next = 0;
  if (event.key === 'End') next = items.length - 1;
  items[next].focus();
  if (activate) items[next].click();
};

export interface TabsProps<T extends string> {
  items: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** tablist için erişilebilir ad (ör. "Görev filtresi"). */
  ariaLabel: string;
  /** Sekme ve panel kimlikleri için sayfada benzersiz önek; TabPanel'e de aynı değeri verin. */
  idBase: string;
  /** Sekmelerin sağına yerleşen içerik (ör. "Analizleri aç" bağlantısı). */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Prototipteki .tabs: alt çizgili sekmeler. WAI-ARIA tabs deseni: ok tuşlarıyla gezinilir,
 * seçili sekme dışında sekmeler Tab sırasından çıkarılır.
 */
export const Tabs = <T extends string>({ items, value, onChange, ariaLabel, idBase, trailing, className }: TabsProps<T>) => {
  const listRef = useRef<HTMLDivElement>(null);
  return (
    <div className={cx('flex items-center gap-1 border-b border-line', className)}>
      <div
        ref={listRef}
        role="tablist"
        aria-label={ariaLabel}
        className="flex min-w-0 gap-1 overflow-x-auto"
        onKeyDown={(event) => moveFocus(event, listRef.current, '[role="tab"]', true)}
      >
        {items.map((item) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={tabId(idBase, item.value)}
              aria-selected={selected}
              aria-controls={panelId(idBase, item.value)}
              tabIndex={selected ? 0 : -1}
              disabled={item.disabled}
              onClick={() => onChange(item.value)}
              className={cx(
                '-mb-px inline-flex items-center gap-[7px] whitespace-nowrap border-b-2 px-3.5 py-[11px] text-14 font-semibold transition-colors',
                'focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
                'disabled:cursor-not-allowed disabled:opacity-50',
                selected ? 'border-brand text-brand' : 'border-transparent text-ink-2 hover:text-ink',
              )}
            >
              {item.icon && <Icon name={item.icon} size={17} />}
              {item.label}
              {typeof item.count === 'number' && <CountPill count={item.count} tone={item.countTone === 'bad' ? 'bad' : 'neutral'} />}
            </button>
          );
        })}
      </div>
      {trailing && <div className="ml-auto flex shrink-0 items-center">{trailing}</div>}
    </div>
  );
};

export interface TabPanelProps<T extends string> {
  idBase: string;
  value: T;
  /** Şu an seçili sekme; eşleşmezse panel gizlenir (DOM'dan çıkarılmaz). */
  activeValue: T;
  className?: string;
  children: ReactNode;
}

/** Tabs ile eşleşen sekme paneli. */
export const TabPanel = <T extends string>({ idBase, value, activeValue, className, children }: TabPanelProps<T>) => (
  <div
    role="tabpanel"
    id={panelId(idBase, value)}
    aria-labelledby={tabId(idBase, value)}
    hidden={value !== activeValue}
    tabIndex={0}
    className={cx('focus-visible:outline-none', className)}
  >
    {value === activeValue ? children : null}
  </div>
);

export interface SegmentOption<T extends string = string> {
  value: T;
  label: ReactNode;
  count?: number;
  icon?: IconName;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Grup için erişilebilir ad (ör. "Danışan filtresi"). */
  ariaLabel: string;
  /** "brand" seçili öğeyi yeşil doldurur (.seg a.on.p). */
  activeTone?: 'neutral' | 'brand';
  className?: string;
}

/**
 * Prototipteki .seg: gri zemin üstünde seçili öğesi beyaz kutu olan anahtar (Tümü / Dikkat, Liste / Takvim).
 * Her öğe aria-pressed taşıyan bir düğmedir; ok tuşlarıyla da gezinilebilir.
 */
export const SegmentedControl = <T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  activeTone = 'neutral',
  className,
}: SegmentedControlProps<T>) => {
  const groupRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={groupRef}
      role="group"
      aria-label={ariaLabel}
      onKeyDown={(event) => moveFocus(event, groupRef.current, 'button', false)}
      className={cx('inline-flex gap-0.5 rounded-db border border-line bg-sunk p-[3px]', className)}
    >
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={option.disabled}
            onClick={() => onChange(option.value)}
            className={cx(
              'inline-flex h-8 items-center gap-[7px] rounded-[7px] px-[13px] text-13 font-semibold transition-colors',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
              'disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? activeTone === 'brand'
                  ? 'bg-brand text-white shadow-seg'
                  : 'bg-surface text-ink shadow-seg'
                : 'text-ink-2 hover:text-ink',
            )}
          >
            {option.icon && <Icon name={option.icon} size={16} />}
            {option.label}
            {typeof option.count === 'number' && (
              <span className={cx('text-12 font-medium tabular-nums', selected && activeTone === 'brand' ? 'text-white/80' : 'text-ink-3')}>
                {option.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
};

export interface PillGroupProps<T extends string> {
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
}

/** Prototipteki .pills: kategori filtresi (Tarifler). Seçili hap yeşil doludur. */
export const PillGroup = <T extends string>({ options, value, onChange, ariaLabel, className }: PillGroupProps<T>) => (
  <div role="group" aria-label={ariaLabel} className={cx('flex flex-wrap gap-2', className)}>
    {options.map((option) => {
      const selected = option.value === value;
      return (
        <button
          key={option.value}
          type="button"
          aria-pressed={selected}
          disabled={option.disabled}
          onClick={() => onChange(option.value)}
          className={cx(
            'inline-flex h-[34px] items-center gap-1.5 rounded-full border px-[15px] text-13 font-semibold transition-colors',
            'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
            'disabled:cursor-not-allowed disabled:opacity-50',
            selected ? 'border-brand bg-brand text-white' : 'border-line text-ink-2 hover:bg-surface-hover hover:text-ink',
          )}
        >
          {option.icon && <Icon name={option.icon} size={15} />}
          {option.label}
          {typeof option.count === 'number' && <span className="font-medium opacity-75 tabular-nums">{option.count}</span>}
        </button>
      );
    })}
  </div>
);
