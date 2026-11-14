'use client';

import { Segmented } from '@/components/kit/Segmented';
import { useOptionalProfile } from '@/lib/client/profile';
import { useT } from '@/i18n/client';
import { isLocale, locales, type Locale } from '@/i18n/config';

const short: Record<Locale, string> = { en: 'EN', ru: 'RU', kk: 'KK' };

/** EN / RU / KK in the kit's segmented control (no native select), same as the /start header. */
export function LanguageSwitch({ className }: { className?: string }) {
  const { locale, setLocale, t } = useT();
  const profile = useOptionalProfile();
  return (
    <Segmented
      className={className}
      label={t('common.language')}
      value={locale}
      options={locales.map((l) => ({ value: l, label: short[l] }))}
      onChange={async (next) => {
        if (!isLocale(next) || next === locale) return;
        await setLocale(next);
        if (profile?.status === 'ready' && profile.profile?.locale !== next) profile.update({ locale: next }).catch(() => undefined);
      }}
    />
  );
}
