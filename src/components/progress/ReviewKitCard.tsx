'use client';

import Link from 'next/link';
import { MaxActions } from '@/components/cup/MaxActions';
import { LockedPanel } from '@/components/kit/Shop';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import st from './progress.module.css';

/** The brief as a small object: an A4 sheet over a second one, four section heads, one line under the apricot marker. */
export function BriefArt({ className }: { className?: string }) {
  return (
    <svg className={`${st.briefArt} ${className ?? ''}`} viewBox="0 0 150 120" aria-hidden="true">
      <g className={st.briefBack}>
        <rect x="44" y="14" width="74" height="98" rx="6" />
      </g>
      <g className={st.briefFront}>
        <rect x="30" y="8" width="76" height="102" rx="6" className={st.briefSheet} />
        <rect x="38" y="17" width="34" height="5" rx="2.5" className={st.briefHead} />
        <circle cx="96" cy="19.5" r="3.2" className={st.briefKey} />
        {[31, 55, 79].map((y, i) => (
          <g key={y}>
            <rect x="38" y={y} width={i === 1 ? 30 : 24} height="3.6" rx="1.8" className={st.briefSection} />
            {i === 1 ? <rect x="37" y={y + 7.2} width="44" height="6" rx="2" className={st.briefMarker} /> : null}
            <rect x="38" y={y + 8.4} width="58" height="2.6" rx="1.3" className={st.briefText} />
            <rect x="38" y={y + 14} width={i === 2 ? 40 : 52} height="2.6" rx="1.3" className={st.briefText} />
          </g>
        ))}
        <rect x="38" y="99" width="46" height="2.6" rx="1.3" className={st.briefText} />
      </g>
    </svg>
  );
}

/** The way into Max from the Review kit's locked panel. */
export function ProActions() {
  return <MaxActions />;
}

/** Beside the proof: what the Review kit makes and the way into it, or the Max panel without Max. */
export function ReviewKitCard({ isMax, reps }: { isMax: boolean; reps: number }) {
  const { t } = useT();
  if (!isMax) {
    return <LockedPanel shape="list" title={t('progress.kit.lockedTitle')} reason={t('progress.kit.lockedReason')} action={<ProActions />} />;
  }
  return (
    <section className={st.kitCard} aria-labelledby="kit-title">
      <BriefArt />
      <h2 id="kit-title" className={st.sideTitle}>
        {t('progress.kit.title')}
      </h2>
      <p className={st.sideBody}>{t('progress.kit.body')}</p>
      {reps > 0 ? (
        <>
          <Link href="/progress/review-kit" className={`${btn.btn} ${btn.b_primary} ${st.kitAction}`}>
            {t('progress.kit.action')}
          </Link>
          <p className={st.kitBasis}>{t('progress.kit.basis', { count: reps })}</p>
        </>
      ) : (
        <span className={st.kitAction}>
          <span className={`${btn.btn} ${btn.b_primary}`} aria-disabled="true">
            {t('progress.kit.action')}
          </span>
          <span className={st.kitBasis}>{t('progress.kit.needRep')}</span>
        </span>
      )}
    </section>
  );
}
