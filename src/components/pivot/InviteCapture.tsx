'use client';

import { useEffect } from 'react';
import { apiFetch, ApiError } from '@/lib/client/api';
import { useOptionalProfile } from '@/lib/client/profile';

/**
 * Picks up an invite link (`/?ref=<code>`) on any page. Mount once inside <ProfileProvider> (AppProviders).
 *
 * - The code goes to localStorage `irr_invite`, which `createOnce` (src/lib/client/profile.tsx) already sends
 *   as `invitedBy` when the profile is created, and `ref` leaves the address bar.
 * - A browser that already has a profile accepts the invite at once (POST /api/invite/accept); one that gets
 *   its profile later accepts it as soon as the profile is there, unless creation already linked it.
 * - Your own link does nothing: the codes this browser received as its own (`irr_invite_own`) are ignored,
 *   and the server refuses a profile's own code too.
 */

const PENDING = 'irr_invite';
const OWN = 'irr_invite_own';
const CODE_RE = /^[0-9A-Za-z]{10}$/;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage blocked: the invite simply does not carry over
  }
}

/** Remembers a code as this browser's own, so opening one's own link never counts. */
export function rememberOwnInvite(code: string) {
  const own = (read(OWN) ?? '').split(',').filter(Boolean);
  if (!own.includes(code)) write(OWN, [...own, code].slice(-5).join(','));
  if (read(PENDING) === code) write(PENDING, null);
}

const isOwn = (code: string) => (read(OWN) ?? '').split(',').includes(code);

export function InviteCapture() {
  const ctx = useOptionalProfile();
  const status = ctx?.status;
  const invitedBy = ctx?.profile?.invitedBy;
  const profileId = ctx?.profile?.id;

  // 1. Take `ref` from the address once.
  useEffect(() => {
    const url = new URL(window.location.href);
    const ref = url.searchParams.get('ref');
    if (ref === null) return;
    url.searchParams.delete('ref');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    if (CODE_RE.test(ref) && !isOwn(ref)) write(PENDING, ref);
  }, []);

  // 2. Link the profile once it exists.
  useEffect(() => {
    if (status !== 'ready' || !profileId) return;
    const code = read(PENDING);
    if (!code) return;
    if (invitedBy || isOwn(code)) {
      write(PENDING, null);
      return;
    }
    let cancelled = false;
    apiFetch('/api/invite/accept', { method: 'POST', body: { ref: code } })
      .then(() => {
        if (!cancelled) {
          write(PENDING, null);
          void ctx?.refresh();
        }
      })
      .catch((err) => {
        // A final answer (own link, too late, unknown, already linked) clears it; a network error keeps it for next time.
        if (!cancelled && err instanceof ApiError && err.status >= 400 && err.status < 500) write(PENDING, null);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, profileId, invitedBy]);

  return null;
}
