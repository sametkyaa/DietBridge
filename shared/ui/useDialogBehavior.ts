import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const getFocusable = (container: HTMLElement) =>
  Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.hasAttribute('inert') && element.getClientRects().length > 0,
  );

let openDialogCount = 0;
let previousBodyOverflow = '';

interface DialogBehaviorOptions {
  open: boolean;
  containerRef: RefObject<HTMLElement | null>;
  /** Escape tuşunda çağrılır; null ise Escape yok sayılır (ör. işlem sürerken). */
  onEscape: (() => void) | null;
  /** Açılınca odaklanacak öğe; yoksa ilk odaklanabilir öğe, o da yoksa kabın kendisi. */
  initialFocusRef?: RefObject<HTMLElement | null>;
}

/**
 * Modal ve çekmece için ortak davranış: odak tuzağı (Tab/Shift+Tab döngüsü), Escape ile kapatma,
 * açılışta odak taşıma, kapanışta odağı tetikleyen öğeye geri verme ve gövde kaydırmasını kilitleme.
 */
export const useDialogBehavior = ({ open, containerRef, onEscape, initialFocusRef }: DialogBehaviorOptions) => {
  const onEscapeRef = useRef(onEscape);
  useEffect(() => {
    onEscapeRef.current = onEscape;
  }, [onEscape]);

  useEffect(() => {
    if (!open) return undefined;
    const container = containerRef.current;
    if (!container) return undefined;
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    openDialogCount += 1;
    if (openDialogCount === 1) {
      previousBodyOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }

    const focusTarget = initialFocusRef?.current ?? getFocusable(container)[0] ?? container;
    focusTarget.focus({ preventScroll: true });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (onEscapeRef.current) {
          event.stopPropagation();
          onEscapeRef.current();
        }
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = getFocusable(container);
      if (focusable.length === 0) {
        event.preventDefault();
        container.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !container.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !container.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    };

    container.addEventListener('keydown', handleKeyDown);
    return () => {
      container.removeEventListener('keydown', handleKeyDown);
      openDialogCount = Math.max(0, openDialogCount - 1);
      if (openDialogCount === 0) document.body.style.overflow = previousBodyOverflow;
      if (previouslyFocused && document.contains(previouslyFocused)) previouslyFocused.focus({ preventScroll: true });
    };
    // initialFocusRef bir ref nesnesidir; yalnızca açılışta okunur.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, containerRef]);
};
