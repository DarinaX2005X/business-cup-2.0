'use client';

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { Messages } from '@/i18n/core';
import type { Locale } from '@/i18n/config';
import { I18nProvider, useT } from '@/i18n/client';
import { KitProvider } from '@/components/kit/strings';
import { kitStringsFor } from '@/components/kit/locales';
import { sound } from '@/components/kit/sound';
import { useEffect } from 'react';
import { flyPoints } from '@/components/kit/Points';
import { Toast } from '@/components/kit/Toast';
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
  const [toast, setToast] = useState<{ text: string; key: number } | null>(null);
  const close = useCallback(() => setToast(null), []);
  const presenters = useMemo<AwardPresenters>(
    () => ({
      fly: (el, amount) => void flyPoints(el, amount),
      toast: (text) => setToast({ text, key: Date.now() }),
    }),
    [],
  );
  return (
    <KitProvider locale={locale} strings={kitStringsFor(locale)}>
      <ProfileProvider presenters={presenters}>
        <SoundSync />
        {children}
        {toast ? (
          <div
            style={{ position: 'fixed', insetInline: 16, bottom: 16, display: 'flex', justifyContent: 'center', zIndex: 60, pointerEvents: 'none' }}
          >
            <div style={{ pointerEvents: 'auto' }}>
              <Toast key={toast.key} message={toast.text} tone="success" onClose={close} duration={4000} />
            </div>
          </div>
        ) : null}
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
