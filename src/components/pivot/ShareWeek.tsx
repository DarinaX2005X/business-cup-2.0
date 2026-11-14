'use client';

import { Check, Download, Link2, Share2 } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '@/i18n/client';
import { loadCredentials } from '@/lib/client/credentials';
import { useProfile } from '@/lib/client/profile';
import { weekMapShared } from '@/app/(app)/pivot/actions';
import st from './pivot.module.css';

/**
 * «Share my week map» (05.2.2). On a phone it opens the system share sheet; on a computer a small menu:
 * Copy link, Share on LinkedIn, Download image (the share card from /api/og/score). The owner gets
 * `proof_shared` points for sharing (25, at most once a week). Built for the violet conclusion block of the
 * map (`surface="violet"`), also usable on paper.
 *
 * `cardPath` is the card URL from `scoreCardPath(xray)` (src/app/api/og/meta.ts), so the download is the
 * same image LinkedIn shows.
 */
export function ShareWeek({
  xrayId,
  jobTitle,
  isOwner,
  cardPath,
  surface = 'violet',
  className,
}: {
  xrayId: string;
  jobTitle: string;
  isOwner: boolean;
  cardPath: string;
  surface?: 'violet' | 'paper';
  className?: string;
}) {
  const { t } = useT();
  const { applyAwards } = useProfile();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const menuId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const url = () => `${window.location.origin}/x/${xrayId}`;

  const reward = () => {
    if (!isOwner) return;
    const creds = loadCredentials();
    if (!creds) return;
    weekMapShared(creds, xrayId)
      .then((res) => {
        if (res.ok) applyAwards(res.pointsAwarded, trigger.current);
      })
      .catch(() => undefined);
  };

  const close = (focus = true) => {
    setOpen(false);
    if (focus) trigger.current?.focus();
  };

  const onTrigger = async () => {
    // Phones get the system sheet; the menu is for pointers.
    if (typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches) {
      try {
        await navigator.share({ title: jobTitle, text: t('pivot.share.text'), url: url() });
        reward();
      } catch {
        // the person closed the sheet
      }
      return;
    }
    setOpen((o) => !o);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url());
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
      reward();
    } catch {
      // clipboard blocked: nothing to undo
    }
    close();
  };

  // Close on outside click and on Escape; move focus into the menu when it opens.
  useEffect(() => {
    if (!open) return;
    const first = menu.current?.querySelector<HTMLElement>('[role="menuitem"]');
    first?.focus();
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !trigger.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(menu.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = (i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  const label = copied ? t('pivot.share.copied') : isOwner ? t('pivot.share.button') : t('pivot.share.buttonGuest');

  return (
    <span className={`${st.share} ${className ?? ''}`} data-surface={surface}>
      <button
        ref={trigger}
        type="button"
        className={st.shareBtn}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => void onTrigger()}
      >
        {copied ? <Check size={18} strokeWidth={2} aria-hidden="true" /> : <Share2 size={18} strokeWidth={1.75} aria-hidden="true" />}
        <span aria-live="polite">{label}</span>
      </button>
      {open ? (
        <div ref={menu} id={menuId} role="menu" aria-label={t('pivot.share.menu')} className={st.shareMenu} onKeyDown={onMenuKey}>
          <button type="button" role="menuitem" className={st.shareItem} onClick={() => void copy()}>
            <Link2 size={18} strokeWidth={1.75} aria-hidden="true" />
            {t('pivot.share.copy')}
          </button>
          <a
            role="menuitem"
            className={st.shareItem}
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url())}`}
            target="_blank"
            rel="noreferrer"
            onClick={() => {
              reward();
              close(false);
            }}
          >
            <LinkedInGlyph />
            {t('pivot.share.linkedin')}
          </a>
          <a
            role="menuitem"
            className={st.shareItem}
            href={`${cardPath}${cardPath.includes('?') ? '&' : '?'}download=1`}
            download
            onClick={() => {
              reward();
              close(false);
            }}
          >
            <Download size={18} strokeWidth={1.75} aria-hidden="true" />
            {t('pivot.share.download')}
          </a>
        </div>
      ) : null}
    </span>
  );
}

/** LinkedIn's «in» as a plain glyph in the text colour (no brand colour or logo tile). */
function LinkedInGlyph() {
  return (
    <svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">
      <rect x="1.5" y="1.5" width="15" height="15" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <path d="M5.6 7.6v5M5.6 5.2v.1M8.6 12.6V9.9c0-1.4.8-2.3 2-2.3s1.8.8 1.8 2.2v2.8M8.6 7.6v5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    </svg>
  );
}
