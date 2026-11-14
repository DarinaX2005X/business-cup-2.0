'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import type { ProofView } from '@/server/progress/types';
import { dayDate, say, setProofPublic } from './api';
import { TypeGlyph } from './TypeGlyph';
import st from './progress.module.css';

const FIRST = 8;

/**
 * The proof log: every finished rep as a dated line on one sheet, grouped by day, newest first. A line
 * names the task (a link to its review), the kind of rep and what happened, the score, and a Public
 * switch that puts it on the person's proof page.
 */
export function ProofLog({ entries, today, onChange }: { entries: ProofView[]; today: string; onChange: (id: string, value: boolean, slug: string | null) => void }) {
  const { t, f } = useT();
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, FIRST);
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const dayTitle = (day: string) => (day === today ? t('progress.list.today') : day === yesterday ? t('progress.list.yesterday') : dayDate(f, day));
  const groups: { day: string; items: ProofView[] }[] = [];
  for (const e of shown) {
    const last = groups.at(-1);
    if (last && last.day === e.day) last.items.push(e);
    else groups.push({ day: e.day, items: [e] });
  }

  return (
    <div className={st.log}>
      {groups.map((g) => (
        <section key={g.day} className={st.logDay} aria-label={dayTitle(g.day)}>
          <h3 className={st.logDate}>{dayTitle(g.day)}</h3>
          <ul className={st.logList}>
            {g.items.map((e) => (
              <ProofRow key={e.id} entry={e} onChange={onChange} />
            ))}
          </ul>
        </section>
      ))}
      {entries.length > FIRST ? (
        <button type="button" className={st.textBtn} onClick={() => setAll((v) => !v)} aria-expanded={all}>
          {all ? t('progress.list.showLess') : t('progress.list.showAll', { count: entries.length })}
        </button>
      ) : null}
    </div>
  );
}

function ProofRow({ entry: e, onChange }: { entry: ProofView; onChange: (id: string, value: boolean, slug: string | null) => void }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toggle = async () => {
    if (busy) return;
    const next = !e.public;
    setBusy(true);
    setError(null);
    onChange(e.id, next, null); // show it at once, put it back if the server says no
    try {
      const r = await setProofPublic(e.id, next);
      onChange(e.id, r.entry.public, r.publicSlug);
    } catch (err) {
      onChange(e.id, !next, null);
      setError(err instanceof ApiError && err.code === 'network' ? t('common.errors.network') : t('progress.list.saveError'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className={st.logRow} data-public={e.public || undefined}>
      <TypeGlyph type={e.type} />
      <div className={st.logMain}>
        <Link href={`/today?rep=${encodeURIComponent(e.repId)}`} className={st.logTask} title={t('progress.list.open')}>
          {e.taskShort || t(`progress.type.${e.type}`)}
        </Link>
        <p className={st.logWhat}>
          <b>{t(`progress.type.${e.type}`)}</b> {say(t, e.summary)}
        </p>
        {e.workMinutes > 0 ? <p className={st.logWork}>{t('progress.list.work', { minutes: e.workMinutes })}</p> : null}
        {error ? (
          <p className={st.logError} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      <p className={st.logScore} aria-label={t('progress.list.scoreLabel', { score: e.score })}>
        <span aria-hidden="true">
          {e.score}
          <small>/100</small>
        </span>
      </p>
      <button type="button" role="switch" aria-checked={e.public} className={st.switch} onClick={toggle} aria-busy={busy || undefined}>
        <span className={st.switchTrack} aria-hidden="true">
          <span className={st.switchKnob} />
        </span>
        <span>{t('progress.list.public')}</span>
      </button>
    </li>
  );
}
