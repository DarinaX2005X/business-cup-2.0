'use client';

import Link from 'next/link';
import { SheetStack } from '@/components/kit/Illustration';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import st from './xray.module.css';

/**
 * The one strong action under the conclusion: a document from the person's own top task, drafted by AI,
 * with a mistake in it. A guest gets the way to their own map instead.
 */
export function ActionCard({
  isOwner,
  isPro,
  trialAvailable,
  taskLabel,
  href,
}: {
  isOwner: boolean;
  isPro: boolean;
  trialAvailable: boolean;
  taskLabel: string | null;
  href: string;
}) {
  const { t } = useT();
  if (!isOwner) {
    return (
      <section className={st.action} aria-labelledby="action-title">
        <div className={st.aText}>
          <h2 id="action-title" className={st.aTitle}>
            {t('xray.action.guestTitle')}
          </h2>
          <p className={st.aBody}>{t('xray.action.guestBody')}</p>
          <Link href="/start" className={`${btn.btn} ${btn.b_primary} ${btn.s_lg}`}>
            {t('xray.action.mapOwn')}
          </Link>
        </div>
        <div className={st.aArt} aria-hidden="true">
          <SheetStack className={st.aSvg} />
        </div>
      </section>
    );
  }
  const label = isPro ? t('xray.action.startPro') : trialAvailable ? t('xray.action.start') : t('xray.action.startAfterTrial');
  return (
    <section className={st.action} aria-labelledby="action-title">
      <div className={st.aText}>
        <h2 id="action-title" className={st.aTitle}>
          {taskLabel ? (
            <>
              {t('xray.action.titleBefore')}
              <span className={st.aTask}>{taskLabel}</span>
              {t('xray.action.titleAfter')}
            </>
          ) : (
            t('xray.action.titleGeneric')
          )}
        </h2>
        <p className={st.aBody}>{t('xray.action.body')}</p>
        <Link href={isPro ? '/today' : href} className={`${btn.btn} ${btn.b_primary} ${btn.s_lg}`}>
          {label}
        </Link>
      </div>
      <div className={st.aArt}>
        <SheetStack className={st.aSvg} title={t('xray.action.art')} />
      </div>
    </section>
  );
}
