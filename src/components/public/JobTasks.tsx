import Link from 'next/link';
import { CategoryChip, CategorySwatch, EvidenceBadge, EvidenceMeter } from '@/components/kit/Evidence';
import { explainCategory } from '@/domain/evidence';
import { observedScore } from '@/domain/evidence';
import type { OccTask } from '@/domain/types';
import type { TFunction } from '@/i18n/core';
import { shortLabel } from './text';
import st from './jobs.module.css';

export interface WeekTaskRow {
  task: OccTask;
  share: number;
}

/** Explanation sentence of a task's evidence, in the page's words (jobs.explain.*). */
export function explainText(t: TFunction, task: OccTask): string {
  const { key, params } = explainCategory(task.evidence);
  const name = key.replace('category.explain.', '');
  const source = params.source ? t(`jobs.explain.src_${params.source}`) : '';
  return t(`jobs.explain.${name}`, { ...params, source });
}

/** The typical week as rows that open to the evidence and the arithmetic behind each category. */
export function JobTasks({ rows, t, theoryWeight, fmt }: { rows: WeekTaskRow[]; t: TFunction; theoryWeight: number; fmt: (v: number, d?: number) => string }) {
  return (
    <ol className={st.tasks}>
      {rows.map(({ task, share }) => {
        const e = task.evidence;
        const hours = (share * 40) / 100;
        return (
          <li key={task.id} className={st.task} data-cat={e.category}>
            <details>
              <summary>
                <CategorySwatch category={e.category} size="lg" />
                <span className={st.taskMain}>
                  <b className={st.taskShort}>{shortLabel(task.text)}</b>
                  <span className={st.taskText}>{task.text}</span>
                  <span className={st.taskChips}>
                    <CategoryChip category={e.category} />
                    <EvidenceBadge level={e.evidenceLevel} size="sm" />
                  </span>
                </span>
                <span className={st.taskHours}>
                  <b>{fmt(hours, 1)} h</b>
                  <span>{share}%</span>
                </span>
                <span className={st.taskOpen} aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
                    <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
              </summary>
              <div className={st.taskBody}>
                <p className={st.taskWhyTitle}>{t('jobs.tasks.why')}</p>
                <p>{explainText(t, task)}</p>
                <div className={st.taskEvidence}>
                  <EvidenceMeter evidence={e} />
                  <dl className={st.taskFacts}>
                    <div>
                      <dt>{e.theoryLabel ? t('jobs.tasks.rating', { label: e.theoryLabel }) : t('jobs.tasks.noRating')}</dt>
                      <dd>{e.theorySource ? t(`jobs.tasks.ratingSource_${e.theorySource}`) : ''}</dd>
                    </div>
                    {e.physical ? (
                      <div>
                        <dt>{t('jobs.tasks.physical')}</dt>
                        <dd>Microsoft, Working with AI</dd>
                      </div>
                    ) : null}
                    {e.penetration != null ? (
                      <div>
                        <dt>{t('jobs.tasks.penetration', { value: fmt(e.penetration, 2) })}</dt>
                        <dd>Anthropic Economic Index</dd>
                      </div>
                    ) : null}
                  </dl>
                </div>
                <p className={st.taskEq}>
                  {t('jobs.tasks.exposure', {
                    tw: fmt(theoryWeight, 1),
                    theory: fmt(e.theory, 2),
                    ow: fmt(1 - theoryWeight, 1),
                    observed: fmt(observedScore(e.observed, e.aeiAutomation), 3),
                    value: fmt(e.exposure, 2),
                  })}
                </p>
                <Link href="/method#category" className={st.inlineLink}>
                  {t('jobs.tasks.methodLink')}
                </Link>
              </div>
            </details>
          </li>
        );
      })}
    </ol>
  );
}

/** Tasks outside the typical week: one quiet list. */
export function OtherTasks({ tasks, t }: { tasks: OccTask[]; t: TFunction }) {
  if (!tasks.length) return null;
  return (
    <details className={st.more}>
      <summary>
        <span>{t('jobs.tasks.more', { n: tasks.length })}</span>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" aria-hidden="true">
          <path d="M4 6l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </summary>
      <p className={st.moreNote}>{t('jobs.tasks.moreNote')}</p>
      <ul className={st.moreList}>
        {tasks.map((task) => (
          <li key={task.id}>
            <span>{task.text}</span>
            <span className={st.moreChips}>
              <CategoryChip category={task.evidence.category} />
              <EvidenceBadge level={task.evidence.evidenceLevel} size="sm" />
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}
