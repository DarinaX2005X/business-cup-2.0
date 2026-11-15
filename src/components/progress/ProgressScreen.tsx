'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/kit/Button';
import { Skeleton } from '@/components/kit/Skeleton';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import type { ProgressResponse } from '@/server/progress/types';
import { loadLevel, loadProgress, type LevelView } from './api';
import { LevelCard } from './LevelCard';
import { ProofLog } from './ProofLog';
import { ReviewKitCard } from './ReviewKitCard';
import { ScoreLine, ScoreLineEmpty } from './ScoreLine';
import { ShareProof } from './ShareProof';
import { StreakCalendar } from './StreakCalendar';
import st from './progress.module.css';

type State = { s: 'loading' } | { s: 'noMap' } | { s: 'error'; code: string } | { s: 'ready'; data: ProgressResponse };

/**
 * Progress: the score line on the violet field with the practice calendar and the level beside it, then
 * the proof log with the Review kit and the plan's progress beside it. `planSlot` is where the 90-day
 * plan package mounts its own block (`<PlanProgress />`, growth agent).
 */
export function ProgressScreen({ planSlot }: { planSlot?: ReactNode }) {
  const { t, locale } = useT();
  const { status, error: profileError } = useProfile();
  const search = useSearchParams();
  // Development only: see the Free screen while DEV_FORCE_PRO is on (as on the week map).
  const forceFree = process.env.NODE_ENV !== 'production' && search.get('plan') === 'free';
  const [loaded, setState] = useState<State>({ s: 'loading' });
  const [level, setLevel] = useState<LevelView | null>(null);

  /** Progress and level from the server; the level is a quiet extra the page never waits for or fails with. */
  const load = useCallback(
    () =>
      Promise.all([
        loadLevel()
          .then((l) => setLevel(l))
          .catch(() => setLevel(null)),
        loadProgress(locale)
          .then((data) => setState(!data.hasMap && data.proof.length === 0 ? { s: 'noMap' } : { s: 'ready', data }))
          .catch((err) => setState({ s: 'error', code: err instanceof ApiError ? err.code : 'network' })),
      ]),
    [locale],
  );

  useEffect(() => {
    if (status === 'ready') void load();
  }, [status, load]);

  // Without a usable profile the screen follows the profile's state; with one, what /api/progress said.
  const state: State =
    status === 'loading'
      ? { s: 'loading' }
      : status === 'anonymous'
        ? { s: 'noMap' }
        : status === 'orphaned'
          ? { s: 'error', code: 'unauthorized' }
          : status === 'error'
            ? { s: 'error', code: profileError ?? 'network' }
            : loaded;

  const onPublic = useCallback((id: string, value: boolean, slug: string | null) => {
    setState((cur) => {
      if (cur.s !== 'ready') return cur;
      const proof = cur.data.proof.map((e) => (e.id === id ? { ...e, public: value } : e));
      return { s: 'ready', data: { ...cur.data, proof, publicCount: proof.filter((e) => e.public).length, publicSlug: slug ?? cur.data.publicSlug } };
    });
  }, []);

  if (state.s === 'loading') return <LoadingView />;
  if (state.s === 'noMap') return <NoMapView />;
  if (state.s === 'error') {
    const msg = t(`common.errors.${state.code}`);
    return (
      <div className={st.page}>
        <h1 className={st.h1}>{t('progress.title')}</h1>
        <div className={st.errorBox} role="alert">
          <p>{msg.startsWith('common.errors.') ? t('progress.errors.load') : msg}</p>
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('common.actions.retry')}
          </Button>
        </div>
      </div>
    );
  }

  const d = state.data;
  const reps = d.history.filter((p) => p.kind === 'rep').length;
  const delta = d.score !== null && d.startScore !== null ? d.score - d.startScore : 0;

  return (
    <div className={st.page}>
      <h1 className={st.h1}>{t('progress.title')}</h1>

      <div className={st.top}>
        <section className={`${st.scorePanel} field`} data-surface="field" aria-labelledby="score-title">
          <div className={st.scoreHead}>
            <h2 id="score-title" className={st.scoreLabel}>
              {t('progress.score.label')}
            </h2>
            <p className={st.scoreNum}>
              <span>{d.score ?? '–'}</span>
              <small>{t('progress.score.outOf')}</small>
            </p>
            <p className={st.scoreDelta}>{delta > 0 ? t('progress.score.up', { delta }) : t('progress.score.flat')}</p>
          </div>
          {reps > 0 ? <ScoreLine points={d.history} /> : <ScoreLineEmpty />}
          {d.counts.reps > 0 ? (
            <ul className={st.counts}>
              <li>{t('progress.counts.reps', { count: d.counts.reps })}</li>
              {d.counts.caught > 0 ? <li>{t('progress.counts.caught', { count: d.counts.caught })}</li> : null}
              {d.counts.hoursPractised > 0 ? <li title={t('progress.counts.hoursHint')}>{t('progress.counts.hours', { hours: d.counts.hoursPractised })}</li> : null}
            </ul>
          ) : null}
        </section>
        <div className={st.topSide}>
          <StreakCalendar calendar={d.streak.calendar} today={d.streak.today} current={d.streak.current} best={d.streak.best} />
          {level ? <LevelCard level={level} /> : null}
        </div>
      </div>

      <div className={st.lower}>
        <section className={st.proof} aria-labelledby="proof-title">
          <div className={st.proofHead}>
            <div>
              <h2 id="proof-title" className={st.h2}>
                {t('progress.list.title')}
              </h2>
              {d.proof.length ? <p className={st.sectionLead}>{t('progress.list.lead')}</p> : null}
            </div>
            {d.proof.length ? <ShareProof publicCount={d.publicCount} /> : null}
          </div>
          {d.proof.length ? <ProofLog entries={d.proof} today={d.streak.today} onChange={onPublic} /> : <FirstRep />}
        </section>
        <aside className={st.side}>
          <ReviewKitCard isMax={d.isMax && !forceFree} reps={d.counts.reps} />
          {planSlot}
        </aside>
      </div>
    </div>
  );
}

/** Before the first rep: an unprinted proof sheet with a dashed edge and the way to fill it. */
function FirstRep() {
  const { t } = useT();
  return (
    <div className={st.firstRep}>
      <div className={st.firstSheet} aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div>
        <h3 className={st.firstTitle}>{t('progress.empty.title')}</h3>
        <p className={st.sideBody}>{t('progress.empty.body')}</p>
        <Link href="/today" className={`${btn.btn} ${btn.b_primary}`}>
          {t('progress.empty.action')}
        </Link>
      </div>
    </div>
  );
}

function NoMapView() {
  const { t } = useT();
  return (
    <div className={st.page}>
      <h1 className={st.h1}>{t('progress.title')}</h1>
      <section className={`${st.scorePanel} ${st.noMap} field`} data-surface="field" aria-labelledby="nomap-title">
        <div className={st.noMapText}>
          <h2 id="nomap-title" className={st.noMapTitle}>
            {t('progress.empty.noMapTitle')}
          </h2>
          <p>{t('progress.empty.noMapBody')}</p>
          <Link href="/start" className={`${btn.btn} ${btn.b_apricot} ${btn.s_lg}`}>
            {t('progress.empty.noMapAction')}
          </Link>
        </div>
        <ScoreLineEmpty height={200} />
      </section>
    </div>
  );
}

function LoadingView() {
  return (
    <div className={st.page} aria-busy="true">
      <Skeleton width={260} height={44} radius={12} />
      <div className={st.top} style={{ marginTop: 32 }}>
        <Skeleton height={400} radius={28} />
        <Skeleton height={400} radius={20} />
      </div>
      <div className={st.lower}>
        <Skeleton height={320} radius={20} />
        <Skeleton height={320} radius={20} />
      </div>
    </div>
  );
}
