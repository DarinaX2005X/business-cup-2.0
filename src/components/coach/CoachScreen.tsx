'use client';

import { MessageSquarePlus } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Button } from '@/components/kit/Button';
import { KeystoneMark } from '@/components/kit/Mark';
import { Dialog } from '@/components/kit/Overlay';
import { Skeleton } from '@/components/kit/Skeleton';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { getCoach, newChat, type CoachState } from './api';
import { CoachChat } from './CoachChat';
import { ContextPanel } from './ContextPanel';
import { LockedPreview } from './LockedPreview';
import st from './coach.module.css';

type Load = { phase: 'loading' } | { phase: 'ready'; state: CoachState } | { phase: 'failed' };

/**
 * /coach: the conversation sheet beside «What your coach knows». Coach plan: the live chat. Free and Pro:
 * a real preview answer on their own week and the way in. No week map yet: the coach asks for it first.
 */
export function CoachScreen() {
  const { t } = useT();
  const { status, refresh } = useProfile();
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [resetKey, setResetKey] = useState(0);
  const [count, setCount] = useState(0);
  const [asking, setAsking] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    if (status !== 'ready') return;
    let live = true;
    getCoach()
      .then((state) => {
        if (!live) return;
        setLoad({ phase: 'ready', state });
        setCount(state.messages.length);
      })
      .catch(() => live && setLoad({ phase: 'failed' }));
    return () => {
      live = false;
    };
  }, [status, attempt]);

  const onCount = useCallback((n: number) => setCount(n), []);

  const clear = async () => {
    setClearing(true);
    try {
      await newChat();
      setLoad((l) => (l.phase === 'ready' ? { phase: 'ready', state: { ...l.state, messages: [] } } : l));
      setResetKey((k) => k + 1);
      setAsking(false);
    } catch {
      /* the dialog stays open; the person can try again */
    } finally {
      setClearing(false);
    }
  };

  const noProfile = status === 'anonymous';
  const state = load.phase === 'ready' ? load.state : null;
  const noMap = noProfile || (state !== null && !state.hasMap);
  const isCoach = state?.access === 'coach';

  let main: ReactNode;
  if (noMap) {
    main = (
      <div className={st.noMap}>
        <KeystoneMark size={56} tone="paper" />
        <h2 className={st.emptyTitle}>{t('coach.noMap.title')}</h2>
        <p className={st.emptyLead}>{t('coach.noMap.body')}</p>
        <Link href="/start" className={`${btn.btn} ${btn.b_primary} ${btn.s_lg}`}>
          {t('coach.noMap.cta')}
        </Link>
      </div>
    );
  } else if (status === 'error' || status === 'orphaned' || load.phase === 'failed') {
    main = (
      <div className={st.noMap} role="alert">
        <h2 className={st.emptyTitle}>{t('coach.errors.load')}</h2>
        <Button variant="secondary" onClick={() => (status === 'ready' ? setAttempt((n) => n + 1) : void refresh())}>
          {t('coach.errors.retry')}
        </Button>
      </div>
    );
  } else if (!state) {
    main = (
      <div className={st.loadingSheet} aria-busy="true" aria-label={t('coach.loading')}>
        <Skeleton width="44%" height={26} />
        <Skeleton width="70%" height={16} />
        <div className={st.loadingRows}>
          <Skeleton height={64} radius={14} />
          <Skeleton height={64} radius={14} />
          <Skeleton height={64} radius={14} />
        </div>
      </div>
    );
  } else if (isCoach) {
    // «New chat» bumps the key: a fresh conversation (any answer still arriving is stopped on unmount)
    main = <CoachChat key={resetKey} initial={state.messages} starters={state.starters} left={state.left} cap={state.cap} onMessagesChange={onCount} />;
  } else {
    main = <LockedPreview starters={state.starters} onUnlocked={() => setAttempt((n) => n + 1)} />;
  }

  return (
    <div className={st.page}>
      <header className={st.head}>
        <div>
          <h1 className={st.h1}>{t('coach.title')}</h1>
          <p className={st.lead}>{t('coach.lead')}</p>
        </div>
        {isCoach && count > 0 ? (
          <Button variant="quiet" icon={<MessageSquarePlus size={18} />} onClick={() => setAsking(true)}>
            {t('coach.newChat')}
          </Button>
        ) : null}
      </header>

      <div className={st.grid} data-side={state?.me ? true : undefined}>
        <section className={st.sheet} data-locked={(state && !isCoach && !noMap) || undefined} aria-label={t('coach.title')}>
          {main}
        </section>
        {state?.me ? (
          <aside className={st.side}>
            <ContextPanel me={state.me} />
          </aside>
        ) : null}
      </div>

      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title={t('coach.newChatAsk.title')}
        footer={
          <>
            <Button variant="quiet" onClick={() => setAsking(false)}>
              {t('common.actions.cancel')}
            </Button>
            <Button data-autofocus loading={clearing} onClick={() => void clear()}>
              {t('coach.newChatAsk.confirm')}
            </Button>
          </>
        }
      >
        <p>{t('coach.newChatAsk.body')}</p>
      </Dialog>
    </div>
  );
}
