'use client';

import { forwardRef, useId, type ButtonHTMLAttributes, type ReactNode } from 'react';
import st from './controls.module.css';

export type ButtonVariant =
  /** violet on lavender paper: the main action of a product screen */
  | 'primary'
  /** quiet violet-on-lavender plate on paper */
  | 'secondary'
  /** text button */
  | 'quiet'
  /** destructive, names the object it removes */
  | 'destructive'
  /** light lavender with a bold violet label: the main action on the violet field */
  | 'lavender'
  /** apricot: the «you» action on the violet field (start a rep, redeem) */
  | 'apricot'
  /** outline on the violet field */
  | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  /** Shows a spinner and replaces the label with the action in progress. Blocks repeat presses. */
  loading?: boolean;
  loadingLabel?: string;
  /** Why the action is unavailable. Rendered under the button and linked to it. */
  disabledReason?: string;
  icon?: ReactNode;
  block?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, loadingLabel, disabledReason, icon, block, className, children, disabled, onClick, type = 'button', ...rest },
  ref,
) {
  const reasonId = useId();
  const unavailable = disabled || !!disabledReason;
  const btn = (
    <button
      ref={ref}
      type={type}
      className={`${st.btn} ${st[`b_${variant}`]} ${st[`s_${size}`]} ${block ? st.block : ''} ${className ?? ''}`}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      aria-disabled={unavailable || loading || undefined}
      aria-describedby={disabledReason ? reasonId : undefined}
      onClick={(e) => {
        if (unavailable || loading) {
          e.preventDefault();
          return;
        }
        onClick?.(e);
      }}
      {...rest}
    >
      {loading ? <span className={st.spin} aria-hidden="true" /> : icon ? <span className={st.bIcon} aria-hidden="true">{icon}</span> : null}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
  if (!disabledReason) return btn;
  return (
    <span className={`${st.bWrap} ${block ? st.block : ''}`}>
      {btn}
      <span id={reasonId} className={st.reason}>
        {disabledReason}
      </span>
    </span>
  );
});
