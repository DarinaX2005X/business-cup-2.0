'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { KeystoneMark, Segmented } from '@/components/kit';
import { useT } from '@/i18n/client';
import { locales, type Locale } from '@/i18n/config';
import { useOptionalProfile } from '@/lib/client/profile';
import { STEPS, type Step } from './types';
import st from './start.module.css';

const SHORT: Record<Locale, string> = { en: 'EN', ru: 'RU', kk: 'KK' };

/**
 * The trimmed header of the flow: mark, the four steps drawn as small week tiles, language and Exit.
 * Nothing else competes with the one question on the screen.
 */
export function FlowHeader({ step }: { step: Step }) {
  const { t, locale, setLocale } = useT();
  const profile = useOptionalProfile();
  const at = STEPS.indexOf(step);

  return (
    <header className={st.header}>
      <div className={st.headerIn}>
        <Link href="/" className={st.homeLink} aria-label={t('start.header.home')}>
          <KeystoneMark size={32} />
          <span className={st.wordmark}>Irreplaceable</span>
        </Link>

        <ol className={st.progress} aria-label={t('start.header.progress', { n: at + 1 })}>
          {STEPS.map((s, i) => (
            <li key={s} data-state={i < at ? 'done' : i === at ? 'now' : 'next'} aria-current={i === at ? 'step' : undefined} />
          ))}
        </ol>

        <div className={st.headerEnd}>
          <Segmented
            label={t('common.language')}
            value={locale}
            className={st.lang}
            options={locales.map((l) => ({ value: l, label: SHORT[l] }))}
            onChange={async (next) => {
              await setLocale(next);
              if (profile?.status === 'ready' && profile.profile?.locale !== next) profile.update({ locale: next }).catch(() => undefined);
            }}
          />
          <Link href="/" className={st.exit}>
            <X size={18} strokeWidth={2} aria-hidden="true" />
            <span>{t('start.header.exit')}</span>
          </Link>
        </div>
      </div>
    </header>
  );
}
