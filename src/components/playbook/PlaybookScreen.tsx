'use client';

import { Lock, Sprout } from 'lucide-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CupOffer } from '@/components/cup/CupOffer';
import { CategorySwatch } from '@/components/kit/Evidence';
import { FieldArches, SheetStack } from '@/components/kit/Illustration';
import { LockedPanel } from '@/components/kit/Shop';
import { Skeleton } from '@/components/kit/Skeleton';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { errorCode, errorKey, loadPlaybook, type PlaybookCard, type PlaybookView } from './api';
import { InstructionCard } from './InstructionCard';
import st from './playbook.module.css';

type Load = { s: 'loading' } | { s: 'ready'; view: PlaybookView } | { s: 'noMap' } | { s: 'error'; code: string };

const POLL_MS = 3000;
const POLL_MAX = 60;

/**
 * /playbook: the person's library of instructions for AI, one card per task of their week that AI does
 * or speeds up. A shelf of tasks on the left (a tab list, horizontal on narrow screens), the selected
 * card at a working size on the right, a way to Second look under it.
 */
export function PlaybookScreen() {
  const { t, locale } = useT();
  const { status, profile, error: profileError } = useProfile();
  const search = useSearchParams();
  const [load, setLoad] = useState<Load>({ s: 'loading' });
  const [selected, setSelected] = useState<string | null>(search.get('task'));
  const polls = useRef(0);

  const fetchView = useCallback(async () => {
    try {
      const view = await loadPlaybook(locale);
      setLoad({ s: 'ready', view });
      return view;
    } catch (err) {
      const code = errorCode(err);
      setLoad(code === 'no_xray' ? { s: 'noMap' } : { s: 'error', code });
      return null;
    }
  }, [locale]);

  useEffect(() => {
    if (status === 'loading') return;
    if (status === 'anonymous') return setLoad({ s: 'noMap' });
    if (status === 'orphaned') return setLoad({ s: 'error', code: 'unauthorized' });
    if (status === 'error') return setLoad({ s: 'error', code: profileError ?? 'network' });
    polls.current = 0;
    void fetchView();
    // the profile id, not its every version: copying and editing update the card in place
  }, [status, profile?.id, profileError, fetchView]);

  // while the starter instructions are being written, ask again every few seconds
  const pending = load.s === 'ready' && load.view.starter === 'pending';
  useEffect(() => {
    if (!pending) return;
    const id = window.setTimeout(() => {
      if (++polls.current > POLL_MAX) return;
      void fetchView();
    }, POLL_MS);
    return () => window.clearTimeout(id);
  }, [pending, load, fetchView]);

  const view = load.s === 'ready' ? load.view : null;
  const cards = view?.cards ?? [];
  const current = cards.find((c) => c.taskId === selected) ?? cards[0] ?? null;

  const pick = (taskId: string) => {
    setSelected(taskId);
    const url = `/playbook?task=${encodeURIComponent(taskId)}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(null, '', url);
  };

  const replaceCard = (card: PlaybookCard) =>
    setLoad((l) => (l.s === 'ready' ? { s: 'ready', view: { ...l.view, cards: l.view.cards.map((c) => (c.taskId === card.taskId ? card : c)) } } : l));

  if (load.s === 'loading') return <LoadingView />;
  if (load.s === 'noMap') return <EmptyView kind="noMap" />;
  if (load.s === 'error') return <ErrorView code={load.code} onRetry={() => void fetchView()} />;
  if (!view || !current) return <EmptyView kind="noTasks" xrayId={profile?.lastXrayId ?? null} />;

  return (
    <div className={st.page}>
      <header className={st.head}>
        <h1 className={st.h1}>{t('playbook.title')}</h1>
        <p className={st.lead}>{t('playbook.lead')}</p>
        {!view.practised ? (
          <p className={st.grows}>
            <Sprout strokeWidth={1.75} aria-hidden="true" />
            {t('playbook.grows')}
          </p>
        ) : null}
      </header>

      <div className={st.layout}>
        <Shelf cards={cards} current={current.taskId} onPick={pick} />
        <div className={st.stage} role="tabpanel" id={`pb-panel-${current.taskId}`} aria-labelledby={`pb-tab-${current.taskId}`}>
          {current.locked ? (
            <LockedPanel
              title={t('playbook.locked.title', { task: current.short })}
              reason={t('playbook.locked.reason')}
              shape="list"
              action={
                <span className={st.proWays}>
                  <Link href={profile?.lastXrayId ? `/pricing?from=${encodeURIComponent(profile.lastXrayId)}` : '/pricing'} className={`${btn.btn} ${btn.b_primary}`}>
                    {t('playbook.locked.trial')}
                  </Link>
                  <CupOffer onUnlocked={() => void fetchView()} />
                </span>
              }
            />
          ) : (
            <InstructionCard key={current.taskId} card={current} view={view} onCard={replaceCard} onRetryStarter={() => void fetchView()} />
          )}
        </div>
      </div>

      <SecondLookBand job={view.jobTitle} />
    </div>
  );
}

/* ---------- the shelf of tasks ---------- */

function Shelf({ cards, current, onPick }: { cards: PlaybookCard[]; current: string; onPick: (id: string) => void }) {
  const { t } = useT();
  const plate = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent, i: number) => {
    const d = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0;
    const n = e.key === 'Home' ? 0 : e.key === 'End' ? cards.length - 1 : d ? (i + d + cards.length) % cards.length : -1;
    if (n < 0) return;
    e.preventDefault();
    onPick(cards[n].taskId);
    refs.current[n]?.focus();
  };

  return (
    <nav className={st.shelf} aria-label={t('playbook.shelf.label')}>
      <div role="tablist" aria-orientation="vertical" aria-label={t('playbook.shelf.label')} className={st.shelfList}>
        {cards.map((c, i) => {
          const on = c.taskId === current;
          const yours = !c.locked && c.instruction && c.instruction.source !== 'starter';
          return (
            <button
              key={c.taskId}
              ref={(el) => {
                refs.current[i] = el;
              }}
              id={`pb-tab-${c.taskId}`}
              type="button"
              role="tab"
              aria-selected={on}
              aria-controls={`pb-panel-${c.taskId}`}
              tabIndex={on ? 0 : -1}
              className={st.row}
              data-on={on || undefined}
              data-locked={c.locked || undefined}
              onClick={() => onPick(c.taskId)}
              onKeyDown={(e) => onKey(e, i)}
            >
              {on ? <motion.span layoutId={plate} className={st.rowPlate} transition={{ type: 'spring', stiffness: 520, damping: 40 }} /> : null}
              <CategorySwatch category={c.category} size="sm" />
              <span className={st.rowLabel}>{c.short}</span>
              {c.locked ? (
                <span className={st.rowLock}>
                  <Lock strokeWidth={1.75} aria-hidden="true" />
                  <span className="sr-only">{t('playbook.shelf.pro')}</span>
                </span>
              ) : yours ? (
                <span className={st.rowYours}>{t('playbook.shelf.yours')}</span>
              ) : null}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/* ---------- the way to Second look ---------- */

function SecondLookBand({ job }: { job: string }) {
  const { t } = useT();
  return (
    <section className={`${st.band} field`} data-surface="field" aria-labelledby="pb-sl-title">
      <FieldArches className={st.bandArches} />
      <div className={st.bandText}>
        <h2 id="pb-sl-title" className={st.bandTitle}>
          {t('playbook.toSecondLook.title')}
        </h2>
        <p className={st.bandBody}>{t('playbook.toSecondLook.body', { job: job.toLowerCase() })}</p>
        <Link href="/second-look" className={`${btn.btn} ${btn.b_apricot}`}>
          {t('playbook.toSecondLook.action')}
        </Link>
      </div>
      <div className={st.bandArt} aria-hidden="true">
        <SheetStack className={st.bandSvg} />
      </div>
    </section>
  );
}

/* ---------- states ---------- */

function LoadingView() {
  const { t } = useT();
  return (
    <div className={st.page} role="status" aria-label={t('playbook.loading')}>
      <header className={st.head}>
        <Skeleton width={320} height={44} radius={12} />
        <Skeleton width="min(560px, 100%)" height={20} />
      </header>
      <div className={st.layout}>
        <div className={st.shelfSkel}>
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={48} radius={14} />
          ))}
        </div>
        <div className={st.cardSkel}>
          <Skeleton width="40%" height={28} />
          <Skeleton width="92%" height={16} />
          <Skeleton width="86%" height={16} />
          <Skeleton width="70%" height={16} />
        </div>
      </div>
    </div>
  );
}

function EmptyView({ kind, xrayId }: { kind: 'noMap' | 'noTasks'; xrayId?: string | null }) {
  const { t } = useT();
  const map = kind === 'noMap';
  return (
    <div className={st.page}>
      <section className={st.empty}>
        <div className={st.emptyArt} aria-hidden="true">
          <SheetStack className={st.emptySvg} fit="contain" />
        </div>
        <div className={st.emptyText}>
          <h1 className={st.h1}>{map ? t('playbook.empty.noMapTitle') : t('playbook.empty.noTasksTitle')}</h1>
          <p className={st.lead}>{map ? t('playbook.empty.noMapBody') : t('playbook.empty.noTasksBody')}</p>
          <Link href={map || !xrayId ? '/start' : `/x/${encodeURIComponent(xrayId)}`} className={`${btn.btn} ${btn.b_primary}`}>
            {map ? t('playbook.empty.noMapCta') : t('playbook.empty.noTasksCta')}
          </Link>
        </div>
      </section>
    </div>
  );
}

function ErrorView({ code, onRetry }: { code: string; onRetry: () => void }) {
  const { t } = useT();
  return (
    <div className={st.page}>
      <section className={st.empty}>
        <div className={st.emptyText}>
          <h1 className={st.h1}>{t('playbook.loadError')}</h1>
          <p className={st.lead}>{t(errorKey(code))}</p>
          <button type="button" className={`${btn.btn} ${btn.b_primary}`} onClick={onRetry}>
            {t('common.actions.retry')}
          </button>
        </div>
      </section>
    </div>
  );
}

