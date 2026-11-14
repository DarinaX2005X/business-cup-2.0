'use client';

import { Check, FileDown, Share2 } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { FieldArches } from '@/components/kit/Illustration';
import { ScoreDial } from '@/components/kit/ScoreDial';
import type { Category, XrayComputed } from '@/domain/types';
import { useT } from '@/i18n/client';
import { isForeignLabel, joinLabels, SMALL_EDGE } from './lib';
import { rich } from './rich';
import type { TFunction } from '@/i18n/core';
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
  byCategory,
  labelsReady,
  onMetric,
}: {
  xray: XrayData;
  result: XrayComputed;
  delta: number;
  isOwner: boolean;
  /** Empty while the first frame from the scan is shown (the title arrives with the page). */
  occupationTitle: string;
  label: (id: string) => string;
  /** Category of a task of this week. */
  byCategory: (id: string) => Category | undefined;
  /** Labels are the generated short names in this language (not the first words of the O*NET sentence). */
  labelsReady: boolean;
  onMetric: (id: MetricId) => void;
}) {
  const { t, f, locale } = useT();
  const [shared, setShared] = useState(false);
  // A guest reads someone else's week: «this week» and «stays human» instead of «your week» and «yours».
  const g = isOwner ? '' : 'Guest';
  const lead = leadSentence(t, f.percent, result, g);
  const edgePct = result.percent.human_edge;
  const human = edgePct > 0 ? result.humanEdge.filter((id) => byCategory(id) === 'human_edge').slice(0, 2).map(label) : [];
  // Untranslated labels never go inside a Russian or Kazakh sentence: they get their own line instead.
  const foreign = human.some((l) => isForeignLabel(l, locale));
  const parts = joinLabels(human, locale);
  // Until the short labels exist, the sentence counts the tasks instead of quoting raw fragments of them.
  const plates = parts.map((p, i) => (i % 2 === 0 ? <mark key={i} className={st.plate}>{p}</mark> : <span key={i}>{p}</span>));
  const humanSentence = human.length && !foreign && labelsReady ? rich(t, `xray.conclusion.human${g}`, { tasks: plates }, { count: human.length }) : null;
  const edgeKey = edgePct === 0 ? `xray.conclusion.edgeNone${g}` : edgePct < SMALL_EDGE ? `xray.conclusion.edgeSmall${g}` : null;

  const share = async () => {
    const url = window.location.origin + window.location.pathname;
    try {
      if (navigator.share && window.matchMedia('(pointer: coarse)').matches) {
        await navigator.share({ title: `${xray.jobTitle}: ${t(`xray.conclusion.title${g}`)}`, url });
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
            <span className={st.mapLabel}>{t(`xray.conclusion.title${g}`)}</span>{' '}
            {occupationTitle ? t('xray.conclusion.occupation', { title: occupationTitle }) : <span className={st.skOnField} style={{ display: 'inline-block', width: 220, height: 14 }} />}
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
          {lead}
          {humanSentence ? (
            <>
              {' '}
              {humanSentence}
            </>
          ) : human.length && !labelsReady ? (
            <> {t(`xray.conclusion.humanCount${g}`, { count: human.length })}</>
          ) : human.length ? (
            <> {t(`xray.conclusion.humanList${g}`)}</>
          ) : null}
          {edgeKey ? <> {t(edgeKey)}</> : null}
        </p>
        {foreign && labelsReady && human.length ? (
          <ul className={st.plates} lang="en">
            {human.map((l) => (
              <li key={l}>
                <mark className={st.plate}>{l}</mark>
              </li>
            ))}
          </ul>
        ) : null}
        <div className={st.cFoot}>
          <button type="button" className={st.observed} onClick={() => onMetric('observed')}>
            {result.observedShare > 0 ? (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="7" fill="currentColor" />
                <path d="M4.8 8.2l2.1 2.1 4.3-4.4" stroke="var(--field)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="8" cy="8" r="6.6" stroke="currentColor" strokeWidth="1.6" fill="none" />
                <path d="M8 7.2v4M8 4.6v.1" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            )}
            {result.observedShare > 0
              ? t(`xray.conclusion.observed${g}`, { share: f.percent(result.observedShare) })
              : t(`xray.conclusion.observedNone${g}`)}
          </button>
          <Link href={`/x/${xray.id}/report?print=1`} className={st.shareBtn} prefetch={false}>
            <FileDown size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>{t('xray.report.download')}</span>
          </Link>
          <button type="button" className={st.shareBtn} onClick={share}>
            {shared ? <Check size={18} strokeWidth={2} aria-hidden="true" /> : <Share2 size={18} strokeWidth={1.75} aria-hidden="true" />}
            <span aria-live="polite">{shared ? t('xray.conclusion.shared') : t(`xray.conclusion.share${g}`)}</span>
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

/**
 * The first sentence: the share of the week AI reaches, said as the number itself (the same number the
 * week bar shows), naming only what is true: «speeds up» when AI does none of it on its own.
 */
function leadSentence(t: TFunction, percent: (x: number) => string, result: XrayComputed, g: string): string {
  const does = result.percent.ai_does;
  const speeds = result.percent.ai_speeds;
  const machine = does + speeds;
  if (machine === 0) return t(`xray.conclusion.leadNone${g}`);
  const what = t(`xray.conclusion.what.${does === 0 ? 'speeds' : speeds === 0 ? 'does' : 'both'}`);
  return t(`xray.conclusion.leadShare${g}`, { share: percent(machine / 100), what });
}
