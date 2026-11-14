'use client';

import { BookOpenText, CalendarRange, Layers, ListChecks, ScanSearch, Signpost, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { FieldArches, SheetStack } from '@/components/kit/Illustration';
import { StreakWeek, Coin } from '@/components/kit/Points';
import { ScoreDial } from '@/components/kit/ScoreDial';
import btn from '@/components/kit/controls.module.css';
import { useShellRoutes } from '@/components/shell/AppShell';
import { streakWeekOf, type AccountSnapshot } from '@/components/shell/account';
import { useAccount } from '@/components/shell/HeaderAccount';
import { LevelStone } from '@/components/shell/ShellMenus';
import { loadToday, type Hub } from '@/components/today/api';
import { nextReward, rewardById } from '@/domain/points';
import type { RepType } from '@/domain/types';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import { ChoiceCards, CoachBubbles, WeekCard } from './Art';
import st from './home.module.css';

type T = ReturnType<typeof useT>['t'];

/* ---------- the greeting, by the person's local time ---------- */

type DayPart = 'morning' | 'afternoon' | 'evening';
const partOf = (h: number): DayPart => (h >= 5 && h < 12 ? 'morning' : h >= 12 && h < 17 ? 'afternoon' : 'evening');
function hourIn(tz: string): number | null {
  try {
    return Number(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(new Date()));
  } catch {
    return null;
  }
}
const everyMinute = (cb: () => void) => {
  const id = window.setInterval(cb, 60_000);
  return () => window.clearInterval(id);
};

/** The local part of the day; the server's first paint uses the profile's stored time zone. */
function useDayPart(tz: string | null): DayPart | null {
  return useSyncExternalStore(
    everyMinute,
    () => partOf(new Date().getHours()),
    () => {
      const h = tz ? hourIn(tz) : null;
      return h === null ? null : partOf(h);
    },
  );
}

/* ---------- data ---------- */

interface PlanSummary {
  status: 'ready' | 'none';
  currentWeek: number;
  weekDone: number;
  weekTotal: number;
  next: { id: string; text: string } | null;
  locked: boolean;
}

function usePlanSummary(xrayId: string | null, ready: boolean) {
  const [plan, setPlan] = useState<PlanSummary | null>(null);
  useEffect(() => {
    if (!xrayId || !ready) return;
    let off = false;
    apiFetch<PlanSummary>(`/api/plan/progress?xray=${encodeURIComponent(xrayId)}`)
      .then((p) => {
        if (!off && p && (p.status === 'ready' || p.status === 'none')) setPlan(p);
      })
      .catch(() => undefined); // no plan service: the tile stays hidden
    return () => {
      off = true;
    };
  }, [xrayId, ready]);
  return plan;
}

/* ---------- today's banner ---------- */

interface Banner {
  title: string;
  body?: string;
  meta?: string;
  cta?: { href: string; label: string };
  retry?: boolean;
  secondary?: { href: string; label: string };
  art: 'sheets' | 'cards';
}

function repTitle(t: T, type: RepType, task: string) {
  return t(type === 'delegate' ? 'home.today.delegateTitle' : type === 'edge' ? 'home.today.edgeTitle' : 'home.today.slipTitle', { task });
}

function bannerOf(t: T, hub: Hub): Banner {
  if (hub.kind === 'error' || hub.kind === 'noMap') {
    return { title: t('home.today.errorTitle'), body: t('home.today.errorBody'), retry: true, art: 'sheets' };
  }
  if (hub.kind === 'free') {
    const d = hub.data;
    if (d.trial.status === 'available') {
      return { title: t('home.today.trialTitle'), body: t('home.today.trialBody'), cta: { href: '/today?trial=1', label: t('home.today.trialStart') }, art: 'sheets' };
    }
    if (d.trial.status === 'in_progress') {
      return { title: t('home.today.trialTitle'), body: t('home.today.trialBody'), cta: { href: '/today?trial=1', label: t('home.today.trialContinue') }, art: 'sheets' };
    }
    const done = d.aiOrMe?.completed;
    return {
      title: done ? t('home.today.aiOrMeDoneTitle') : t('home.today.aiOrMeTitle'),
      body: done ? t('home.today.aiOrMeDoneBody', { right: done.right, total: done.total }) : t('home.today.aiOrMeBody'),
      cta: done ? undefined : { href: '/today', label: t('home.today.aiOrMePlay') },
      secondary: { href: '/pricing', label: t('home.today.upgrade') },
      art: 'cards',
    };
  }
  const d = hub.data;
  if (d.status === 'generating' && d.repId) {
    return { title: t('home.today.generatingTitle'), body: t('home.today.generatingBody'), cta: { href: `/today?rep=${encodeURIComponent(d.repId)}`, label: t('home.today.open') }, art: 'sheets' };
  }
  if (d.daily) {
    const rep = d.daily;
    const type = t(`today.choice.${rep.type}.name`);
    if (rep.status !== 'done') {
      return { title: repTitle(t, rep.type, rep.taskShort), meta: type, cta: { href: `/today?rep=${encodeURIComponent(rep.id)}`, label: t('home.today.continue') }, art: 'sheets' };
    }
    return {
      title: t('home.today.doneTitle'),
      body: d.tomorrow?.taskShort ? t('home.today.doneBody', { task: d.tomorrow.taskShort }) : t('home.today.doneBodyNoTask'),
      cta: d.extrasLeft > 0 ? { href: '/today', label: t('home.today.practise') } : { href: `/today?rep=${encodeURIComponent(rep.id)}`, label: t('home.today.review') },
      art: 'sheets',
    };
  }
  const pick = d.choiceTasks?.slip ?? Object.values(d.choiceTasks ?? {})[0];
  if (!pick) return { title: t('home.today.genericTitle'), cta: { href: '/today', label: t('home.today.start') }, art: 'sheets' };
  return {
    title: repTitle(t, pick.type, pick.taskShort),
    meta: t('home.today.meta', { type: t(`today.choice.${pick.type}.name`), minutes: pick.minutes }),
    cta: { href: '/today', label: t('home.today.start') },
    secondary: { href: '/today', label: t('home.today.others') },
    art: 'sheets',
  };
}

function TodayBanner({ hub, onRetry }: { hub: Hub | null; onRetry: () => void }) {
  const { t } = useT();
  const b = hub ? bannerOf(t, hub) : null;
  return (
    <section className={`${st.banner} field`} data-surface="field" aria-labelledby="home-today" aria-busy={!b || undefined}>
      <FieldArches className={st.arches} />
      <div className={st.bannerText}>
        {b ? (
          <>
            <h2 id="home-today" className={st.bannerTitle}>
              {b.title}
            </h2>
            {b.meta ? <p className={st.bannerMeta}>{b.meta}</p> : null}
            {b.body ? <p className={st.bannerBody}>{b.body}</p> : null}
            <div className={st.bannerActions}>
              {b.cta ? (
                <Link href={b.cta.href} className={`${btn.btn} ${btn.b_apricot} ${btn.s_lg}`}>
                  {b.cta.label}
                </Link>
              ) : null}
              {b.retry ? (
                <button type="button" className={`${btn.btn} ${btn.b_lavender} ${btn.s_lg}`} onClick={onRetry}>
                  {t('home.today.retry')}
                </button>
              ) : null}
              {b.secondary ? (
                <Link href={b.secondary.href} className={st.fieldLink}>
                  {b.secondary.label}
                </Link>
              ) : null}
            </div>
          </>
        ) : (
          <>
            <h2 id="home-today" className="sr-only">
              {t('home.today.loading')}
            </h2>
            <span className={st.skelTitle} aria-hidden="true" />
            <span className={st.skelTitle} data-short="" aria-hidden="true" />
            <span className={st.skelBtn} aria-hidden="true" />
          </>
        )}
      </div>
      <div className={st.bannerArt} aria-hidden="true">
        {b?.art === 'cards' ? <ChoiceCards className={st.artSvg} /> : <SheetStack className={st.artSvg} />}
      </div>
    </section>
  );
}

/* ---------- the smaller cards ---------- */

function CoachCard({ tier }: { tier: AccountSnapshot['tier'] }) {
  const { t } = useT();
  return (
    <Link href="/coach" className={st.coach} aria-labelledby="home-coach">
      <div className={st.coachArt} aria-hidden="true">
        <CoachBubbles className={st.coachSvg} />
      </div>
      <div className={st.coachText}>
        <h2 id="home-coach" className={st.cardTitle}>
          {t('home.coach.title')}
        </h2>
        <p className={st.cardBody}>{t('home.coach.body')}</p>
        <span className={st.coachFoot}>
          <span className={`${btn.btn} ${btn.b_primary} ${btn.s_sm}`}>{t('home.coach.open')}</span>
          {tier !== 'coach' ? <span className={st.tierTag}>{t('home.coach.tier')}</span> : null}
        </span>
      </div>
    </Link>
  );
}

function PlanCard({ plan, xrayId }: { plan: PlanSummary; xrayId: string }) {
  const { t } = useT();
  const href = `/x/${xrayId}?tab=plan`;
  if (plan.status === 'none') {
    return (
      <Link href={href} className={st.tile}>
        <h2 className={st.cardTitle}>{t('home.plan.title')}</h2>
        <WeekTiles current={0} />
        <p className={st.cardBody}>{t('home.plan.noneBody')}</p>
        <span className={st.tileLink}>{t('home.plan.noneCta')}</span>
      </Link>
    );
  }
  const week = Math.min(12, Math.max(1, plan.currentWeek));
  return (
    <Link href={href} className={st.tile}>
      <h2 className={st.cardTitle}>{t('home.plan.week', { week })}</h2>
      <WeekTiles current={week} fill={plan.weekTotal ? plan.weekDone / plan.weekTotal : 0} label={t('home.plan.tiles', { week })} />
      <p className={st.cardStrong}>{t('home.plan.weekDone', { done: plan.weekDone, total: plan.weekTotal })}</p>
      {plan.next ? <p className={st.cardBody}>{t('home.plan.next', { text: plan.next.text })}</p> : null}
      <span className={st.tileLink}>{t('home.plan.open')}</span>
    </Link>
  );
}

/** Twelve week tiles: weeks behind, this week filling up as its items are checked, weeks ahead. */
function WeekTiles({ current, fill = 0, label }: { current: number; fill?: number; label?: string }) {
  return (
    <ol className={st.weeks} aria-label={label} aria-hidden={label ? undefined : true}>
      {Array.from({ length: 12 }, (_, n) => {
        const w = n + 1;
        const state = w < current ? 'past' : w === current ? 'now' : 'ahead';
        return <li key={w} data-state={state} style={w === current ? ({ '--fill': `${Math.round(fill * 100)}%` } as React.CSSProperties) : undefined} />;
      })}
    </ol>
  );
}

function StreakCard({ account }: { account: AccountSnapshot }) {
  const { t } = useT();
  const week = streakWeekOf(account.streakDays, account.createdAt);
  const lv = account.level;
  const span = lv.nextAt !== null ? lv.nextAt - lv.levelAt : 1;
  const pct = lv.nextAt !== null ? Math.min(100, Math.max(3, ((lv.xp - lv.levelAt) / span) * 100)) : 100;
  return (
    <div className={st.tile} data-static="">
      <Link href="/progress" className={st.tileHead}>
        <h2 className={st.cardTitle}>{t('home.streak.title')}</h2>
        <span className={st.cardStrong}>{t('home.streak.body', { count: week.count })}</span>
      </Link>
      <Link href="/progress" className={st.streak} data-since={week.since || undefined} tabIndex={-1} aria-hidden="true">
        <StreakWeek done={week.done} today={week.today} count={week.count} />
      </Link>
      <Link href="/leaderboard" className={st.levelRow}>
        <LevelStone level={lv.level} size={34} />
        <span className={st.levelText}>
          <b>{t('home.streak.level', { level: lv.level, name: lv.levelName })}</b>
          <span className={st.meter} aria-hidden="true">
            <i style={{ width: `${pct}%` }} />
          </span>
          <small>{lv.nextAt !== null ? t('home.streak.toNext', { count: lv.nextAt - lv.xp, level: lv.level + 1 }) : t('home.streak.top')}</small>
        </span>
      </Link>
    </div>
  );
}

function RewardCard({ balance }: { balance: number }) {
  const { t, f } = useT();
  const next = nextReward(balance);
  const reward = next ? rewardById(next.rewardId) : null;
  if (!next || !reward) {
    return (
      <Link href="/shop" className={st.tile}>
        <h2 className={st.cardTitle}>{t('home.reward.ready')}</h2>
        <p className={st.cardBody}>{t('home.reward.readyBody', { balance: f.number(balance) })}</p>
        <span className={st.tileLink}>{t('home.reward.open')}</span>
      </Link>
    );
  }
  const pct = Math.min(100, Math.max(3, (balance / next.cost) * 100));
  return (
    <Link href="/shop" className={st.tile}>
      <h2 className={st.cardTitle}>{t('home.reward.title')}</h2>
      <div className={st.voucher}>
        <div className={st.voucherTop}>
          <b>{t(reward.titleKey)}</b>
        </div>
        <div className={st.voucherStub}>
          <Coin size={16} />
          <span>{t('home.reward.cost', { cost: f.number(next.cost) })}</span>
        </div>
      </div>
      <span className={st.meter} role="img" aria-label={t('home.reward.progress', { balance: f.number(balance), cost: f.number(next.cost) })}>
        <i style={{ width: `${pct}%` }} />
      </span>
      <p className={st.cardStrong}>{t('home.reward.need', { count: f.number(next.need) })}</p>
    </Link>
  );
}

/* ---------- quick links: app-style tiles ---------- */

function QuickLinks({ xrayId, pages }: { xrayId: string; pages: string[] }) {
  const { t } = useT();
  const x = (tab: string) => `/x/${xrayId}?tab=${tab}`;
  const items: { id: string; href: string; icon: LucideIcon; tone: 'machine' | 'human' | 'violet'; show: boolean }[] = [
    { id: 'tasks', href: x('tasks'), icon: ListChecks, tone: 'machine', show: true },
    { id: 'plan', href: x('plan'), icon: CalendarRange, tone: 'human', show: true },
    { id: 'skills', href: x('skills'), icon: Layers, tone: 'violet', show: true },
    { id: 'next', href: x('next'), icon: Signpost, tone: 'violet', show: true },
    { id: 'playbook', href: '/playbook', icon: BookOpenText, tone: 'human', show: pages.includes('playbook') },
    { id: 'secondLook', href: '/second-look', icon: ScanSearch, tone: 'machine', show: pages.includes('secondLook') },
  ];
  return (
    <section className={st.links} aria-labelledby="home-links">
      <h2 id="home-links" className={st.linksTitle}>
        {t('home.links.title')}
      </h2>
      <ul>
        {items
          .filter((i) => i.show)
          .map(({ id, href, icon: Icon, tone }) => (
            <li key={id}>
              <Link href={href} className={st.link}>
                <span className={st.appIcon} data-tone={tone} aria-hidden="true">
                  <Icon size={22} strokeWidth={1.9} />
                </span>
                <span className={st.linkText}>
                  <b>{t(`home.links.${id}`)}</b>
                  <span>{t(`home.links.${id}Body`)}</span>
                </span>
              </Link>
            </li>
          ))}
      </ul>
    </section>
  );
}

/* ---------- no week map yet: one clear start ---------- */

function MapStart({ greeting }: { greeting: ReactNode }) {
  const { t } = useT();
  return (
    <div className={st.page}>
      {greeting}
      <section className={`${st.banner} ${st.startBanner} field`} data-surface="field" aria-labelledby="home-start">
        <FieldArches className={st.arches} />
        <div className={st.bannerText}>
          <h2 id="home-start" className={st.bannerTitle}>
            {t('home.start.title')}
          </h2>
          <p className={st.bannerBody}>{t('home.start.body')}</p>
          <div className={st.bannerActions}>
            <Link href="/start" className={`${btn.btn} ${btn.b_apricot} ${btn.s_lg}`}>
              {t('home.start.cta')}
            </Link>
            <Link href="/start?sample=nurse" className={st.fieldLink}>
              {t('home.start.sample')}
            </Link>
          </div>
        </div>
        <div className={st.bannerArt} aria-hidden="true">
          <WeekCard className={st.artSvg} beamClassName={st.beam} />
        </div>
      </section>
    </div>
  );
}

/* ---------- the screen ---------- */

export function HomeScreen() {
  const { t } = useT();
  const shell = useShellRoutes();
  const account = useAccount(shell.account);
  const { status, lastScore } = useProfile();
  const part = useDayPart(account?.tz ?? null);
  const xrayId = account?.lastXrayId ?? null;
  const ready = status === 'ready';
  const [hub, setHub] = useState<Hub | null>(null);
  const plan = usePlanSummary(xrayId, ready);

  const load = useCallback(() => {
    setHub(null);
    void loadToday().then(setHub);
  }, []);
  useEffect(() => {
    if (ready && xrayId) load();
  }, [ready, xrayId, load]);

  const name = account?.nickname;
  const hello = part ? (name ? t('home.greeting.named', { greeting: t(`home.greeting.${part}`), name }) : t(`home.greeting.${part}`)) : null;
  const job = account?.jobTitle;

  const greeting = (
    <header className={st.greet}>
      <div className={st.greetText}>
        <p className={st.hello} data-pending={hello ? undefined : ''}>
          {hello ?? ' '}
        </p>
        <h1 className={st.title}>
          {job ? (
            <>
              {t('home.title', { job: '\u0000' }).split('\u0000')[0]}
              <span className={st.plate}>{job}</span>
              {t('home.title', { job: '\u0000' }).split('\u0000')[1]}
            </>
          ) : (
            t('home.titleNoJob')
          )}
        </h1>
      </div>
      {xrayId && lastScore !== null ? (
        <Link href={`/x/${xrayId}`} className={st.score}>
          <ScoreDial value={lastScore} variant="compact" size={64} />
          <span className={st.scoreLink}>{t('home.score.open')}</span>
        </Link>
      ) : null}
    </header>
  );

  if (account === undefined) {
    return (
      <div className={st.page} aria-busy="true">
        <span className={st.skelLine} />
      </div>
    );
  }
  if (!account || !xrayId) return <MapStart greeting={greeting} />;

  const coach = shell.sections.includes('coach');
  return (
    <div className={st.page}>
      {greeting}
      <div className={st.row} data-coach={coach || undefined}>
        <TodayBanner hub={hub} onRetry={load} />
        {coach ? <CoachCard tier={account.tier} /> : null}
      </div>
      <div className={st.tiles}>
        {plan ? <PlanCard plan={plan} xrayId={xrayId} /> : null}
        <StreakCard account={account} />
        <RewardCard balance={account.balance} />
      </div>
      <QuickLinks xrayId={xrayId} pages={shell.pages} />
    </div>
  );
}
