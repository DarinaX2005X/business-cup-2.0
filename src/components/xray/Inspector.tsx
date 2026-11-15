'use client';

import { useState, type ReactNode } from 'react';
import { CategoryChip, CategorySwatch, EvidenceBadge } from '@/components/kit/Evidence';
import { SourceNote } from '@/components/kit/Shop';
import { Skeleton } from '@/components/kit/Skeleton';
import { useKit } from '@/components/kit/strings';
import { PRACTICE_GAIN, PRACTICE_SCALE, WEEK_HOURS } from '@/domain/constants';
import { METHOD_ANCHORS } from '@/components/public/anchors';
import { automationBasis, explainCategory, formatShare } from '@/domain/evidence';
import type { Category, OccTask, TaskEvidence, XrayBreakdown, XrayComputed } from '@/domain/types';
import { useT } from '@/i18n/client';
import type { TFunction } from '@/i18n/core';
import { freedFactor, midSentence } from './lib';
import type { ClientBundle, Focus } from './types';
import type { TipsState } from './useTaskTexts';
import st from './xray.module.css';

export function inspectorTitle(focus: Focus, t: TFunction, label: (id: string) => string): string {
  return focus.kind === 'task' ? label(focus.id) : t(`xray.metric.${focus.id}.title`);
}

/** A number in a formula: it briefly lights up when its value changes, so the cause of a change is visible. */
function Num({ children, strong }: { children: string; strong?: boolean }) {
  const [s, set] = useState({ v: children, n: 0 });
  if (s.v !== children) set({ v: children, n: s.n + 1 });
  return (
    <b key={s.n} className={st.num} data-flash={s.n > 0 || undefined} data-strong={strong || undefined}>
      {children}
    </b>
  );
}

function Eq({ label, children, note }: { label: string; children: ReactNode; note?: ReactNode }) {
  return (
    <div className={st.eq}>
      <dt>{label}</dt>
      <dd>
        <span className={st.eqLine}>{children}</span>
        {note ? <span className={st.eqNote}>{note}</span> : null}
      </dd>
    </div>
  );
}

export function Inspector({
  focus,
  result,
  breakdown,
  bundle,
  label,
  fullText,
  tips,
  isOwner,
  inSheet,
  onFocus,
}: {
  focus: Focus;
  result: XrayComputed;
  breakdown: XrayBreakdown;
  bundle: ClientBundle;
  label: (id: string) => string;
  fullText: (id: string) => string;
  tips: TipsState;
  isOwner: boolean;
  /** In the bottom sheet the sheet already shows the title. */
  inSheet?: boolean;
  onFocus: (f: Focus) => void;
}) {
  const byId = new Map(bundle.tasks.map((x) => [x.id, x]));
  if (focus.kind === 'task') {
    const task = byId.get(focus.id);
    if (!task) return null;
    return <TaskPanel inSheet={inSheet} task={task} result={result} breakdown={breakdown} bundle={bundle} label={label(task.id)} text={fullText(task.id)} tips={tips} onFocus={onFocus} />;
  }
  return <MetricPanel inSheet={inSheet} id={focus.id} result={result} breakdown={breakdown} bundle={bundle} label={label} isOwner={isOwner} onFocus={onFocus} />;
}

/* ---------------------------------------------------------------------------------------------- */

function TaskPanel({
  inSheet,
  task,
  result,
  breakdown,
  bundle,
  label,
  text,
  tips,
  onFocus,
}: {
  inSheet?: boolean;
  task: OccTask;
  result: XrayComputed;
  breakdown: XrayBreakdown;
  bundle: ClientBundle;
  label: string;
  text: string;
  tips: TipsState;
  onFocus: (f: Focus) => void;
}) {
  const { t, f } = useT();
  const { s } = useKit();
  const e = task.evidence;
  const row = breakdown.perTask.find((p) => p.taskId === task.id);
  const share = row?.share ?? 0;
  const hours = row?.hours ?? 0;
  const ex = explainCategory(e);
  const params: Record<string, string> = { ...ex.params };
  if (params.source) params.source = t(`category.source.${params.source}`);
  const weight = row?.weight ?? 0;
  const pts = row?.scorePoints ?? 0;
  const totalPts = 100 - result.baseScore;
  const n1 = (x: number) => f.number(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const inHand = result.handToAi.includes(task.id);
  const factor = freedFactor(e.category);
  const tipsReady = tips.status === 'ready' ? tips.tips[task.id] : null;
  const usage = usageFacts(e);

  // The raters: the researchers' label and GPT-4's label; when they disagree the category uses the midpoint.
  const humanLabel = e.theorySource === 'human' || e.theorySource === 'human+gpt4' ? e.theoryLabel : null;
  const gptLabel = e.gpt4Label ?? (e.theorySource === 'gpt4' ? e.theoryLabel : null);
  const disagree = e.theorySource === 'human+gpt4';

  return (
    <article className={st.insp} aria-labelledby="insp-title">
      <header className={st.iHead}>
        <div className={st.iChips}>
          <CategoryChip category={e.category} />
          <EvidenceBadge level={e.evidenceLevel} size="sm" />
        </div>
        <h3 id="insp-title" className={inSheet ? 'sr-only' : st.iTitle}>
          {label}
        </h3>
        <p className={st.iText}>{text}</p>
      </header>

      <section className={st.iSec} aria-labelledby="insp-why">
        <h4 id="insp-why" className={st.h4}>
          {t('xray.inspector.why', { category: midSentence(s.category[e.category]) })}
        </h4>
        <p className={st.iWhy}>{t(ex.key, params)}</p>
        <dl className={st.facts}>
          <Fact k={t('xray.inspector.seen')}>
            {usage.kind === 'observed'
              ? t('xray.inspector.seenYes', { share: usage.share, source: t(`category.source.${usage.source}`) })
              : usage.kind === 'rare'
                ? t('xray.inspector.seenRare')
                : t('xray.inspector.seenNo')}
          </Fact>
          {usage.kind === 'observed' && usage.auto != null ? <Fact k={t('xray.inspector.automation')}>{f.percent(usage.auto)}</Fact> : null}
          {usage.kind !== 'none' && e.aeiWorkShare != null ? <Fact k={t('xray.inspector.workUse')}>{f.percent(e.aeiWorkShare)}</Fact> : null}
          {e.theorySource === 'estimated' ? (
            <Fact k={t('xray.inspector.research')}>{t('xray.inspector.estimated', { theory: f.number(e.theory, { maximumFractionDigits: 2 }) })}</Fact>
          ) : (
            <>
              {humanLabel ? <Fact k={t('xray.inspector.researchers')}>{t(`xray.inspector.labelMeaning.${humanLabel}`)}</Fact> : null}
              {gptLabel ? <Fact k={t('xray.inspector.gpt4')}>{t(`xray.inspector.labelMeaning.${gptLabel}`)}</Fact> : null}
              {disagree ? <Fact k={t('xray.inspector.midpoint')}>{f.number(e.theory, { maximumFractionDigits: 2 })}</Fact> : null}
              {!humanLabel && !gptLabel ? <Fact k={t('xray.inspector.research')}>{t('xray.inspector.none')}</Fact> : null}
            </>
          )}
          {!e.observed && e.physical === true ? <Fact k={t('xray.inspector.kind')}>{t('xray.inspector.kindPhysical')}</Fact> : null}
          {!e.observed && e.peopleWork === true ? <Fact k={t('xray.inspector.kind')}>{t('xray.inspector.kindPeople')}</Fact> : null}
        </dl>
        <a className={st.textLink} href={`/method#${METHOD_ANCHORS.category}`}>
          {t('xray.inspector.howCategory')}
        </a>
      </section>

      <section className={st.iSec} aria-labelledby="insp-how">
        <h4 id="insp-how" className={st.h4}>
          {t('xray.inspector.how')}
        </h4>
        <dl className={st.eqs}>
          <Eq label={t('xray.inspector.eq.time')}>
            <Num>{f.number(share)}</Num>% × {WEEK_HOURS} {t('xray.unit.h')} = <Num strong>{n1(hours)}</Num> {t('xray.unit.h')}
          </Eq>
          <Eq label={t('xray.inspector.eq.weight')} note={t('xray.inspector.eq.weightNote')}>
            {s.category[e.category]} → <Num strong>{f.number(weight)}</Num>
          </Eq>
          <Eq label={t('xray.inspector.eq.points')} note={t('xray.inspector.eq.pointsNote', { total: f.number(totalPts) })}>
            <Num>{f.number(share)}</Num> × {f.number(weight)} = <Num strong>{n1(pts)}</Num>
          </Eq>
          <Eq label={t('xray.inspector.eq.score')}>
            100 − <Num>{f.number(totalPts)}</Num> = <Num strong>{f.number(result.baseScore)}</Num>
            {result.score !== result.baseScore ? (
              <>
                {' '}
                <span className={st.eqAside}>{t('xray.inspector.eq.withPractice', { score: result.score })}</span>
              </>
            ) : null}
          </Eq>
          {inHand && factor > 0 ? (
            <Eq label={t('xray.inspector.eq.freed')} note={t(e.category === 'ai_does' ? 'xray.inspector.eq.freedAll' : 'xray.inspector.eq.freedHalf')}>
              <Num>{n1(hours)}</Num> {t('xray.unit.h')} × {f.number(factor)} = <Num strong>{n1(hours * factor)}</Num> {t('xray.unit.h')}
            </Eq>
          ) : null}
        </dl>
        <div className={st.iLinks}>
          <button type="button" className={st.textBtn} onClick={() => onFocus({ kind: 'metric', id: 'score' })}>
            {t('xray.inspector.wholeScore')}
          </button>
          <a className={st.textLink} href={`/method#${METHOD_ANCHORS.score}`}>
            {t('xray.inspector.howScore')}
          </a>
        </div>
      </section>

      {tips.status === 'pending' ? (
        <section className={st.iTip} aria-busy="true">
          <p className={st.tipPending}>{t('xray.tips.pending')}</p>
          <Skeleton height={14} />
          <Skeleton width="72%" height={14} style={{ marginTop: 8 }} />
        </section>
      ) : tipsReady ? (
        <section className={st.iTip} data-kind={tipsReady.kind}>
          <h4 className={st.h4}>{tipsReady.kind === 'edge' ? t('xray.tips.edge') : t('xray.tips.hand')}</h4>
          <p>{tipsReady.tip}</p>
          {tipsReady.edgeTip ? (
            <>
              <h4 className={st.h4}>{t('xray.tips.edge')}</h4>
              <p>{tipsReady.edgeTip}</p>
            </>
          ) : null}
        </section>
      ) : null}

      <div className={st.iSource}>
        <SourceNote href={`/method#${METHOD_ANCHORS.sources}`}>
          {t('xray.inspector.source', { onet: bundle.dataVersion.onet, aei: f.date(bundle.dataVersion.aei, 'long') })}
        </SourceNote>
      </div>
    </article>
  );
}

/**
 * What the usage data says, in the same terms the category used: meaningful work use (with the source and
 * automation that decided it), work use too rare to count, or none.
 */
function usageFacts(
  e: TaskEvidence,
): { kind: 'observed'; share: string; source: 'claude_ai' | '1p_api'; auto: number | null } | { kind: 'rare' } | { kind: 'none' } {
  if (e.observed) {
    const { automation, basis } = automationBasis(e);
    const source = basis ?? e.aeiSource ?? 'claude_ai';
    const shareOf = source === '1p_api' ? (e.aeiApiShare ?? e.aeiShare) : (e.aeiClaudeShare ?? e.aeiShare);
    return { kind: 'observed', share: formatShare(shareOf ?? null), source, auto: automation ?? e.aeiAutomation };
  }
  if (e.seenRarely) return { kind: 'rare' };
  return { kind: 'none' };
}

function Fact({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className={st.fact}>
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */

function TaskLink({ id, label, category, value, onFocus }: { id: string; label: string; category: Category; value: ReactNode; onFocus: (f: Focus) => void }) {
  return (
    <li>
      <button type="button" className={st.tLink} onClick={() => onFocus({ kind: 'task', id })}>
        <CategorySwatch category={category} size="sm" />
        <span className={st.tLinkText}>{label}</span>
        <span className={st.tLinkVal}>{value}</span>
      </button>
    </li>
  );
}

function MetricPanel({
  inSheet,
  id,
  result,
  breakdown,
  bundle,
  label,
  isOwner,
  onFocus,
}: {
  inSheet?: boolean;
  id: 'score' | 'pay' | 'hours' | 'observed';
  result: XrayComputed;
  breakdown: XrayBreakdown;
  bundle: ClientBundle;
  label: (id: string) => string;
  isOwner: boolean;
  onFocus: (f: Focus) => void;
}) {
  const { t, f } = useT();
  const { s } = useKit();
  const byId = new Map(bundle.tasks.map((x) => [x.id, x]));
  const cat = (taskId: string) => byId.get(taskId)?.evidence.category ?? 'no_data';
  const n1 = (x: number) => f.number(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const n2 = (x: number) => f.number(x, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const rows = [...breakdown.perTask].sort((a, b) => b.share - a.share);

  let body: ReactNode = null;
  let big: string;
  let anchor: string = METHOD_ANCHORS.score;

  if (id === 'score') {
    const sf = breakdown.scoreFormula;
    const totalPts = 100 - sf.base;
    big = f.number(result.score);
    const top = [...breakdown.perTask].filter((p) => p.scorePoints > 0).sort((a, b) => b.scorePoints - a.scorePoints).slice(0, 5);
    body = (
      <>
        <p className={st.iExplain}>{t('xray.metric.score.plain')}</p>
        <details className={st.formula}>
          <summary>{t('xray.metric.score.howCounted')}</summary>
        <dl className={st.eqs}>
          <Eq label={t('xray.metric.score.exposure')} note={t('xray.metric.score.exposureNote')}>
            Σ {t('xray.metric.score.sum')} = <Num strong>{f.number(totalPts)}</Num>
          </Eq>
          <Eq label={t('xray.metric.score.base')}>
            100 − <Num>{f.number(totalPts)}</Num> = <Num strong>{f.number(sf.base)}</Num>
          </Eq>
          <Eq label={t('xray.metric.score.practice')} note={t('xray.metric.score.practiceNote', { n: sf.n, avg: f.percent(sf.avg) })}>
            F = (1 − e<sup>−{sf.n}/{PRACTICE_SCALE}</sup>) × <Num>{n2(sf.avg)}</Num> = <Num strong>{n2(sf.F)}</Num>
          </Eq>
          <Eq label={t('xray.metric.score.final')}>
            <Num>{f.number(sf.base)}</Num> + (100 − <Num>{f.number(sf.base)}</Num>) × {f.number(PRACTICE_GAIN)} × <Num>{n2(sf.F)}</Num> = <Num strong>{f.number(sf.score)}</Num>
          </Eq>
        </dl>
        </details>
        <h4 className={st.h4}>{t('xray.metric.score.top')}</h4>
        <ul className={st.tLinks}>
          {top.map((p) => (
            <TaskLink key={p.taskId} id={p.taskId} label={label(p.taskId)} category={cat(p.taskId)} value={n1(p.scorePoints)} onFocus={onFocus} />
          ))}
        </ul>
      </>
    );
  } else if (id === 'pay') {
    anchor = METHOD_ANCHORS.sources;
    const annual = result.salary.annual;
    big = result.payAtStake != null ? f.currency(result.payAtStake) : '—';
    // Same weights as the score and hours freed: tasks AI does count in full, tasks it speeds up at half.
    const counted = rows.filter((p) => p.scorePoints > 0).sort((a, b) => b.scorePoints - a.scorePoints);
    const pct = breakdown.pay.shareAtStake;
    const w = breakdown.pay.weights;
    body =
      annual == null ? (
        <p className={st.iExplain}>{t('xray.week.payNone')}</p>
      ) : (
        <>
          <dl className={st.eqs}>
            <Eq label={t('xray.metric.pay.formula')} note={t('xray.metric.pay.note')}>
              <Num>{f.number(result.percent.ai_does)}</Num>% × {f.number(w.ai_does)} + <Num>{f.number(result.percent.ai_speeds)}</Num>% × {f.number(w.ai_speeds)} ={' '}
              <Num strong>{f.percent(pct, 1)}</Num>
            </Eq>
            <Eq label={t('xray.metric.pay.formulaPay')}>
              <Num>{f.currency(annual)}</Num> × <Num>{f.percent(pct, 1)}</Num> = <Num strong>{f.currency(result.payAtStake ?? 0)}</Num>
            </Eq>
          </dl>
          <p className={st.iExplain}>
            {result.salary.source === 'user' ? t('xray.metric.pay.user') : isOwner ? t('xray.metric.pay.median') : t('xray.metric.pay.medianGuest')}
          </p>
          <h4 className={st.h4}>{t('xray.metric.pay.tasks')}</h4>
          {counted.length ? (
            <ul className={st.tLinks}>
              {counted.map((p) => (
                <TaskLink
                  key={p.taskId}
                  id={p.taskId}
                  label={label(p.taskId)}
                  category={cat(p.taskId)}
                  value={`${f.number(p.share)}% × ${f.number(p.weight)}`}
                  onFocus={onFocus}
                />
              ))}
            </ul>
          ) : (
            <p className={st.iExplain}>{t('xray.metric.pay.noneHigh')}</p>
          )}
        </>
      );
  } else if (id === 'hours') {
    anchor = METHOD_ANCHORS.week;
    big = `${f.number(40)} ${t('xray.unit.h')}`;
    const cats: Category[] = ['ai_does', 'ai_speeds', 'human_edge', 'no_data'];
    body = (
      <div className={st.hoursGroups}>
        {cats.map((c) => {
          const list = rows.filter((p) => cat(p.taskId) === c);
          if (!list.length) return null;
          return (
            <section key={c} className={st.hGroup}>
              <h4 className={st.hGroupHead}>
                <CategorySwatch category={c} />
                <span>{s.category[c]}</span>
                <b>
                  <Num>{n1(result.hours[c])}</Num> {t('xray.unit.h')}
                </b>
              </h4>
              <p className={st.eqNote}>
                {f.number(result.percent[c])}% × {WEEK_HOURS} {t('xray.unit.h')} = {n1(result.hours[c])} {t('xray.unit.h')}
              </p>
              <ul className={st.tLinks}>
                {list.map((p) => (
                  <TaskLink key={p.taskId} id={p.taskId} label={label(p.taskId)} category={c} value={`${n1(p.hours)} ${t('xray.unit.h')}`} onFocus={onFocus} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  } else {
    anchor = METHOD_ANCHORS.evidence;
    big = f.percent(result.observedShare);
    const seen = rows.filter((p) => byId.get(p.taskId)?.evidence.evidenceLevel === 'observed');
    body = (
      <>
        <p className={st.iExplain}>{t('xray.metric.observed.body', { release: f.date(bundle.dataVersion.aei, 'long') })}</p>
        {seen.length ? (
          <ul className={st.tLinks}>
            {seen.map((p) => (
              <TaskLink key={p.taskId} id={p.taskId} label={label(p.taskId)} category={cat(p.taskId)} value={`${f.number(p.share)}%`} onFocus={onFocus} />
            ))}
          </ul>
        ) : (
          <p className={st.iExplain}>{t('xray.metric.observed.none')}</p>
        )}
      </>
    );
  }

  return (
    <article className={st.insp} aria-labelledby="insp-title">
      <header className={st.iHead}>
        <h3 id="insp-title" className={inSheet ? 'sr-only' : st.iTitle}>
          {t(`xray.metric.${id}.title`)}
        </h3>
        <p className={st.iBig}>
          <Num strong>{big}</Num>
        </p>
        <p className={st.iExplain}>{t(`xray.metric.${id}.about`)}</p>
      </header>
      <section className={st.iSec}>{body}</section>
      <SourceNote href={`/method#${anchor}`}>{t(`xray.metric.${id}.source`, { onet: bundle.dataVersion.onet, aei: f.date(bundle.dataVersion.aei, 'long') })}</SourceNote>
    </article>
  );
}
