'use client';

import type { CSSProperties } from 'react';
import { numberLocale, useKit } from './strings';
import type { Category, EvidenceLevel, Surface, TaskEvidence } from './types';
import st from './evidence.module.css';

/* ---------- category swatch and chip: pattern and word, never colour alone ---------- */

const swatchClass: Record<Category, string> = { ai_does: st.swAi, ai_speeds: st.swSp, human_edge: st.swHu, no_data: st.swNd };

export function CategorySwatch({ category, size = 'md' }: { category: Category; size?: 'sm' | 'md' | 'lg' }) {
  return <span className={`${st.sw} ${swatchClass[category]}`} data-size={size} aria-hidden="true" />;
}

export function CategoryChip({ category, surface = 'paper' }: { category: Category; surface?: Surface }) {
  const { s } = useKit();
  return (
    <span className={st.chip} data-surface={surface} data-cat={category}>
      <CategorySwatch category={category} size="sm" />
      {s.category[category]}
    </span>
  );
}

/* ---------- evidence badge ---------- */

export function EvidenceBadge({ level, surface = 'paper', size = 'md' }: { level: EvidenceLevel; surface?: Surface; size?: 'sm' | 'md' }) {
  const { s } = useKit();
  const text = level === 'observed' ? s.observed : level === 'estimate' ? s.estimate : s.noEvidence;
  return (
    <span className={st.badge} data-level={level} data-surface={surface} data-size={size}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {level === 'observed' ? (
          <>
            <circle cx="8" cy="8" r="7" fill="currentColor" />
            <path d="M4.8 8.2l2.1 2.1 4.3-4.4" stroke="var(--badge-tick)" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </>
        ) : level === 'estimate' ? (
          <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.6" fill="none" />
        ) : (
          <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.6" strokeDasharray="1.6 2.4" fill="none" strokeLinecap="round" />
        )}
      </svg>
      {text}
    </span>
  );
}

/* ---------- evidence meter ---------- */

/**
 * The busiest task in the Anthropic Economic Index release of 26 June 2026 takes 4.95 % of
 * work conversations (measured over public/data/occ at build time). The meter is linear
 * against it, so a bar is as long as the share really is compared with the busiest task.
 */
export const AEI_RELEASE_MAX_SHARE = 0.0495;

export function formatShare(v: number, locale: string) {
  const f = (x: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumSignificantDigits: 2 }).format(x);
  return v > 0 && v < 1e-5 ? `< ${f(1e-5)}` : v === 0 ? `< ${f(1e-5)}` : f(v);
}

type MeterEvidence = Pick<TaskEvidence, 'observed' | 'aeiShare' | 'aeiAutomation' | 'theoryLabel' | 'evidenceLevel'>;

export interface EvidenceMeterProps {
  evidence: MeterEvidence;
  surface?: Surface;
  compact?: boolean;
  /** Top of the linear scale; defaults to the busiest task of the release. */
  scaleMax?: number;
}

/**
 * How often a task shows up in real AI work conversations (log scale, because shares run
 * from thousandths of a percent to about one percent), and how those conversations split
 * between AI doing the task and doing it together. Without observations it says so plainly.
 */
export function EvidenceMeter({ evidence, surface = 'paper', compact, scaleMax = AEI_RELEASE_MAX_SHARE }: EvidenceMeterProps) {
  const { s, locale } = useKit();
  const loc = numberLocale[locale];

  if (!evidence.observed || evidence.aeiShare == null) {
    const label = evidence.theoryLabel ? s.research[evidence.theoryLabel] : s.research.none;
    const step = evidence.theoryLabel === 'E2' ? 2 : evidence.theoryLabel === 'E1' ? 1 : evidence.theoryLabel === 'E0' ? 0 : -1;
    return (
      <div className={st.meter} data-surface={surface} data-compact={compact || undefined}>
        <div className={st.mNoneRow}>
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="8" cy="8" r="6.2" stroke="currentColor" strokeWidth="1.6" strokeDasharray="1.6 2.4" fill="none" strokeLinecap="round" />
          </svg>
          <span className={st.mNone}>{s.notSeen}</span>
        </div>
        {!compact ? <div className={st.sTrack} data-empty="" aria-hidden="true" /> : null}
        <div className={st.research}>
          <span className={st.steps} aria-hidden="true">
            {[0, 1, 2].map((i) => (
              <i key={i} data-on={i <= step || undefined} />
            ))}
          </span>
          <span>{label}</span>
        </div>
      </div>
    );
  }

  const share = evidence.aeiShare;
  const pos = Math.min(1, Math.max(0, share / scaleMax));
  const auto = evidence.aeiAutomation ?? 0;
  const pct = (x: number) => new Intl.NumberFormat(loc, { style: 'percent', maximumFractionDigits: 1 }).format(x);
  const ticks = [0, scaleMax / 2, scaleMax];

  return (
    <div className={st.meter} data-surface={surface} data-compact={compact || undefined}>
      <div className={st.mHead}>
        <span className={st.mVal}>{formatShare(share, loc)}</span>
        <span className={st.mKey}>{s.conversations}</span>
      </div>
      <div className={st.scale} role="img" aria-label={`${s.conversations}: ${formatShare(share, loc)}`} style={{ '--pos': pos } as CSSProperties}>
        <div className={st.sTrack}>
          <div className={st.sFill} />
          <div className={st.sPin} />
        </div>
        <div className={st.sTicks} aria-hidden="true">
          {ticks.map((v, i) => (
            <span key={i} style={{ left: `${(v / scaleMax) * 100}%` }}>
              {pct(v)}
            </span>
          ))}
        </div>
        <p className={st.sNote}>{s.scaleOf(pct(scaleMax))}</p>
      </div>
      <div className={st.split} role="img" aria-label={`${s.automation} ${formatShare(auto, loc)}, ${s.together} ${formatShare(1 - auto, loc)}`}>
        <div className={st.splitBar}>
          <span className={st.spAuto} style={{ flexGrow: Math.max(auto, 0.02) }} />
          <span className={st.spTog} style={{ flexGrow: Math.max(1 - auto, 0.02) }} />
        </div>
        <div className={st.splitKeys} aria-hidden="true">
          <span>
            <b>{formatShare(auto, loc)}</b> {s.automation}
          </span>
          <span>
            <b>{formatShare(1 - auto, loc)}</b> {s.together}
          </span>
        </div>
      </div>
    </div>
  );
}
