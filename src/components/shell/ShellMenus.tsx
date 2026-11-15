'use client';

import { CircleHelp, CircleUserRound, CreditCard, ListOrdered, LogOut, Ruler, SlidersHorizontal } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/kit/Overlay';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { ACCOUNT_LINKS, initialOf, type AccountSnapshot, type TierBadge as Tier } from './account';
import st from './shell.module.css';

/* ---------- a small popover menu: opens under its trigger, Escape and outside click close it ---------- */

export function usePopover() {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  }, []);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    root.current?.querySelector<HTMLElement>('[role="menu"] [role^="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);
  return { open, setOpen, close, root, trigger };
}

/** Arrow keys move between items of a role="menu" panel. */
function onMenuKeys(e: React.KeyboardEvent<HTMLElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
  const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]'));
  const i = items.indexOf(document.activeElement as HTMLElement);
  e.preventDefault();
  const n = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  items[n]?.focus();
}

/* ---------- small pieces: avatar, tier badge, level keystone ---------- */

/** The person's disc: the first letter of their leaderboard name, ringed by their plan. */
export function Avatar({ snapshot, size = 40 }: { snapshot: Pick<AccountSnapshot, 'handle' | 'tier'>; size?: number }) {
  return (
    <span className={st.avatarDisc} data-tier={snapshot.tier} style={{ width: size, height: size, fontSize: Math.round(size * 0.42) }} aria-hidden="true">
      {initialOf(snapshot)}
    </span>
  );
}

export function TierBadge({ tier }: { tier: Tier }) {
  const { t } = useT();
  return (
    <span className={st.tier} data-tier={tier}>
      {t(`shell.account.tier.${tier}`)}
    </span>
  );
}

/** The level as a keystone with its number: the stone you set by practising. */
export function LevelStone({ level, size = 26 }: { level: number; size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={st.stone} width={size} height={size} viewBox="0 0 28 28" aria-hidden="true">
      <defs>
        <linearGradient id={`${id}g`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--apricot-hi)" />
          <stop offset=".45" stopColor="var(--apricot)" />
          <stop offset="1" stopColor="var(--apricot-low)" />
        </linearGradient>
      </defs>
      <path d="M3.6 3.5h20.8a1.6 1.6 0 0 1 1.55 2l-5.2 19.3a1.6 1.6 0 0 1-1.55 1.2H8.8a1.6 1.6 0 0 1-1.55-1.2L2.05 5.5a1.6 1.6 0 0 1 1.55-2Z" fill={`url(#${id}g)`} />
      <path d="M4 5h20" stroke="oklch(100% 0 0 / .65)" strokeWidth="1.2" strokeLinecap="round" />
      <text x="14" y="18.6" textAnchor="middle" className={st.stoneN}>
        {level}
      </text>
    </svg>
  );
}

/* ---------- the account panel: the dropdown on wide screens, the lower half of More on phones ---------- */

function AccountPanel({ snapshot: s, inMenu, onDone, onHelp }: { snapshot: AccountSnapshot; inMenu: boolean; onDone: () => void; onHelp: () => void }) {
  const { t } = useT();
  const { signOut } = useProfile();
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);
  const role = inMenu ? 'menuitem' : undefined;
  const name = s.email ?? s.nickname ?? s.handle;

  const item = (href: string, icon: ReactNode, label: string, extra?: ReactNode) => (
    <Link href={href} role={role} className={st.item} onClick={onDone}>
      <span className={st.itemIcon}>{icon}</span>
      <span className={st.itemLabel}>{label}</span>
      {extra}
    </Link>
  );

  const logOut = async () => {
    if (leaving) return;
    setLeaving(true);
    await signOut();
    onDone();
    router.push('/');
  };

  return (
    <>
      {/* only who is signed in and on which plan; the rest lives on Profile */}
      <div className={st.who}>
        <div className={st.whoText}>
          <b>{name}</b>
        </div>
        <TierBadge tier={s.tier} />
      </div>
      {s.demo ? (
        <p className={st.demoNote}>
          <span className={st.demoMark}>{t('shell.demo')}</span>
          <span>{t('auth.demoNote')}</span>
        </p>
      ) : null}

      {s.tier === 'free' ? (
        <Link href={ACCOUNT_LINKS.pricing} role={role} className={`${st.upgrade} field`} data-surface="field" onClick={onDone}>
          <span className={st.upgradeText}>
            <b>{t('shell.account.upgrade')}</b>
            <span>{t('shell.account.upgradeHint')}</span>
          </span>
          <span className={st.upgradeArt} aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </Link>
      ) : null}

      <div className={st.group} role={inMenu ? 'group' : undefined}>
        {item(ACCOUNT_LINKS.profile, <CircleUserRound size={18} strokeWidth={1.75} aria-hidden="true" />, t('shell.account.profile'))}
        {item(ACCOUNT_LINKS.subscription, <CreditCard size={18} strokeWidth={1.75} aria-hidden="true" />, t('shell.account.subscription'), <TierBadge tier={s.tier} />)}
        {item(ACCOUNT_LINKS.settings, <SlidersHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />, t('shell.account.settings'))}
      </div>
      <div className={st.group} role={inMenu ? 'group' : undefined}>
        {item(
          ACCOUNT_LINKS.leaderboard,
          <ListOrdered size={18} strokeWidth={1.75} aria-hidden="true" />,
          t('shell.account.leaderboard'),
          <span className={st.itemMeta}>
            <LevelStone level={s.level.level} size={20} />
          </span>,
        )}
        {item(ACCOUNT_LINKS.method, <Ruler size={18} strokeWidth={1.75} aria-hidden="true" />, t('shell.account.method'))}
      </div>
      <div className={st.group} role={inMenu ? 'group' : undefined}>
        <button
          type="button"
          role={role}
          className={st.item}
          onClick={() => {
            onDone();
            onHelp();
          }}
        >
          <span className={st.itemIcon}>
            <CircleHelp size={18} strokeWidth={1.75} aria-hidden="true" />
          </span>
          <span className={st.itemLabel}>{t('shell.account.help')}</span>
        </button>
      </div>
      <button type="button" role={role} className={`${st.item} ${st.logout}`} onClick={() => void logOut()} aria-busy={leaving || undefined}>
        <span className={st.itemIcon}>
          <LogOut size={18} strokeWidth={1.75} aria-hidden="true" />
        </span>
        <span className={st.itemLabel}>{t('auth.logout')}</span>
      </button>
    </>
  );
}

/* ---------- help ---------- */

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useT();
  const qs = [1, 2, 3, 4, 5];
  return (
    <Dialog open={open} onClose={onClose} title={t('shell.help.title')}>
      <dl className={st.help}>
        {qs.map((n) => (
          <div key={n}>
            <dt>{t(`shell.help.q${n}`)}</dt>
            <dd>{t(`shell.help.a${n}`)}</dd>
          </div>
        ))}
      </dl>
      <Link href={ACCOUNT_LINKS.method} className={st.helpLink} onClick={onClose}>
        {t('shell.help.method')}
      </Link>
    </Dialog>
  );
}

/* ---------- the avatar menu ---------- */

export function AccountMenu({ snapshot }: { snapshot: AccountSnapshot }) {
  const { t } = useT();
  const { open, setOpen, close, root, trigger } = usePopover();
  const [help, setHelp] = useState(false);
  const id = useId();
  return (
    <div className={st.pop} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={st.avatarBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('shell.account.open')}
        onClick={() => setOpen((o) => !o)}
      >
        <Avatar snapshot={snapshot} />
      </button>
      {open ? (
        <div id={id} role="menu" aria-label={t('shell.account.label')} className={st.menu} onKeyDown={onMenuKeys}>
          <AccountPanel snapshot={snapshot} inMenu onDone={() => close(false)} onHelp={() => setHelp(true)} />
        </div>
      ) : null}
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </div>
  );
}

/** The account panel outside a menu (the phone More sheet). Help opens above the closed sheet, so its state lives with the caller. */
export function AccountList({ snapshot, onDone, onHelp }: { snapshot: AccountSnapshot; onDone: () => void; onHelp: () => void }) {
  return <AccountPanel snapshot={snapshot} inMenu={false} onDone={onDone} onHelp={onHelp} />;
}
