import { useId, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { Button, IconButton } from './Button';
import { cx } from './cx';
import { useDialogBehavior } from './useDialogBehavior';

export interface ModalProps {
  open: boolean;
  /** Kapatma isteği (Escape, arka plan tıklaması, kapat düğmesi). */
  onClose: () => void;
  title: ReactNode;
  /** Başlık altındaki açıklama; aria-describedby ile bağlanır. */
  description?: ReactNode;
  children?: ReactNode;
  /** Alt şerit (genelde Vazgeç + birincil eylem). */
  footer?: ReactNode;
  /** sm 440px, md 560px (prototip), lg 720px. */
  size?: 'sm' | 'md' | 'lg';
  /** false iken Escape, arka plan ve kapat düğmesi kapatmaz (ör. kayıt sürerken). */
  dismissible?: boolean;
  closeOnBackdrop?: boolean;
  /** Açılışta odaklanacak öğe (ör. ilk alan). */
  initialFocusRef?: RefObject<HTMLElement | null>;
  /** "alertdialog" onay pencereleri için. */
  role?: 'dialog' | 'alertdialog';
  className?: string;
}

const widths = { sm: 'max-w-[440px]', md: 'max-w-[560px]', lg: 'max-w-[720px]' } as const;

/**
 * Prototipteki .modal: ortalanmış, 16px köşeli pencere ve koyu yeşil yarı saydam arka plan.
 * Odak tuzağı, Escape ile kapanma, aria-modal ve odağın geri verilmesi dahildir.
 */
export const Modal = ({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  dismissible = true,
  closeOnBackdrop = true,
  initialFocusRef,
  role = 'dialog',
  className,
}: ModalProps) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const baseId = useId();
  const titleId = `${baseId}-title`;
  const descriptionId = `${baseId}-desc`;
  useDialogBehavior({ open, containerRef: dialogRef, onEscape: dismissible ? onClose : null, initialFocusRef });

  if (!open) return null;
  return createPortal(
    <div
      className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-scrim p-5"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dismissible && closeOnBackdrop) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cx('w-full rounded-modal bg-surface text-14 text-ink shadow-modal focus:outline-none', widths[size], className)}
      >
        <div className="flex items-start gap-3 px-6 pb-1 pt-[22px]">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="m-0 text-19 font-bold text-ink">
              {title}
            </h2>
            {description && (
              <p id={descriptionId} className="m-0 mt-1 text-13.5 text-ink-2">
                {description}
              </p>
            )}
          </div>
          {dismissible && <IconButton icon="x" label="Kapat" variant="bare" size="sm" onClick={onClose} className="-mr-1.5 -mt-1" />}
        </div>
        {children && <div className="flex flex-col gap-4 px-6 py-4">{children}</div>}
        {footer && <div className="flex flex-wrap justify-end gap-2.5 px-6 pb-[22px] pt-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};

export interface ConfirmDialogProps {
  open: boolean;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** "danger" silme gibi geri alınamaz işlemler için kırmızı onay düğmesi. */
  tone?: 'default' | 'danger';
  /** İşlem sürerken: onay düğmesi döner, pencere kapatılamaz. */
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/** Açık onay gerektiren işlemler için (ör. silme). window.confirm yerine kullanılır. */
export const ConfirmDialog = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Vazgeç',
  tone = 'default',
  busy = false,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) => {
  const cancelRef = useRef<HTMLButtonElement>(null);
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      role="alertdialog"
      dismissible={!busy}
      initialFocusRef={cancelRef}
      footer={
        <>
          <Button ref={cancelRef} variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger-solid' : 'primary'} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
};

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  /** Başlığın sağında ek eylemler (ör. "Tümünü okundu say"). */
  actions?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  /** Varsayılan 430px (prototip). */
  width?: number;
  dismissible?: boolean;
  initialFocusRef?: RefObject<HTMLElement | null>;
  className?: string;
}

/** Prototipteki .drawer: sağdan açılan panel (ör. Bildirimler). Modal ile aynı erişilebilirlik davranışı. */
export const Drawer = ({
  open,
  onClose,
  title,
  actions,
  children,
  footer,
  width = 430,
  dismissible = true,
  initialFocusRef,
  className,
}: DrawerProps) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = `${useId()}-title`;
  useDialogBehavior({ open, containerRef: panelRef, onEscape: dismissible ? onClose : null, initialFocusRef });

  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[rgb(24_34_29/0.35)]"
        onMouseDown={() => {
          if (dismissible) onClose();
        }}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width }}
        className={cx('absolute bottom-0 right-0 top-0 flex max-w-full flex-col bg-surface text-14 text-ink shadow-drawer focus:outline-none', className)}
      >
        <div className="flex items-center gap-3 px-6 pb-1.5 pt-[22px]">
          <h2 id={titleId} className="m-0 min-w-0 flex-1 text-20 font-bold">
            {title}
          </h2>
          {actions}
          {dismissible && <IconButton icon="x" label="Kapat" variant="bare" size="sm" onClick={onClose} />}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer && <div className="border-t border-line px-6 py-4">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
};
