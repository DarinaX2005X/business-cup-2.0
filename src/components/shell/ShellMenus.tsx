'use client';

import { Check, ChevronDown, Copy, Languages, UserRound, Volume2, VolumeX } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Sheet } from '@/components/kit/Overlay';
import { useT } from '@/i18n/client';
import { localeNames, locales, type Locale } from '@/i18n/config';
import { useProfile } from '@/lib/client/profile';
import st from './shell.module.css';

/* ---------- a small popover menu: opens under its trigger, Escape and outside click close it ---------- */

function usePopover() {
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
    // focus the checked item, else the first one
    const panel = root.current?.querySelector<HTMLElement>('[role="menu"]');
    (panel?.querySelector<HTMLElement>('[aria-checked="true"]') ?? panel?.querySelector<HTMLElement>('[role^="menuitem"]'))?.focus();
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

/* ---------- language ---------- */

function useSwitchLocale() {
  const { setLocale } = useT();
  const { status, profile, update } = useProfile();
  return async (next: Locale) => {
    await setLocale(next);
    if (status === 'ready' && profile?.locale !== next) update({ locale: next }).catch(() => undefined);
  };
}

export function LocaleMenu() {
  const { locale, t, switching } = useT();
  const choose = useSwitchLocale();
  const { open, setOpen, close, root, trigger } = usePopover();
  const id = useId();
  return (
    <div className={st.pop} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={st.chipBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`${t('shell.language')}: ${localeNames[locale]}`}
        disabled={switching}
        onClick={() => setOpen((o) => !o)}
      >
        <Languages size={18} strokeWidth={1.75} aria-hidden="true" />
        <span>{locale.toUpperCase()}</span>
        <ChevronDown size={16} strokeWidth={1.75} aria-hidden="true" className={st.chev} />
      </button>
      {open ? (
        <div id={id} role="menu" aria-label={t('shell.language')} className={st.menu} onKeyDown={onMenuKeys}>
          {locales.map((l) => (
            <button
              key={l}
              type="button"
              role="menuitemradio"
              aria-checked={l === locale}
              lang={l}
              className={st.menuItem}
              onClick={() => {
                close();
                void choose(l);
              }}
            >
              <span>{localeNames[l]}</span>
              {l === locale ? <Check size={18} strokeWidth={2} aria-hidden="true" /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------- profile: restore link and sound ---------- */

function ProfileItems({ onDone, inSheet }: { onDone?: () => void; inSheet?: boolean }) {
  const { t } = useT();
  const { profile, update, restoreLink } = useProfile();
  const [copied, setCopied] = useState(false);
  const sound = profile?.sound ?? false;
  const role = inSheet ? undefined : 'menuitem';
  return (
    <>
      <button
        type="button"
        role={role}
        className={st.menuItem}
        onClick={() => {
          const link = restoreLink();
          if (!link) return;
          void navigator.clipboard?.writeText(link).catch(() => undefined);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        }}
      >
        <span className={st.itemMain}>
          {copied ? <Check size={18} strokeWidth={2} aria-hidden="true" /> : <Copy size={18} strokeWidth={1.75} aria-hidden="true" />}
          <span>
            <b>{copied ? t('shell.copied') : t('shell.restore')}</b>
            <small>{t('shell.restoreHint')}</small>
          </span>
        </span>
      </button>
      <button
        type="button"
        role={inSheet ? 'switch' : 'menuitemcheckbox'}
        aria-checked={sound}
        className={st.menuItem}
        onClick={() => {
          update({ sound: !sound }).catch(() => undefined);
          onDone?.();
        }}
      >
        <span className={st.itemMain}>
          {sound ? <Volume2 size={18} strokeWidth={1.75} aria-hidden="true" /> : <VolumeX size={18} strokeWidth={1.75} aria-hidden="true" />}
          <b>{t('shell.sound')}</b>
        </span>
        <span className={st.toggle} data-on={sound || undefined} aria-hidden="true" />
      </button>
    </>
  );
}

export function ProfileMenu() {
  const { t } = useT();
  const { open, setOpen, close, root, trigger } = usePopover();
  const id = useId();
  return (
    <div className={st.pop} ref={root}>
      <button
        ref={trigger}
        type="button"
        className={st.avatar}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('shell.profile')}
        onClick={() => setOpen((o) => !o)}
      >
        <UserRound size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      {open ? (
        <div id={id} role="menu" aria-label={t('shell.profile')} className={`${st.menu} ${st.menuWide}`} onKeyDown={onMenuKeys}>
          <ProfileItems onDone={() => close(false)} />
        </div>
      ) : null}
    </div>
  );
}

/** Narrow screens: one avatar button opens a sheet with language and profile. */
export function AccountSheetButton({ hasProfile, extra }: { hasProfile: boolean; extra?: ReactNode }) {
  const { t, locale, switching } = useT();
  const choose = useSwitchLocale();
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      <button type="button" className={st.avatar} aria-label={t('shell.account')} aria-haspopup="dialog" onClick={() => setOpen(true)}>
        <UserRound size={20} strokeWidth={1.75} aria-hidden="true" />
      </button>
      <Sheet open={open} onClose={close} title={t('shell.account')}>
        <div className={st.sheetBody}>
          {extra}
          <div role="radiogroup" aria-label={t('shell.language')} className={st.langRow}>
            {locales.map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={l === locale}
                lang={l}
                disabled={switching}
                className={st.langOpt}
                onClick={() => void choose(l)}
              >
                {localeNames[l]}
              </button>
            ))}
          </div>
          {hasProfile ? (
            <div className={st.sheetItems}>
              <ProfileItems inSheet />
            </div>
          ) : null}
        </div>
      </Sheet>
    </>
  );
}
