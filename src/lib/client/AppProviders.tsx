'use client';

import { useMemo, type ReactNode } from 'react';
import type { Messages } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { I18nProvider, useT } from '@/i18n/client';
import { KitProvider } from '@/components/kit/strings';
import { kitStringsFor } from '@/components/kit/locales';
import { sound } from '@/components/kit/sound';
import { useEffect } from 'react';
import { flyPoints } from '@/components/kit/Points';
import { AwardToast, useAwardToast } from '@/components/shell/AwardToast';
import { ProfileProvider, useProfile, type AwardPresenters } from './profile';

/**
 * Everything the root layout wraps around the app, in the right order:
 * language → kit strings in that language → profile (which shows awards with kit's flyPoints, or a toast).
 * Server layout: `<AppProviders {...await getI18nProps()}>{children}</AppProviders>`.
 */
export function AppProviders({ locale, messages, children }: { locale: Locale; messages: Partial<Record<Locale, Messages>>; children: ReactNode }) {
  return (
    <I18nProvider locale={locale} messages={messages}>
      <WithProfile>{children}</WithProfile>
    </I18nProvider>
  );
}

function WithProfile({ children }: { children: ReactNode }) {
  const { locale } = useT();
  const awards = useAwardToast();
  const pushAwards = awards.push;
  const presenters = useMemo<AwardPresenters>(
    () => ({
      fly: (el, amount) => void flyPoints(el, amount),
      toast: (list) => pushAwards(list),
    }),
    [pushAwards],
  );
  return (
    <KitProvider locale={locale} strings={kitStringsFor(locale)}>
      <ProfileProvider presenters={presenters}>
        <SoundSync />
        {children}
        <AwardToast toast={awards.toast} onClose={awards.close} />
      </ProfileProvider>
    </KitProvider>
  );
}

function SoundSync() {
  const { profile } = useProfile();
  useEffect(() => {
    if (profile) sound.setEnabled(profile.sound);
  }, [profile]);
  return null;
}
