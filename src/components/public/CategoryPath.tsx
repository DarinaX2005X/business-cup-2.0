import { CategorySwatch } from '@/components/kit/Evidence';
import type { Category } from '@/domain/types';
import st from './method.module.css';

export interface PathOutcome {
  category: Category;
  label: string;
  /** e.g. "60% or more automated" */
  condition?: string;
  count: string;
}

export interface PathRow {
  id: string;
  question: string;
  outcomes: PathOutcome[];
  /** Real tasks that leave the path at this step. */
  examples: { id: string; label: string }[];
}

/**
 * The category rule drawn as the path a task takes: questions in the order the code asks them, the
 * category each answer leads to and how many of all tasks left at that step. A task stops at the
 * first step that fits; the line on the left is the «no» branch.
 */
export function CategoryPath({ rows, noLabel, exampleLabel }: { rows: PathRow[]; noLabel: string; exampleLabel: string }) {
  return (
    <ol className={st.path}>
      {rows.map((r, i) => (
        <li key={r.id} className={st.pathRow}>
          <span className={st.pathNode} aria-hidden="true">
            {i + 1}
          </span>
          <div className={st.pathQ}>
            <p>{r.question}</p>
            {r.examples.length ? (
              <ul className={st.pathEx} aria-label={exampleLabel}>
                {r.examples.map((e) => (
                  <li key={e.id}>{e.label}</li>
                ))}
              </ul>
            ) : null}
          </div>
          <ul className={st.pathOut}>
            {r.outcomes.map((o) => (
              <li key={o.category + (o.condition ?? '')} data-cat={o.category}>
                <CategorySwatch category={o.category} size="lg" />
                <span className={st.pathOutText}>
                  {o.condition ? <small>{o.condition}</small> : null}
                  <b>{o.label}</b>
                  <span>{o.count}</span>
                </span>
              </li>
            ))}
          </ul>
          {i < rows.length - 1 ? (
            <span className={st.pathNo} aria-hidden="true">
              {noLabel}
            </span>
          ) : null}
        </li>
      ))}
    </ol>
  );
}
