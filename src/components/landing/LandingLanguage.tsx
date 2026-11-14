'use client';

import { LanguageSwitch } from '@/components/kit/LanguageSwitch';
import { useT } from '@/i18n/client';
import { isLocale, locales } from '@/i18n/config';
import { useOptionalProfile } from '@/lib/client/profile';

/** EN / RU / KK on the violet field or on paper; the choice is kept in the cookie and the profile. */
export function LandingLanguage({ surface, className }: { surface: 'field' | 'paper'; className?: string }) {
  const { locale, setLocale, t, switching } = useT();
  const profile = useOptionalProfile();
  return (
    <LanguageSwitch
      className={className}
      value={locale}
      locales={locales}
      label={t('common.language')}
      surface={surface === 'field' ? 'violet' : 'paper'}
      disabled={switching}
      onChange={async (next) => {
        if (!isLocale(next) || next === locale) return;
        await setLocale(next);
        if (profile?.status === 'ready' && profile.profile?.locale !== next) profile.update({ locale: next }).catch(() => undefined);
      }}
    />
  );
}
