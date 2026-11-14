'use client';

import { AlertCircle, Check, X } from 'lucide-react';
import { useEffect } from 'react';
import { useKit } from './strings';
import st from './controls.module.css';

export interface ToastProps {
  message: string;
  tone?: 'neutral' | 'success' | 'error';
  /** Undo or another short follow-up, named by its operation. */
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
  /** Auto-dismiss after this many ms; 0 keeps it until closed. */
  duration?: number;
  className?: string;
}

/**
 * A small paper slip with a perforated edge, placed next to the control that caused it
 * (the screen positions it).
 * Critical results never live only in a toast.
 */
export function Toast({ message, tone = 'neutral', actionLabel, onAction, onClose, duration = 6000, className }: ToastProps) {
  const { s } = useKit();
  useEffect(() => {
    if (!duration || !onClose) return;
    const t = window.setTimeout(onClose, duration);
    return () => window.clearTimeout(t);
  }, [duration, onClose, message]);
  return (
    <div className={`${st.toastWrap} ${className ?? ''}`} role={tone === 'error' ? 'alert' : 'status'}>
    <div className={st.toast} data-tone={tone}>
      {tone !== 'neutral' ? (
        <span className={st.tIcon} aria-hidden="true">
          {tone === 'success' ? <Check strokeWidth={2} /> : <AlertCircle strokeWidth={1.75} />}
        </span>
      ) : null}
      <span className={st.tMsg}>{message}</span>
      {actionLabel && onAction ? (
        <button type="button" className={st.tAct} onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
      {onClose ? (
        <button type="button" className={st.tClose} aria-label={s.dismiss} onClick={onClose}>
          <X strokeWidth={1.75} />
        </button>
      ) : null}
    </div>
    </div>
  );
}
