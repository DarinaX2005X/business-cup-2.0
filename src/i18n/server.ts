import { cookies } from 'next/headers';
import { defaultLocale, isLocale, LOCALE_COOKIE, type Locale } from './config';
import { getMessages, getT } from './messages';

export { getT, getMessages };

/** Interface language of the current request: the `irr_lang` cookie, else English. */
export async function getRequestLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : defaultLocale;
}

/** Translator for the current request (server components, route handlers). */
export async function getRequestT() {
  return getT(await getRequestLocale());
}

/**
 * Props for <I18nProvider> in the root layout: the request locale plus its messages and English
 * (the fallback). Other locales are loaded on the client when the user switches.
 */
export async function getI18nProps() {
  const locale = await getRequestLocale();
  return {
    locale,
    messages: { en: getMessages('en'), ...(locale !== 'en' ? { [locale]: getMessages(locale) } : {}) },
  };
}
