'use client';

import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from 'react';
import type { Surface } from './types';
import st from './controls.module.css';

export interface FieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label: string;
  /** Hide the label visually but keep it for assistive tech. */
  labelHidden?: boolean;
  help?: string;
  error?: string;
  surface?: Surface;
  size?: 'md' | 'lg';
  /** A control that sits inside the field row, after the input (for example the main button). */
  trailing?: ReactNode;
}

export const Field = forwardRef<HTMLInputElement, FieldProps>(function Field(
  { label, labelHidden, help, error, surface = 'paper', size = 'md', trailing, id, className, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  const helpId = `${inputId}-help`;
  const errId = `${inputId}-err`;
  return (
    <div className={`${st.field} ${className ?? ''}`} data-surface={surface === 'violet' ? 'field' : undefined}>
      <label htmlFor={inputId} className={labelHidden ? 'sr-only' : st.fLabel}>
        {label}
      </label>
      <div className={st.fRow}>
        <input
          ref={ref}
          id={inputId}
          className={`${st.input} ${size === 'lg' ? st.inputLg : ''}`}
          aria-invalid={error ? true : undefined}
          aria-describedby={[help ? helpId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined}
          {...rest}
        />
        {trailing}
      </div>
      {error ? (
        <p id={errId} className={st.fError}>
          {error}
        </p>
      ) : help ? (
        <p id={helpId} className={st.fHelp}>
          {help}
        </p>
      ) : null}
    </div>
  );
});
