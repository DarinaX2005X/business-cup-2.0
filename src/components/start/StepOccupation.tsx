'use client';

import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { RotateCcw, Search } from 'lucide-react';
import { Button, Skeleton, hoursOf, weekTasksFrom } from '@/components/kit';
import { defaultShares } from '@/domain/shares';
import { useT } from '@/i18n/client';
import { useBundle } from './data';
import type { Analysis, RankedOccupation, TextOrigin } from './types';
import { WeekStrip, WeekStripSkeleton } from './WeekStrip';
import st from './start.module.css';

/** Below this the model is unsure, so nothing is chosen for the person. */
export const CONFIDENT = 0.5;

export interface StepOccupationProps {
  analysis: Analysis | null;
  pendingOrigin: TextOrigin | null;
  /** The text being read, shown back to the person while the model works. Never stored. */
  pendingText: string | null;
  failed: boolean;
  onRetry: () => void;
  selected: string | null;
  onSelect: (code: string) => void;
  onConfirm: (r: RankedOccupation) => void;
  onBack: () => void;
}

export function StepOccupation({ analysis, pendingOrigin, pendingText, failed, onRetry, selected, onSelect, onConfirm, onBack }: StepOccupationProps) {
  const { t } = useT();
  const radios = useRef<(HTMLButtonElement | null)[]>([]);

  if (!analysis) {
    const origin = pendingOrigin;
    const title = origin?.sample ? t('start.occupation.readingSample') : origin?.mode === 'description' ? t('start.occupation.readingDescription') : t('start.occupation.reading');
    return (
      <section className={st.occ} aria-labelledby="occ-title" aria-busy={!failed}>
        <div className={st.occHead}>
          <h1 id="occ-title" className={st.h2}>
            {title}
          </h1>
          {origin?.sample ? <span className={st.sampleTag}>{t('start.occupation.sampleTag')}</span> : null}
        </div>
        {failed ? (
          <div className={st.problem} role="alert">
            <p>{t('start.occupation.error')}</p>
            <div className={st.btnRow}>
              <Button variant="primary" size="sm" icon={<RotateCcw />} onClick={onRetry}>
                {t('common.actions.retry')}
              </Button>
              <Button variant="quiet" size="sm" onClick={onBack}>
                {t('start.occupation.another')}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className={st.lead}>{t('start.occupation.readingLead')}</p>
            <div className={st.cards} role="status" aria-label={title}>
              {pendingText ? <ReadingSheet text={pendingText} name={origin?.fileName ?? null} /> : <CardSkeleton big />}
              <div className={st.altCards}>
                <CardSkeleton />
                <CardSkeleton />
              </div>
            </div>
          </>
        )}
      </section>
    );
  }

  const ranked = analysis.ranked.slice(0, 3);
  const confident = analysis.confidence >= CONFIDENT;
  const current = ranked.find((r) => r.code === selected) ?? null;
  const focusIndex = Math.max(0, ranked.findIndex((r) => r.code === selected));

  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    if (d) {
      e.preventDefault();
      const n = (i + d + ranked.length) % ranked.length;
      onSelect(ranked[n].code);
      radios.current[n]?.focus();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onSelect(ranked[i].code);
      onConfirm(ranked[i]);
    }
  };

  const card = (r: RankedOccupation, i: number, size: 'big' | 'small') => (
    <OccupationCard
      key={r.code}
      ranked={r}
      size={size}
      selected={r.code === selected}
      tabIndex={i === focusIndex ? 0 : -1}
      buttonRef={(el) => {
        radios.current[i] = el;
      }}
      onSelect={() => onSelect(r.code)}
      onKeyDown={(e) => onKey(e, i)}
    />
  );

  const duties = analysis.facts.duties.length;

  return (
    <section className={st.occ} aria-labelledby="occ-title">
      <div className={st.occHead}>
        <h1 id="occ-title" className={st.h2}>
          {confident ? t('start.occupation.title') : t('start.occupation.titleLow')}
        </h1>
        {analysis.origin.sample ? <span className={st.sampleTag}>{t('start.occupation.sampleTag')}</span> : null}
      </div>
      {duties > 0 || analysis.truncated ? (
        <p className={st.meta}>
          {duties > 0 ? t('start.occupation.duties', { count: duties }) : null}
          {analysis.truncated ? ` ${t('start.occupation.truncated')}` : null}
        </p>
      ) : null}

      <div className={st.cards} role="radiogroup" aria-labelledby="occ-title" data-low={!confident || undefined}>
        {confident ? (
          <>
            {card(ranked[0], 0, 'big')}
            {ranked.length > 1 ? (
              <>
                <h2 className={st.alsoClose}>{t('start.occupation.alsoClose')}</h2>
                <div className={st.altCards}>{ranked.slice(1).map((r, k) => card(r, k + 1, 'small'))}</div>
              </>
            ) : null}
          </>
        ) : (
          ranked.map((r, i) => card(r, i, 'big'))
        )}
      </div>

      <div className={st.occFoot}>
        <Button
          size="lg"
          disabledReason={current ? undefined : t('start.occupation.pickFirst')}
          onClick={() => current && onConfirm(current)}
        >
          {t('start.occupation.confirm')}
        </Button>
        <Button variant="quiet" icon={<Search />} onClick={onBack}>
          {t('start.occupation.another')}
        </Button>
      </div>
    </section>
  );
}

function OccupationCard({
  ranked,
  size,
  selected,
  tabIndex,
  buttonRef,
  onSelect,
  onKeyDown,
}: {
  ranked: RankedOccupation;
  size: 'big' | 'small';
  selected: boolean;
  tabIndex: number;
  buttonRef: (el: HTMLButtonElement | null) => void;
  onSelect: () => void;
  onKeyDown: (e: KeyboardEvent) => void;
}) {
  const { t, f } = useT();
  const { bundle } = useBundle(ranked.code);
  const [more, setMore] = useState(false);

  // The typical week as unpainted tiles, largest task first: the product reads the job as tasks,
  // and categories wait for the scan, as in the week editor.
  const tasks = useMemo(() => (bundle ? weekTasksFrom(bundle, defaultShares(bundle)).sort((a, b) => b.share - a.share) : null), [bundle]);
  const label = useMemo(() => {
    if (!tasks?.length) return '';
    return t('start.occupation.previewNeutral', {
      title: ranked.title,
      count: tasks.length,
      hours: f.number(hoursOf(tasks[0].share), { maximumFractionDigits: 1 }),
    });
  }, [tasks, ranked.title, t, f]);

  const descId = `occ-desc-${ranked.code}`;
  return (
    <article className={st.card} data-size={size} data-selected={selected || undefined}>
      <button
        ref={buttonRef}
        type="button"
        role="radio"
        aria-checked={selected}
        aria-describedby={descId}
        tabIndex={tabIndex}
        className={st.cardHit}
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <span className="sr-only">{ranked.title}</span>
      </button>
      <span className={st.radioDot} aria-hidden="true" />
      <div className={st.cardMain}>
        <h3 className={st.cardTitle} aria-hidden="true">
          {ranked.title}
        </h3>
        <div id={descId} className={st.cardDesc}>
          {bundle ? (
            <p data-open={more || undefined}>{bundle.description}</p>
          ) : (
            <>
              <Skeleton height={14} width="92%" />
              <Skeleton height={14} width="70%" style={{ marginTop: 8 }} />
            </>
          )}
        </div>
        {bundle && bundle.description.length > (size === 'big' ? 150 : 90) ? (
          <button type="button" className={st.moreBtn} onClick={() => setMore((m) => !m)} aria-expanded={more}>
            {more ? t('start.occupation.less') : t('start.occupation.more')}
          </button>
        ) : null}
        {ranked.reason ? (
          <p className={st.reason}>
            <b>{t('start.occupation.why')}</b> {ranked.reason}
          </p>
        ) : null}
      </div>
      <div className={st.cardWeek}>{tasks ? <WeekStrip tasks={tasks} label={label} active={selected} neutral /> : <WeekStripSkeleton />}</div>
    </article>
  );
}

/** Lines that look like duties (bullets first), so the wait shows the person's own work being read. */
function dutyLines(text: string): string[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 24);
  const bullets = lines.filter((l) => /^[-•*–·▪●]/.test(l)).map((l) => l.replace(/^[-•*–·▪●]\s*/, ''));
  return (bullets.length >= 3 ? bullets : lines).slice(0, 7);
}

function ReadingSheet({ text, name }: { text: string; name: string | null }) {
  const lines = dutyLines(text);
  return (
    <div className={st.readSheet} aria-hidden="true">
      {name ? <p className={st.readName}>{name}</p> : null}
      <ul className={st.readLines}>
        {lines.map((l, i) => (
          <li key={i} style={{ '--i': i } as CSSProperties}>
            {l}
          </li>
        ))}
      </ul>
    </div>
  );
}

function CardSkeleton({ big }: { big?: boolean }) {
  return (
    <div className={st.card} data-size={big ? 'big' : 'small'} aria-hidden="true">
      <div className={st.cardMain}>
        <Skeleton height={big ? 30 : 22} width={big ? '58%' : '72%'} radius={8} />
        <Skeleton height={14} width="94%" style={{ marginTop: 16 }} />
        <Skeleton height={14} width="80%" style={{ marginTop: 8 }} />
      </div>
      <div className={st.cardWeek}>
        <WeekStripSkeleton />
      </div>
    </div>
  );
}
