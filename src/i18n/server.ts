import { defaultLocale, type Locale } from './config';
import { getMessages, getT } from './messages';

export { getT, getMessages };

/**
 * Interface language of the current request. The product is English only (ROUND3, decision 1): the
 * RU/KK dictionaries stay in the repo, but nothing in the interface offers them and no cookie picks them.
 */
export async function getRequestLocale(): Promise<Locale> {
  return defaultLocale;
}

/** Translator for the current request (server components, route handlers). */
export async function getRequestT() {
  return getT(await getRequestLocale());
}

/** Props for <I18nProvider> in the root layout: English only. */
export async function getI18nProps() {
  const locale = await getRequestLocale();
  return { locale, messages: { en: getMessages('en') } };
}
