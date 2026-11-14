'use client';

import Link from 'next/link';
import { useDeferredValue, useMemo, useState } from 'react';
import st from './jobs.module.css';

export interface JobLink {
  slug: string;
  title: string;
  human: number; // 0..100
}

interface Labels {
  filter: string;
  placeholder: string;
  empty: string; // contains {q}
  showingOne: string; // contains {count}
  showingOther: string;
  human: string; // contains {value}
  letters: string;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** Alphabetical list of job pages with a filter. The full list is in the HTML, so it works without JS. */
export function JobsIndex({ jobs, labels }: { jobs: JobLink[]; labels: Labels }) {
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q);
  const indexed = useMemo(() => jobs.map((j) => ({ ...j, key: norm(j.title) })), [jobs]);
  const words = norm(dq).split(' ').filter(Boolean);
  const shown = words.length ? indexed.filter((j) => words.every((w) => j.key.includes(w) || j.key.includes(w.replace(/s$/, '')))) : indexed;

  const groups = useMemo(() => {
    const map = new Map<string, typeof shown>();
    for (const j of shown) {
      const letter = j.title.charAt(0).toUpperCase();
      const list = map.get(letter) ?? [];
      list.push(j);
      map.set(letter, list);
    }
    return [...map.entries()];
  }, [shown]);

  const count = shown.length;
  const status = (count === 1 ? labels.showingOne : labels.showingOther).replace('{count}', new Intl.NumberFormat('en-US').format(count));

  return (
    <div className={st.index}>
      <div className={st.filterBar}>
        <label htmlFor="jobs-filter" className={st.filterLabel}>
          {labels.filter}
        </label>
        <div className={st.filterField}>
          <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
            <circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.75" />
            <path d="M13.5 13.5L17 17" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
          </svg>
          <input
            id="jobs-filter"
            type="search"
            value={q}
            placeholder={labels.placeholder}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <p className={st.filterStatus} role="status" aria-live="polite">
          {status}
        </p>
      </div>

      {!words.length ? (
        <nav className={st.letters} aria-label={labels.letters}>
          {groups.map(([letter]) => (
            <a key={letter} href={`#letter-${letter}`}>
              {letter}
            </a>
          ))}
        </nav>
      ) : null}

      {count === 0 ? (
        <p className={st.empty}>{labels.empty.replace('{q}', q.trim())}</p>
      ) : (
        <div className={st.groups}>
          {groups.map(([letter, list]) => (
            <section key={letter} id={`letter-${letter}`} className={st.group} aria-labelledby={`h-${letter}`}>
              <h2 id={`h-${letter}`} className={st.letter}>
                {letter}
              </h2>
              <ul className={st.jobList}>
                {list.map((j) => (
                  <li key={j.slug}>
                    <Link href={`/jobs/${j.slug}`} className={st.jobLink}>
                      <span className={st.jobTitle}>{j.title}</span>
                      <span className={st.jobHuman}>
                        <span className={st.jobMeter} aria-hidden="true">
                          <span style={{ width: `${j.human}%` }} />
                        </span>
                        {labels.human.replace('{value}', String(j.human))}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
