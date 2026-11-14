'use client';

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { catalogToMessages, createFormatters, createTranslator, type Formatters, type Messages, type TFunction } from './core';
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, type Locale } from './config';

const loaders: Record<Locale, () => Promise<{ default: Record<string, unknown> }>> = {
  en: () => import('./catalog/en'),
  ru: () => import('./catalog/ru'),
  kk: () => import('./catalog/kk'),
};

interface I18nValue {
  locale: Locale;
  t: TFunction;
  f: Formatters;
  /** Switches the language in place: texts, numbers and dates change, route and component state stay. */
  setLocale(locale: Locale): Promise<void>;
  switching: boolean;
}

const I18nContext = createContext<I18nValue | null>(null);

export function I18nProvider({
  locale: initialLocale,
  messages: initialMessages,
  children,
}: {
  locale: Locale;
  /** From getI18nProps(): English plus the request locale. */
  messages: Partial<Record<Locale, Messages>>;
  children: ReactNode;
}) {
  const router = useRouter();
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const [loaded, setLoaded] = useState<Partial<Record<Locale, Messages>>>(initialMessages);
  const [switching, setSwitching] = useState(false);

  const setLocale = useCallback(
    async (next: Locale) => {
      if (next === locale) return;
      setSwitching(true);
      try {
        let messages = loaded[next];
        if (!messages) {
          messages = catalogToMessages((await loaders[next]()).default);
          const add = messages;
          setLoaded((prev) => ({ ...prev, [next]: add }));
        }
        const secure = window.location.protocol === 'https:' ? '; Secure' : '';
        document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=${LOCALE_COOKIE_MAX_AGE}; SameSite=Lax${secure}`;
        document.documentElement.lang = next;
        setLocaleState(next);
        // Server components re-render with the new cookie; client state and the route are kept.
        router.refresh();
      } finally {
        setSwitching(false);
      }
    },
    [locale, loaded, router],
  );

  const value = useMemo<I18nValue>(() => {
    const own = loaded[locale] ?? loaded.en ?? {};
    const t = createTranslator(locale, own, locale === 'en' ? null : (loaded.en ?? null));
    return { locale, t, f: createFormatters(locale), setLocale, switching };
  }, [locale, loaded, setLocale, switching]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useT(): I18nValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useT() needs <I18nProvider> above it (root layout).');
  return ctx;
}
