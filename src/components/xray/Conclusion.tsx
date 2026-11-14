'use client';

import { Check, Share2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FieldArches } from '@/components/kit/Illustration';
import { ScoreDial } from '@/components/kit/ScoreDial';
import type { XrayComputed } from '@/domain/types';
import { useT } from '@/i18n/client';
import { joinLabels, machineBucket } from './lib';
import type { MetricId, XrayData } from './types';
import st from './xray.module.css';

/**
 * The conclusion: the person's job title, one sentence built from their numbers (no model), how much of
 * it rests on observed data, and the score set into the block's lower edge.
 */
export function Conclusion({
  xray,
  result,
  delta,
  isOwner,
  occupationTitle,
  label,
  onMetric,
}: {
  xray: XrayData;
  result: XrayComputed;
  delta: number;
  isOwner: boolean;
  occupationTitle: string;
  label: (id: string) => string;
  onMetric: (id: MetricId) => void;
}) {
  const { t, f, locale } = useT();
  const [shared, setShared] = useState(false);
  const machine = result.percent.ai_does + result.percent.ai_speeds;
  const human = result.humanEdge.slice(0, 2).map(label);
  const parts = joinLabels(human, locale);
  // A guest reads someone else's week: «this week» and «stays human» instead of «your week» and «yours».
  const g = isOwner ? '' : 'Guest';
  const humanSentence = human.length ? t(`xray.conclusion.human${g}`, { count: human.length, tasks: '\u0000' }) : t(`xray.conclusion.humanNone${g}`);
  const [before, after] = humanSentence.split('\u0000');

  const share = async () => {
    const url = window.location.origin + window.location.pathname;
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: t('xray.meta.title', { jobTitle: xray.jobTitle }), url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setShared(true);
      window.setTimeout(() => setShared(false), 1800);
    } catch {
      // the person closed the share sheet; nothing to report
    }
  };

  return (
    <section className={`${st.conclusion} field`} data-surface="field" aria-labelledby="xray-title">
      <FieldArches className={st.arches} />
      <div className={st.cMain}>
        <div className={st.cHead}>
          <h1 id="xray-title" className={st.jobTitle}>
            {xray.jobTitle}
          </h1>
          <p className={st.occ}>
            {t('xray.conclusion.occupation', { title: occupationTitle })}
            {isOwner ? (
              <>
                {' '}
                <Link href={`/start?step=occupation&from=${xray.id}`} className={st.onField}>
                  {t('xray.conclusion.change')}
                </Link>
              </>
            ) : null}
          </p>
        </div>
        <p className={st.sentence}>
          {t(`xray.conclusion.machine${g}.${machineBucket(machine)}`)}{' '}
          {human.length ? (
            <>
              {before}
              {parts.map((p, i) => (i % 2 === 0 ? <mark key={i} className={st.plate}>{p}</mark> : <span key={i}>{p}</span>))}
              {after}
            </>
          ) : (
            humanSentence
          )}
        </p>
        <div className={st.cFoot}>
          <button type="button" className={st.observed} onClick={() => onMetric('observed')}>
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <circle cx="8" cy="8" r="7" fill="currentColor" />
              <path d="M4.8 8.2l2.1 2.1 4.3-4.4" stroke="var(--field)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {t(`xray.conclusion.observed${g}`, { share: f.percent(result.observedShare) })}
          </button>
          <button type="button" className={st.shareBtn} onClick={share}>
            {shared ? <Check size={18} strokeWidth={2} aria-hidden="true" /> : <Share2 size={18} strokeWidth={1.75} aria-hidden="true" />}
            <span aria-live="polite">{shared ? t('xray.conclusion.shared') : t('xray.conclusion.share')}</span>
          </button>
        </div>
      </div>
      <div className={st.cScore}>
        <button type="button" className={st.dialBtn} onClick={() => onMetric('score')} aria-describedby="score-how">
          <ScoreDial value={result.score} delta={delta || undefined} surface="violet" size={300} hint={t('xray.conclusion.scoreHint')} />
        </button>
        <button type="button" id="score-how" className={st.howLink} onClick={() => onMetric('score')}>
          {t('xray.conclusion.how')}
        </button>
      </div>
    </section>
  );
}
