'use client';

import { useOptionalProfile } from '@/lib/client/profile';
import { useT } from './client';
import { isLocale, localeNames, locales } from './config';

/**
 * Language selector with native names. Switches in place (route and screen state stay), stores the
 * choice in the `irr_lang` cookie and, when a profile exists, in the profile (used for generated content).
 * Unstyled native <select>: pass `className` to fit the surrounding kit.
 */
export function LocaleSwitcher({ className, id = 'locale-switcher' }: { className?: string; id?: string }) {
  const { locale, setLocale, switching, t } = useT();
  const profile = useOptionalProfile();

  return (
    <select
      id={id}
      className={className}
      aria-label={t('common.language')}
      value={locale}
      disabled={switching}
      onChange={async (e) => {
        const next = e.target.value;
        if (!isLocale(next)) return;
        await setLocale(next);
        if (profile?.status === 'ready' && profile.profile?.locale !== next) {
          profile.update({ locale: next }).catch(() => undefined); // the cookie already holds the choice
        }
      }}
    >
      {locales.map((l) => (
        <option key={l} value={l} lang={l}>
          {localeNames[l]}
        </option>
      ))}
    </select>
  );
}
