'use client';

import { useState, type ReactNode } from 'react';
import { CategoryChip, CategorySwatch, EvidenceBadge, EvidenceMeter } from '@/components/kit/Evidence';
import { SourceNote } from '@/components/kit/Shop';
import { Skeleton } from '@/components/kit/Skeleton';
import { useKit } from '@/components/kit/strings';
import { HIGH_EXPOSURE, PRACTICE_GAIN, PRACTICE_SCALE, THEORY_WEIGHT, WEEK_HOURS } from '@/domain/constants';
import { explainCategory, observedScore } from '@/domain/evidence';
import type { Category, OccTask, XrayBreakdown, XrayComputed } from '@/domain/types';
import { useT } from '@/i18n/client';
import type { TFunction } from '@/i18n/core';
import { freedFactor } from './lib';
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
  const e = task.evidence;
  const row = breakdown.perTask.find((p) => p.taskId === task.id);
  const share = row?.share ?? 0;
  const hours = row?.hours ?? 0;
  const ex = explainCategory(e);
  const params: Record<string, string> = { ...ex.params };
  if (params.source) params.source = t(`category.source.${params.source}`);
  const obs = observedScore(e.observed, e.aeiAutomation);
  const pts = share * e.exposure;
  const totalPts = result.weekExposure * 100;
  const n2 = (x: number) => f.number(x, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const n1 = (x: number) => f.number(x, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const inHand = result.handToAi.includes(task.id);
  const factor = freedFactor(e.category);
  const tipsReady = tips.status === 'ready' ? tips.tips[task.id] : null;

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
        <p className={st.iExplain}>{t(ex.key, params)}</p>
      </header>

      <section className={st.iSec} aria-labelledby="insp-how">
        <h4 id="insp-how" className={st.h4}>
          {t('xray.inspector.how')}
        </h4>
        <dl className={st.eqs}>
          <Eq label={t('xray.inspector.eq.time')}>
            <Num>{f.number(share)}</Num>% × {WEEK_HOURS} {t('xray.unit.h')} = <Num strong>{n1(hours)}</Num> {t('xray.unit.h')}
          </Eq>
          <Eq
            label={t('xray.inspector.eq.exposure')}
            note={t('xray.inspector.eq.exposureNote', { w: THEORY_WEIGHT })}
          >
            {f.number(THEORY_WEIGHT)} × <Num>{n2(e.theory)}</Num> + {f.number(1 - THEORY_WEIGHT)} × <Num>{n2(obs)}</Num> = <Num strong>{n2(e.exposure)}</Num>
          </Eq>
          <Eq label={t('xray.inspector.eq.points')} note={t('xray.inspector.eq.pointsNote', { total: n1(totalPts) })}>
            <Num>{f.number(share)}</Num> × <Num>{n2(e.exposure)}</Num> = <Num strong>{n1(pts)}</Num>
          </Eq>
          <Eq label={t('xray.inspector.eq.score')}>
            100 − <Num>{n1(totalPts)}</Num> = <Num strong>{f.number(result.baseScore)}</Num>
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
        <button type="button" className={st.textBtn} onClick={() => onFocus({ kind: 'metric', id: 'score' })}>
          {t('xray.inspector.wholeScore')}
        </button>
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

      <section className={st.iSec} aria-labelledby="insp-data">
        <h4 id="insp-data" className={st.h4}>
          {t('xray.inspector.data')}
        </h4>
        <EvidenceMeter evidence={e} />
        <dl className={st.facts}>
          <Fact k={t('xray.inspector.research')}>
            {e.theorySource === 'human+gpt4' && e.gpt4Label
              ? t('xray.inspector.mixed', { human: e.theoryLabel ?? '', gpt4: e.gpt4Label })
              : e.theoryLabel
                ? `${e.theoryLabel}, ${t(`xray.inspector.researchSource.${e.theorySource ?? 'human'}`)}`
                : e.theorySource === 'estimated'
                  ? t('xray.inspector.researchSource.estimated')
                  : t('xray.inspector.none')}
          </Fact>
          <Fact k={t('xray.inspector.seen')}>
            {e.observed ? t('xray.inspector.seenNow', { release: f.date(bundle.dataVersion.aei, 'long') }) : e.everObserved ? t('xray.inspector.seenEarlier') : t('xray.inspector.notSeen')}
          </Fact>
          {e.aeiWorkShare != null ? <Fact k={t('xray.inspector.workUse')}>{f.percent(e.aeiWorkShare)}</Fact> : null}
          {e.penetration != null ? <Fact k={t('xray.inspector.penetration')}>{f.percent(e.penetration, 1)}</Fact> : null}
          <Fact k={t('xray.inspector.physical')}>{e.physical === true ? t('xray.inspector.yes') : e.physical === false ? t('xray.inspector.no') : t('xray.inspector.none')}</Fact>
        </dl>
        <SourceNote href={`/method#${e.observed ? 'observed' : 'estimates'}`}>
          {t('xray.inspector.source', { onet: bundle.dataVersion.onet, aei: f.date(bundle.dataVersion.aei, 'long') })}
        </SourceNote>
      </section>
    </article>
  );
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
  let anchor = 'score';

  if (id === 'score') {
    const sf = breakdown.scoreFormula;
    const totalPts = result.weekExposure * 100;
    big = f.number(result.score);
    const top = [...breakdown.perTask].sort((a, b) => b.contribution - a.contribution).slice(0, 5);
    body = (
      <>
        <dl className={st.eqs}>
          <Eq label={t('xray.metric.score.exposure')} note={t('xray.metric.score.exposureNote')}>
            Σ {t('xray.metric.score.sum')} = <Num strong>{n1(totalPts)}</Num>
          </Eq>
          <Eq label={t('xray.metric.score.base')}>
            100 − <Num>{n1(totalPts)}</Num> = <Num strong>{f.number(sf.base)}</Num>
          </Eq>
          <Eq label={t('xray.metric.score.practice')} note={t('xray.metric.score.practiceNote', { n: sf.n, avg: f.percent(sf.avg) })}>
            F = (1 − e<sup>−{sf.n}/{PRACTICE_SCALE}</sup>) × <Num>{n2(sf.avg)}</Num> = <Num strong>{n2(sf.F)}</Num>
          </Eq>
          <Eq label={t('xray.metric.score.final')}>
            <Num>{f.number(sf.base)}</Num> + (100 − <Num>{f.number(sf.base)}</Num>) × {f.number(PRACTICE_GAIN)} × <Num>{n2(sf.F)}</Num> = <Num strong>{f.number(sf.score)}</Num>
          </Eq>
        </dl>
        <h4 className={st.h4}>{t('xray.metric.score.top')}</h4>
        <ul className={st.tLinks}>
          {top.map((p) => (
            <TaskLink key={p.taskId} id={p.taskId} label={label(p.taskId)} category={cat(p.taskId)} value={n1(p.contribution * 100)} onFocus={onFocus} />
          ))}
        </ul>
      </>
    );
  } else if (id === 'pay') {
    anchor = 'pay';
    const annual = result.salary.annual;
    big = result.payAtStake != null ? f.currency(result.payAtStake) : '—';
    const high = rows.filter((p) => p.exposure >= HIGH_EXPOSURE);
    const pct = breakdown.pay.shareHighExposure;
    body =
      annual == null ? (
        <p className={st.iExplain}>{t('xray.week.payNone')}</p>
      ) : (
        <>
          <dl className={st.eqs}>
            <Eq label={t('xray.metric.pay.formula')} note={t('xray.metric.pay.note', { threshold: HIGH_EXPOSURE })}>
              <Num>{f.currency(annual)}</Num> × <Num>{f.percent(pct)}</Num> = <Num strong>{f.currency(result.payAtStake ?? 0)}</Num>
            </Eq>
          </dl>
          <p className={st.iExplain}>
            {result.salary.source === 'user' ? t('xray.metric.pay.user') : isOwner ? t('xray.metric.pay.median') : t('xray.metric.pay.medianGuest')}
          </p>
          <h4 className={st.h4}>{t('xray.metric.pay.tasks')}</h4>
          {high.length ? (
            <ul className={st.tLinks}>
              {high.map((p) => (
                <TaskLink key={p.taskId} id={p.taskId} label={label(p.taskId)} category={cat(p.taskId)} value={`${f.number(p.share)}%`} onFocus={onFocus} />
              ))}
            </ul>
          ) : (
            <p className={st.iExplain}>{t('xray.metric.pay.noneHigh')}</p>
          )}
        </>
      );
  } else if (id === 'hours') {
    anchor = 'categories';
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
    anchor = 'observed';
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
