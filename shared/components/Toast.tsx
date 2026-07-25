import React, { useEffect, useRef, useState } from 'react';
import { Check, X, AlertCircle } from 'lucide-react';

export interface ToastProps {
  message: string;
  variant: 'success' | 'error';
  duration?: number;
  onClose?: () => void;
}

/**
 * DietBridge themed non-blocking toast notification.
 *
 * Renders near the top of the viewport, auto-dismisses after `duration`
 * milliseconds, and cleans up its timer when unmounted or re-triggered.
 */
export const Toast: React.FC<ToastProps> = ({
  message,
  variant,
  duration = 3500,
  onClose,
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setVisible(true);
    timerRef.current = setTimeout(() => {
      setVisible(false);
      timerRef.current = setTimeout(() => onClose?.(), 300);
    }, duration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [duration, message, onClose, variant]);

  const isSuccess = variant === 'success';
  const Icon = isSuccess ? Check : AlertCircle;
  const role = isSuccess ? 'status' : 'alert';
  const ariaLive = isSuccess ? 'polite' : 'assertive';

  const handleClose = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setVisible(false);
    timerRef.current = setTimeout(() => onClose?.(), 300);
  };

  return (
    <div
      role={role}
      aria-live={ariaLive}
      aria-atomic="true"
      className={`fixed top-24 left-1/2 -translate-x-1/2 z-[60] w-[calc(100%_-_2rem)] max-w-md transition-all duration-300 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-4 pointer-events-none'
      }`}
    >
      <div
        className={`flex items-center gap-3 rounded-xl border px-4 py-3 shadow-lg ${
          isSuccess
            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
            : 'border-rose-200 bg-rose-50 text-rose-800'
        }`}
      >
        <div
          className={`flex-shrink-0 rounded-full p-1 ${
            isSuccess ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'
          }`}
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
        </div>
        <p className="flex-1 text-sm font-medium">{message}</p>
        <button
          type="button"
          onClick={handleClose}
          className={`flex-shrink-0 rounded-lg p-1 transition-colors ${
            isSuccess
              ? 'text-emerald-600 hover:bg-emerald-100'
              : 'text-rose-600 hover:bg-rose-100'
          }`}
          aria-label="Bildirimi kapat"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default Toast;
