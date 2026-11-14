'use client';

import { X } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useKit } from './strings';
import st from './controls.module.css';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),textarea,select,[tabindex]:not([tabindex="-1"])';

/** Escape, focus trap, focus restore and scroll lock for a modal layer. */
function useModal(open: boolean, onClose: () => void, inline: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || inline) return;
    const prev = document.activeElement as HTMLElement | null;
    const node = ref.current;
    const first = node?.querySelector<HTMLElement>('[data-autofocus]') ?? node?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Tab' && node) {
        const list = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (!list.length) return;
        const a = list[0];
        const z = list[list.length - 1];
        if (e.shiftKey && document.activeElement === a) {
          e.preventDefault();
          z.focus();
        } else if (!e.shiftKey && document.activeElement === z) {
          e.preventDefault();
          a.focus();
        }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
      prev?.focus?.();
    };
  }, [open, inline, onClose]);
  return ref;
}

function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

interface LayerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
  /** Render in place instead of over the page (gallery and docs). */
  inline?: boolean;
}

export function Dialog({ open, onClose, title, children, footer, inline = false }: LayerProps) {
  const { s } = useKit();
  const id = useId();
  const ref = useModal(open, onClose, inline);
  const mounted = useMounted();
  if (!open) return null;
  const node = (
    <div
      className={`${st.scrim} ${inline ? st.inline : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className={st.dialog} role="dialog" aria-modal={!inline || undefined} aria-labelledby={id}>
        <div className={st.dHead}>
          <h2 id={id} className={st.dTitle}>
            {title}
          </h2>
          <button type="button" className={st.close} aria-label={s.close} onClick={onClose}>
            <X strokeWidth={1.75} />
          </button>
        </div>
        <div className={st.dBody}>{children}</div>
        {footer ? <div className={st.dFoot}>{footer}</div> : null}
      </div>
    </div>
  );
  return inline || !mounted ? node : createPortal(node, document.body);
}

/** Bottom sheet: the task inspector on narrow screens. Drag the grip down to close. */
export function Sheet({ open, onClose, title, children, footer, inline = false }: LayerProps) {
  const { s } = useKit();
  const id = useId();
  const ref = useModal(open, onClose, inline);
  const mounted = useMounted();
  const drag = useRef<{ y: number; dy: number } | null>(null);
  if (!open) return null;
  const node = (
    <div
      className={`${st.scrim} ${st.scrimSheet} ${inline ? st.inline : ''}`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div ref={ref} className={st.sheet} role="dialog" aria-modal={!inline || undefined} aria-labelledby={id}>
        <span
          className={st.grab}
          aria-hidden="true"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, dy: 0 };
          }}
          onPointerMove={(e) => {
            if (!drag.current || !ref.current) return;
            drag.current.dy = Math.max(0, e.clientY - drag.current.y);
            ref.current.style.transform = `translateY(${drag.current.dy}px)`;
          }}
          onPointerUp={() => {
            const d = drag.current;
            drag.current = null;
            if (!ref.current) return;
            if (d && d.dy > 90) onClose();
            else {
              ref.current.style.transition = 'transform .25s var(--spring)';
              ref.current.style.transform = '';
              window.setTimeout(() => ref.current && (ref.current.style.transition = ''), 260);
            }
          }}
          style={{ cursor: 'grab', touchAction: 'none', padding: '8px 0', boxSizing: 'content-box', backgroundClip: 'content-box' }}
        />
        <div className={st.dHead}>
          <h2 id={id} className={st.dTitle}>
            {title}
          </h2>
          <button type="button" className={st.close} aria-label={s.close} onClick={onClose}>
            <X strokeWidth={1.75} />
          </button>
        </div>
        <div className={st.dBody}>{children}</div>
        {footer ? <div className={st.dFoot}>{footer}</div> : null}
      </div>
    </div>
  );
  return inline || !mounted ? node : createPortal(node, document.body);
}
