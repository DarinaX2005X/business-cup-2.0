'use client';

import { Segmented } from './Segmented';
import type { Locale, Surface } from './types';
import st from './controls.module.css';

const SHORT: Record<Locale, string> = { en: 'EN', ru: 'RU', kk: 'KK' };

export interface LanguageSwitchProps {
  value: Locale;
  onChange: (locale: Locale) => void;
  locales: readonly Locale[];
  /** Accessible name of the group, in the current language («Language»). */
  label: string;
  surface?: Surface;
  disabled?: boolean;
  className?: string;
}

/**
 * The language control: a compact segmented group (EN, RU, KK) instead of a native select, so the
 * choice is one tap, visible at a glance and styled like every other control. Screens own what a
 * switch does (cookie, profile); this only draws and reports it.
 */
export function LanguageSwitch({ value, onChange, locales, label, surface = 'paper', disabled, className }: LanguageSwitchProps) {
  return (
    <div className={`${st.langSwitch} ${className ?? ''}`} data-disabled={disabled || undefined}>
      <Segmented
        label={label}
        value={value}
        surface={surface}
        options={locales.map((l) => ({ value: l, label: SHORT[l] }))}
        onChange={(l) => {
          if (!disabled) onChange(l);
        }}
      />
    </div>
  );
}
