'use client';

import { motion } from 'motion/react';
import { useId, useRef, type KeyboardEvent } from 'react';
import type { Surface } from './types';
import st from './controls.module.css';

export interface SegmentedProps<T extends string> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  surface?: Surface;
  className?: string;
}

/** A radio group whose selected plate slides under stable labels. */
export function Segmented<T extends string>({ options, value, onChange, label, surface = 'paper', className }: SegmentedProps<T>) {
  const layoutId = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };

  return (
    <div className={`${st.seg} ${className ?? ''}`} role="radiogroup" aria-label={label} data-surface={surface === 'violet' ? 'field' : undefined}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            className={st.segBtn}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
          >
            {on ? <motion.span layoutId={layoutId} className={st.segPlate} transition={{ type: 'spring', stiffness: 520, damping: 38 }} /> : null}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
