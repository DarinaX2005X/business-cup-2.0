'use client';

import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiOrMeRoundFull, RepView } from '@/domain/reps';
import type { RepType } from '@/domain/types';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { createRep, errorCode, errorKey, getRep, loadToday, pollRep, repFromConflict, startTrial, type AnswerResult, type Hub, type RepOrPending, type Streak } from './api';
import { DelegateRep } from './DelegateRep';
import { EdgeRep } from './EdgeRep';
import { ErrorView, FreeHub, Generating, LoadingView, NoMap, ProHub } from './Hub';
import { SlipRep } from './SlipRep';
import { TodayReload } from './shared';
import { FirstWeekBlock } from '@/components/pricing/FirstWeekBlock';
import st from './today.module.css';

export type View =
  | { v: 'loading' }
  | { v: 'hub' }
  /** `repId` is null while the POST that starts the rep is still answering. */
  | { v: 'generating'; repId: string | null; type?: RepType; taskShort?: string }
  | { v: 'rep'; rep: RepView; fresh: boolean }
  | { v: 'repError'; code: string };

/** A screen state for the state gallery and development (`/today?fixture=`); never used in production. */
export interface TodayFixture {
  hub: Hub;
  view?: View;
}

function setUrl(rep: string | null, replace = false) {
  const url = rep ? `/today?rep=${encodeURIComponent(rep)}` : '/today';
  if (window.location.pathname + window.location.search === url) return;
  window.history[replace ? 'replaceState' : 'pushState'](null, '', url);
}

export function TodayScreen({ fixture }: { fixture?: TodayFixture }) {
  const { t } = useT();
  const { status: pStatus, profile, error: profileError, refresh } = useProfile();
  const search = useSearchParams();
  const repParam = fixture ? null : search.get('rep');
  const trialParam = !fixture && search.get('trial') === '1';

  const [hub, setHub] = useState<Hub | null>(fixture?.hub ?? null);
  const [view, setView] = useState<View>(fixture?.view ?? (repParam ? { v: 'loading' } : { v: 'hub' }));
  const [streak, setStreak] = useState<Streak | null>(null);
  const [starting, setStarting] = useState<RepType | 'trial' | null>(null);
  const [startError, setStartError] = useState<string | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const retryRef = useRef<(() => void) | null>(null);

  const reloadHub = useCallback(async () => {
    const h = await loadToday();
    setHub(h);
    if (h.kind === 'pro' || h.kind === 'free') setStreak(h.data.streak);
    return h;
  }, []);

  /* ---------- first load ---------- */
  useEffect(() => {
    if (fixture || pStatus === 'loading') return;
    if (pStatus === 'anonymous') return setHub({ kind: 'noMap' });
    if (pStatus === 'orphaned') return setHub({ kind: 'error', code: 'unauthorized' });
    if (pStatus === 'error') return setHub({ kind: 'error', code: profileError ?? 'network' });
    void reloadHub();
  }, [fixture, pStatus, profileError, reloadHub]);

  /* ---------- a rep named in the address (?rep=) ---------- */
  useEffect(() => {
    if (fixture) return;
    if (!repParam) {
      // the browser's Back from a rep: the hub again, with today's latest state
      if (viewRef.current.v === 'rep' || viewRef.current.v === 'repError' || viewRef.current.v === 'loading') {
        setView({ v: 'hub' });
        if (pStatus === 'ready') void reloadHub();
      }
      return;
    }
    const cur = viewRef.current;
    if ((cur.v === 'rep' && cur.rep.id === repParam) || (cur.v === 'generating' && (cur.repId === repParam || cur.repId === null))) return;
    if (pStatus !== 'ready') return;
    let stop = false;
    setView({ v: 'loading' });
    getRep(repParam)
      .then((r) => {
        if (stop) return;
        setView('rep' in r ? { v: 'rep', rep: r.rep, fresh: false } : { v: 'generating', repId: r.repId });
      })
      .catch((err) => !stop && setView({ v: 'repError', code: errorCode(err) }));
    return () => {
      stop = true;
    };
  }, [fixture, repParam, pStatus, reloadHub]);

  /* ---------- a rep still being written when the hub loads ---------- */
  useEffect(() => {
    if (fixture || !hub || viewRef.current.v !== 'hub' || repParam) return;
    if (hub.kind === 'pro' && hub.data.status === 'generating' && hub.data.repId) setView({ v: 'generating', repId: hub.data.repId });
    if (hub.kind === 'free' && hub.data.trial.generating && hub.data.trial.repId) setView({ v: 'generating', repId: hub.data.trial.repId, type: 'slip' });
  }, [fixture, hub, repParam]);

  /* ---------- polling while the rep is written ---------- */
  const genId = view.v === 'generating' ? view.repId : null;
  // «Check again» on a slow rep: poll the same rep at once (never a second generation)
  const [pollRound, setPollRound] = useState(0);
  useEffect(() => {
    if (!genId || fixture) return;
    return pollRep(
      genId,
      (rep) => {
        setView({ v: 'rep', rep, fresh: false });
        setUrl(rep.id, true);
        void reloadHub();
      },
      (code) => setView({ v: 'repError', code }),
      pollRound > 0,
    );
  }, [genId, fixture, reloadHub, pollRound]);

  /* ---------- navigation ---------- */
  const top = () => window.scrollTo({ top: 0 });
  const openRep = useCallback((rep: RepView) => {
    setView({ v: 'rep', rep, fresh: false });
    setUrl(rep.id);
    top();
  }, []);
  const goHub = useCallback(() => {
    setUrl(null);
    setView({ v: 'hub' });
    setStartError(null);
    void reloadHub();
    top();
  }, [reloadHub]);

  const landed = useCallback(
    (r: RepOrPending, meta: { type?: RepType; taskShort?: string }) => {
      if ('rep' in r) return openRep(r.rep);
      setView({ v: 'generating', repId: r.repId, ...meta });
      setUrl(r.repId);
    },
    [openRep],
  );

  const failStart = useCallback(
    (err: unknown, meta: { type?: RepType; taskShort?: string }) => {
      const prior = repFromConflict(err);
      if (prior) return landed(prior, meta);
      const code = errorCode(err);
      setView({ v: 'hub' });
      setUrl(null, true);
      if (code === 'pro_required' || code === 'no_xray') {
        void reloadHub();
        return;
      }
      setStartError(t(errorKey(code)));
    },
    [landed, reloadHub, t],
  );

  const start = useCallback(
    async (type: RepType, kind: 'daily' | 'extra') => {
      if (starting) return;
      const taskShort = hub?.kind === 'pro' ? hub.data.choiceTasks[type]?.taskShort : undefined;
      setStarting(type);
      setStartError(null);
      // the waiting sheet shows at once; the POST answers when the rep is written or after 8 s
      setView({ v: 'generating', repId: null, type, taskShort });
      top();
      retryRef.current = () => void start(type, kind);
      try {
        landed(await createRep(type, kind), { type, taskShort });
      } catch (err) {
        failStart(err, { type, taskShort });
      } finally {
        setStarting(null);
      }
    },
    [starting, hub, landed, failStart],
  );

  const beginTrial = useCallback(async () => {
    if (starting) return;
    setStarting('trial');
    setStartError(null);
    setView({ v: 'generating', repId: null, type: 'slip' });
    top();
    retryRef.current = () => void beginTrial();
    try {
      landed(await startTrial(), { type: 'slip' });
    } catch (err) {
      failStart(err, { type: 'slip' });
    } finally {
      setStarting(null);
    }
  }, [starting, landed, failStart]);

  /* ---------- /today?trial=1 from the week map: start or continue the free rep ---------- */
  const trialHandled = useRef(false);
  useEffect(() => {
    if (!trialParam || trialHandled.current || !hub || viewRef.current.v !== 'hub') return;
    trialHandled.current = true;
    if (hub.kind === 'free') {
      const tr = hub.data.trial;
      if (tr.status === 'available') return void beginTrial();
      if (tr.rep && tr.rep.status === 'open') return openRep(tr.rep);
    }
    setUrl(null, true);
  }, [trialParam, hub, beginTrial, openRep]);

  const onAnswered = useCallback(
    (r: AnswerResult) => {
      const before = viewRef.current;
      const justDone = r.rep.status === 'done' && !(before.v === 'rep' && before.rep.status === 'done');
      setView({ v: 'rep', rep: r.rep, fresh: justDone });
      setStreak(r.streak);
      if (justDone) {
        void reloadHub();
        void refresh();
      }
    },
    [reloadHub, refresh],
  );

  const onPlayed = useCallback((c: NonNullable<AiOrMeRoundFull['completed']>) => {
    setHub((h) => (h && (h.kind === 'pro' || h.kind === 'free') && h.data.aiOrMe ? ({ ...h, data: { ...h.data, aiOrMe: { ...h.data.aiOrMe, completed: c } } } as Hub) : h));
    void refresh();
  }, [refresh]);

  const weekHref = profile?.lastXrayId ? `/x/${profile.lastXrayId}` : null;
  const reloadNow = useCallback(() => void reloadHub(), [reloadHub]);
  const job = profile?.jobTitle?.trim() || null;

  /* ---------- render ---------- */
  if (view.v === 'loading') return <LoadingView />;
  if (view.v === 'generating') return <Generating type={view.type} taskShort={view.taskShort} job={job} onCheckAgain={view.repId ? () => setPollRound((n) => n + 1) : undefined} />;
  if (view.v === 'repError') {
    return (
      <ErrorView
        code={errorKey(view.code)}
        title={t('today.repError')}
        onRetry={view.code === 'generation_failed' && retryRef.current ? retryRef.current : goHub}
        retryLabel={view.code === 'generation_failed' && retryRef.current ? t('common.actions.retry') : t('today.back')}
      />
    );
  }
  if (view.v === 'rep') {
    const rep = view.rep;
    const props = {
      rep,
      streak: streak ?? (hub && (hub.kind === 'pro' || hub.kind === 'free') ? hub.data.streak : null),
      fresh: view.fresh,
      isFree: rep.kind === 'trial' && hub?.kind !== 'pro',
      onAnswered,
      onBack: goHub,
      onPractice: goHub,
    };
    const screen =
      rep.type === 'delegate' && rep.delegate ? (
        <DelegateRep key={rep.id} {...props} />
      ) : rep.type === 'edge' && rep.edge ? (
        <EdgeRep key={rep.id} {...props} />
      ) : (
        <SlipRep key={rep.id} {...props} />
      );
    // after the free rep: the person's first week of reps, with the trial and the Business Cup offer
    const firstWeek = props.isFree && rep.status === 'done' && profile?.lastXrayId ? profile.lastXrayId : null;
    return (
      <TodayReload.Provider value={reloadNow}>
        {screen}
        {firstWeek ? (
          <div className={st.firstWeek}>
            <FirstWeekBlock xrayId={firstWeek} />
          </div>
        ) : null}
      </TodayReload.Provider>
    );
  }

  if (!hub) return <LoadingView />;
  if (hub.kind === 'noMap') return <NoMap />;
  if (hub.kind === 'error') return <ErrorView code={errorKey(hub.code)} onRetry={() => void reloadHub()} />;
  if (hub.kind === 'pro') {
    return (
      <ProHub
        data={hub.data}
        starting={starting === 'trial' ? null : starting}
        startError={startError}
        onStart={(type, kind) => void start(type, kind)}
        onOpen={openRep}
        weekHref={weekHref}
        onPlayed={onPlayed}
      />
    );
  }
  return (
    <FreeHub
      data={hub.data}
      starting={starting === 'trial'}
      startError={startError}
      onStartTrial={() => void beginTrial()}
      onOpen={openRep}
      weekHref={weekHref}
      onPlayed={onPlayed}
      onUnlocked={reloadNow}
    />
  );
}
