'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Button } from '@/components/kit/Button';
import { SheetStack, FieldArches } from '@/components/kit/Illustration';
import { StreakWeek } from '@/components/kit/Points';
import { LockedPanel } from '@/components/kit/Shop';
import { Skeleton } from '@/components/kit/Skeleton';
import btn from '@/components/kit/controls.module.css';
import type { AiOrMeRoundFull, RepView } from '@/domain/reps';
import type { RepType } from '@/domain/types';
import { useT } from '@/i18n/client';
import { AiOrMe } from './AiOrMe';
import type { TodayFree, TodayPro } from './api';
import { ChoiceCards } from './Choice';
import { personaInitial } from './EdgeRep';
import { useUntilMidnight, weekOf } from './hooks';
import { PaywallActions, proofText, TaskTile } from './shared';
import { typeName, untilText } from './text';
import st from './today.module.css';

/* ---------- loading and waiting ---------- */

/** The shape of a rep sheet while today's data loads (the sheet lands in the same place). */
export function SheetSkeleton({ label }: { label?: string }) {
  return (
    <div className={st.skelSheet} role={label ? 'status' : undefined} aria-label={label}>
      <div className={st.skelHead}>
        <Skeleton width="46%" height={26} />
        <Skeleton width={110} height={28} radius={6} />
      </div>
      <div className={st.skelLines}>
        {[94, 88, 97, 72, 0, 90, 84, 66, 0, 92, 58].map((w, i) =>
          w ? <Skeleton key={i} width={`${w}%`} height={13} style={{ animationDelay: `${i * 70}ms` }} /> : <span key={i} className={st.skelGap} />,
        )}
      </div>
    </div>
  );
}

export function LoadingView() {
  const { t } = useT();
  return (
    <div className={st.page}>
      <div className={st.hubHead}>
        <Skeleton width={320} height={44} radius={10} />
      </div>
      <SheetSkeleton label={t('today.loading')} />
    </div>
  );
}

export function Generating({ type, taskShort, job }: { type?: RepType; taskShort?: string; job: string | null }) {
  const { t } = useT();
  const key = type ? `today.generating.${type}` : 'today.generating.any';
  return (
    <div className={st.repPage}>
      <header className={st.repHead}>
        <h1 className={st.repTitle}>
          {type ? typeName(t, type) : t('today.generating.title')}
          {taskShort ? <span className={st.taskPlate}>{taskShort}</span> : null}
        </h1>
        <p className={st.repAsk} role="status">
          {t(key)}
          <span className={st.dots} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </p>
        {job ? <p className={st.jobLine}>{t('today.generating.job', { job })}</p> : null}
      </header>
      <div className={st.genStage}>
        <SheetSkeleton />
        <p className={st.genHint}>{t('today.generating.hint')}</p>
      </div>
    </div>
  );
}

export function ErrorView({ code, title, onRetry, retryLabel }: { code: string; title?: string; onRetry?: () => void; retryLabel?: string }) {
  const { t } = useT();
  const key = code.startsWith('today.') || code.startsWith('common.') ? code : `common.errors.${code}`;
  return (
    <div className={st.page}>
      <section className={st.empty} aria-labelledby="err-title">
        <div className={st.emptyArt} aria-hidden="true">
          <SheetStack fit="contain" />
        </div>
        <div className={st.emptyText}>
          <h1 id="err-title" className={st.h1}>
            {title ?? t('today.loadError')}
          </h1>
          <p>{t(key)}</p>
          {onRetry ? <Button onClick={onRetry}>{retryLabel ?? t('common.actions.retry')}</Button> : null}
        </div>
      </section>
    </div>
  );
}

export function NoMap() {
  const { t } = useT();
  return (
    <div className={st.page}>
      <section className={st.empty} aria-labelledby="nomap-title">
        <div className={st.emptyArt} aria-hidden="true">
          <SheetStack fit="contain" />
        </div>
        <div className={st.emptyText}>
          <h1 id="nomap-title" className={st.h1}>
            {t('today.noMap.title')}
          </h1>
          <p>{t('today.noMap.body')}</p>
          <Link href="/start" className={`${btn.btn} ${btn.b_primary} ${btn.s_lg}`}>
            {t('today.noMap.cta')}
          </Link>
        </div>
      </section>
    </div>
  );
}

/* ---------- a rep waiting to be finished ---------- */

/** The real start of the waiting rep: the document's first lines, the case, or the last thing they said. */
function peekOf(rep: RepView): { title: string; body: string; persona?: { initial: string; line: string } } {
  if (rep.type === 'slip') {
    const lines = (rep.slip?.document ?? '').split('\n').map((l) => l.trim()).filter(Boolean);
    const title = (lines.find((l) => l.startsWith('# ')) ?? rep.title).replace(/^#\s*/, '');
    const body = lines
      .filter((l) => !l.startsWith('#') && !l.startsWith('|'))
      .slice(1, 4)
      .map((l) => l.replace(/^[-*]\s+/, '').replace(/\*\*|__/g, ''))
      .join(' ');
    return { title, body };
  }
  if (rep.type === 'edge' && rep.edge) {
    const last = [...rep.edge.turns].reverse().find((x) => x.role === 'persona');
    return { title: rep.title, body: '', persona: { initial: personaInitial(rep.edge.personaPublic), line: last?.text ?? '' } };
  }
  return { title: rep.title, body: rep.delegate?.scenario ?? rep.brief };
}

export function ContinueCard({ rep, onOpen, title, cta }: { rep: RepView; onOpen: () => void; title?: string; cta?: string }) {
  const { t } = useT();
  const peek = peekOf(rep);
  return (
    <section className={st.cont} aria-labelledby={`cont-${rep.id}`}>
      <div className={st.contText}>
        <h2 id={`cont-${rep.id}`} className={st.contTitle}>
          {title ?? typeName(t, rep.type)}
        </h2>
        <p className={st.contTask}>
          <TaskTile human={rep.type === 'edge'} />
          {rep.taskShort}
        </p>
        <Button size="lg" onClick={onOpen}>
          {cta ?? t('today.continue')}
        </Button>
      </div>
      <button type="button" className={st.peek} onClick={onOpen} tabIndex={-1} aria-hidden="true">
        <span className={st.peekSheet}>
          <span className={st.peekTitle}>{peek.title}</span>
          {peek.persona ? (
            <span className={st.peekTalk}>
              <span className={st.peekInitial}>{peek.persona.initial}</span>
              <span className={st.peekLine}>{peek.persona.line}</span>
            </span>
          ) : (
            <span className={st.peekBody}>{peek.body}</span>
          )}
        </span>
      </button>
    </section>
  );
}

/* ---------- the day is done ---------- */

function DoneBlock({ daily, streak, onOpen }: { daily: RepView; streak: TodayPro['streak']; onOpen: () => void }) {
  const { t } = useT();
  const left = useUntilMidnight();
  const week = weekOf(streak.days);
  return (
    <section className={`${st.done} field`} data-surface="field" aria-labelledby="done-title">
      <FieldArches className={st.doneArches} />
      <div className={st.doneText}>
        <h1 id="done-title" className={st.doneTitle}>
          {t('today.done.title')}
        </h1>
        <p className={st.doneLine}>
          <span className={st.doneType}>{typeName(t, daily.type)}.</span> {proofText(t, daily)}
        </p>
        <div className={st.doneActions}>
          <Button variant="lavender" onClick={onOpen}>
            {t('today.done.review')}
          </Button>
          <span className={st.doneNext} aria-live="off">
            {left === null ? t('today.done.nextTomorrow') : t('today.done.next', { time: untilText(t, left) })}
          </span>
        </div>
      </div>
      <div className={st.doneStreak}>
        <StreakWeek done={week.done} today={week.today} surface="violet" />
        {streak.current > 0 ? <p className={st.doneStreakLine}>{t('today.result.streakLine', { count: streak.current })}</p> : null}
      </div>
    </section>
  );
}

/* ---------- Pro ---------- */

export function ProHub({
  data,
  starting,
  startError,
  onStart,
  onOpen,
  weekHref,
  onPlayed,
}: {
  data: TodayPro;
  starting: RepType | null;
  startError: string | null;
  onStart: (type: RepType, kind: 'daily' | 'extra') => void;
  onOpen: (rep: RepView) => void;
  weekHref: string | null;
  onPlayed: (c: NonNullable<AiOrMeRoundFull['completed']>) => void;
}) {
  const { t } = useT();
  const daily = data.daily;
  const openExtra = data.extras.find((e) => e.status === 'open');
  const doneExtras = data.extras.filter((e) => e.status === 'done');
  const errorLine = startError ? (
    <p className={st.inlineError} role="alert">
      {startError}
    </p>
  ) : null;

  let top: ReactNode;
  if (!daily) {
    top = (
      <>
        <div className={st.hubHead}>
          <h1 className={st.h1}>{t('today.hub.title')}</h1>
          <p className={st.hubLead}>{t('today.hub.lead')}</p>
        </div>
        {errorLine}
        <ChoiceCards tasks={data.choiceTasks} day={data.day} starting={starting} onStart={(type) => onStart(type, 'daily')} />
      </>
    );
  } else if (daily.status === 'open') {
    top = (
      <>
        <div className={st.hubHead}>
          <h1 className={st.h1}>{t('today.hub.waiting')}</h1>
        </div>
        <ContinueCard rep={daily} onOpen={() => onOpen(daily)} />
      </>
    );
  } else {
    top = (
      <>
        <DoneBlock daily={daily} streak={data.streak} onOpen={() => onOpen(daily)} />
        <section className={st.more} aria-labelledby="more-title">
          <div className={st.moreHead}>
            <h2 id="more-title" className={st.h2}>
              {t('today.done.practiceTitle')}
            </h2>
            <p className={st.moreLead}>{data.extrasLeft > 0 ? t('today.done.extrasLeft', { count: data.extrasLeft }) : t('today.done.extrasNone')}</p>
          </div>
          {openExtra ? <ContinueCard rep={openExtra} onOpen={() => onOpen(openExtra)} title={t('today.done.openExtra', { type: typeName(t, openExtra.type) })} /> : null}
          {errorLine}
          {data.extrasLeft > 0 && !openExtra ? <ChoiceCards tasks={data.choiceTasks} day={data.day} starting={starting} onStart={(type) => onStart(type, 'extra')} headingLevel={3} /> : null}
          {doneExtras.length ? (
            <ul className={st.extras} aria-label={t('today.done.extrasDone')}>
              {doneExtras.map((e) => (
                <li key={e.id} className={st.extra}>
                  <TaskTile human={e.type === 'edge'} />
                  <span className={st.extraText}>
                    <b>{typeName(t, e.type)}.</b> {proofText(t, e)}
                  </span>
                  <button type="button" className={st.textBtn} onClick={() => onOpen(e)}>
                    {t('today.done.reviewShort')}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      </>
    );
  }

  return (
    <div className={st.page}>
      {top}
      <div className={st.aiOrMeSlot}>
        <AiOrMe round={data.aiOrMe} weekHref={weekHref} onPlayed={onPlayed} />
      </div>
    </div>
  );
}

/* ---------- Free ---------- */

export function FreeHub({
  data,
  starting,
  startError,
  onStartTrial,
  onOpen,
  weekHref,
  onPlayed,
  onUnlocked,
}: {
  data: TodayFree;
  starting: boolean;
  startError: string | null;
  onStartTrial: () => void;
  onOpen: (rep: RepView) => void;
  weekHref: string | null;
  onPlayed: (c: NonNullable<AiOrMeRoundFull['completed']>) => void;
  /** Reloads Today after the Business Cup unlock, so it opens as Pro in place. */
  onUnlocked?: () => void;
}) {
  const { t } = useT();
  const trial = data.trial;
  const rep = trial.rep;
  const used = trial.status === 'used';
  const inProgress = trial.status === 'in_progress' && rep && rep.status === 'open';

  const main = used ? (
    <div className={st.freeUsed}>
      <div className={st.hubHead}>
        <h1 className={st.h1}>{t('today.free.usedTitle')}</h1>
        {rep?.result ? (
          <p className={st.hubLead}>
            {proofText(t, rep)}{' '}
            <button type="button" className={st.textBtn} onClick={() => onOpen(rep)}>
              {t('today.done.reviewShort')}
            </button>
          </p>
        ) : null}
      </div>
      <LockedPanel
        title={data.tomorrow ? t('today.free.lockedTitle', { type: typeName(t, data.tomorrow.type) }) : t('today.free.lockedTitleGeneric')}
        reason={data.tomorrow?.taskShort ? `${t('today.free.lockedTask', { task: data.tomorrow.taskShort })} ${t('today.free.lockedReason')}` : t('today.free.lockedReason')}
        action={<PaywallActions onUnlocked={onUnlocked} />}
        shape="list"
      />
    </div>
  ) : (
    <section className={`${st.trial} field`} data-surface="field" aria-labelledby="trial-title">
      <FieldArches className={st.doneArches} />
      <div className={st.trialText}>
        <h1 id="trial-title" className={st.trialTitle}>
          {inProgress ? t('today.free.continueTitle') : t('today.free.waitingTitle')}
        </h1>
        <p className={st.trialBody}>{t('today.free.waitingBody')}</p>
        {startError ? (
          <p className={st.fieldError} role="alert">
            {startError}
          </p>
        ) : null}
        <Button variant="apricot" size="lg" loading={starting} loadingLabel={t('today.choice.starting')} onClick={inProgress && rep ? () => onOpen(rep) : onStartTrial}>
          {inProgress ? t('today.free.continue') : t('today.free.start')}
        </Button>
      </div>
      <div className={st.trialArt} aria-hidden="true">
        <SheetStack className={st.trialSvg} />
      </div>
    </section>
  );

  return (
    <div className={st.page}>
      <div className={st.freeGrid}>
        <div className={st.freeMain}>{main}</div>
        {data.aiOrMe ? (
          <div className={st.freeSide}>
            <AiOrMe round={data.aiOrMe} weekHref={weekHref} onPlayed={onPlayed} compact />
          </div>
        ) : null}
      </div>
    </div>
  );
}
