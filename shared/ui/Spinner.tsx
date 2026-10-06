import { cx } from './cx';

export interface SpinnerProps {
  /** Piksel. Varsayılan 16. */
  size?: number;
  className?: string;
}

/** Dekoratif dönen gösterge. Durum metni için LoadingState veya Button `loading` kullanın. */
const Spinner = ({ size = 16, className }: SpinnerProps) => (
  <span
    aria-hidden="true"
    className={cx('inline-block shrink-0 animate-spin rounded-full border-2 border-current border-r-transparent', className)}
    style={{ width: size, height: size }}
  />
);

export default Spinner;
