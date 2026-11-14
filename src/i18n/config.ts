import type { Locale } from '@/domain/types';

export type { Locale };
export const locales = ['en', 'ru', 'kk'] as const satisfies readonly Locale[];
export const defaultLocale: Locale = 'en';

/** Native names for the language selector. */
export const localeNames: Record<Locale, string> = { en: 'English', ru: 'Русский', kk: 'Қазақша' };

/** BCP 47 tags for Intl (plural rules, numbers, dates). */
export const intlLocale: Record<Locale, string> = { en: 'en-US', ru: 'ru-RU', kk: 'kk-KZ' };

/** Cookie with the interface language; read on the server for SSR, written by the client switcher. */
export const LOCALE_COOKIE = 'irr_lang';
export const LOCALE_COOKIE_MAX_AGE = 400 * 24 * 3600;

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (locales as readonly string[]).includes(value);
}
