'use client';

import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { createFormatters, createTranslator, type Formatters, type Messages, type TFunction } from './core';
import { defaultLocale, type Locale } from './config';

interface I18nValue {
  locale: Locale;
  t: TFunction;
  f: Formatters;
  /**
   * Kept for older callers. The product is English only (ROUND3, decision 1), so this never switches:
   * nothing in the interface offers another language and no language cookie is written.
   */
  setLocale(locale: Locale): Promise<void>;
  switching: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  messages: initialMessages,
  children,
}: {
  /** Ignored: the interface always renders English. */
  locale?: Locale;
  /** From getI18nProps(): the English dictionary. */
  messages: Partial<Record<Locale, Messages>>;
  children: ReactNode;
}) {
  const setLocale = useCallback(async () => undefined, []);
  const value = useMemo<I18nValue>(() => {
    const t = createTranslator(defaultLocale, initialMessages.en ?? {}, null);
    return { locale: defaultLocale, t, f: createFormatters(defaultLocale), setLocale, switching: false };
  }, [initialMessages, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT() needs <I18nProvider> above it (root layout).');
  return ctx;
}
