'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Locale, PointsAward, Profile } from '@/domain/types';
import { useRouter } from 'next/navigation';
import { useT } from '@/i18n/client';
import { isLocale } from '@/i18n/config';
import { ApiError, apiFetch } from './api';
import {
  clearCredentials,
  clearOrphanCredentials,
  isProfileStorageKey,
  loadCredentials,
  loadOrphanCredentials,
  loadPreviousCredentials,
  orphanCredentials,
  notifyOtherTabs,
  parseCredentialString,
  profileChannel,
  saveCredentials,
  type Credentials,
} from './credentials';

/** The profile as GET /api/profile returns it: no secrets, and the account reduced to its email. */
export type PublicProfile = Omit<Profile, 'secretHash' | 'secretHashes' | 'account'> & { account?: { email: string } | null };
export type ProfilePatch = Partial<Pick<Profile, 'locale' | 'salary' | 'sound' | 'tz' | 'hintsSeen'>>;

// ---------------------------------------------------------------------------------------------
// ensureProfile: create on the first meaningful action, once per browser even with several tabs open

let creating: Promise<Credentials> | null = null;

async function createOnce(locale: Locale): Promise<Credentials> {
  const existing = loadCredentials();
  if (existing) return existing;
  let invitedBy: string | null = null;
  try {
    invitedBy = window.localStorage.getItem('irr_invite');
  } catch {
    invitedBy = null;
  }
  const res = await apiFetch<{ id: string; secret: string }>('/api/profile', {
    method: 'POST',
    profile: null,
    body: { locale, ...(invitedBy ? { invitedBy } : {}) },
  });
  saveCredentials(res);
  return res;
}

/**
 * Returns the browser's profile credentials, creating the profile first if there is none.
 * Concurrent calls (also from other tabs, via the Web Locks API) create exactly one profile.
 */
export function ensureProfile(locale?: Locale): Promise<Credentials> {
  const existing = loadCredentials();
  if (existing) return Promise.resolve(existing);
  const lang = locale ?? (isLocale(document.documentElement.lang) ? (document.documentElement.lang as Locale) : 'en');
  creating ??= (async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.locks) {
        return await navigator.locks.request('irr-profile-create', () => createOnce(lang));
      }
      return await createOnce(lang);
    } finally {
      creating = null;
    }
  })();
  return creating;
}

/**
 * Link that opens this profile on another device or browser: `/#restore=<id>.<secret>`.
 * The secret sits in the fragment, which browsers never send to servers, proxies or logs.
 * (Old `/?restore=` links are still accepted and stripped from the address at once.)
 */
export function restoreLinkFor(creds: Credentials, origin = window.location.origin): string {
  return `${origin}/#restore=${creds.id}.${creds.secret}`;
}

/** Whether a profile holds anything a person would be upset to lose. */
export function hasProgress(p: PublicProfile): boolean {
  return (
    p.xrays.length > 0 ||
    p.reps.length > 0 ||
    p.repLog.length > 0 ||
    p.points.balance > 0 ||
    p.points.events.length > 0 ||
    p.proof.length > 0 ||
    p.redemptions.length > 0 ||
    p.plan.status !== 'free' ||
    Boolean(p.occupationCode)
  );
}

/**
 * Reads `restore=` from the query or the fragment and returns it with the address without it.
 * The caller removes it from the address bar at once (see the mount effect).
 */
function readRestoreParam(): { raw: string; clean: string } | null {
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('restore');
  const hashParams = new URLSearchParams(url.hash.slice(1));
  const fromHash = hashParams.get('restore');
  if (fromQuery === null && fromHash === null) return null;
  url.searchParams.delete('restore');
  hashParams.delete('restore');
  const rest = hashParams.toString();
  url.hash = rest ? `#${rest}` : '';
  return { raw: (fromHash ?? fromQuery)!, clean: `${url.pathname}${url.search}${url.hash}` };
}

// ---------------------------------------------------------------------------------------------
// Provider

/**
 * - `anonymous`: no profile in this browser yet (one is created on the first meaningful action);
 * - `orphaned`: this browser had a profile, but the server no longer recognises it. The credentials are
 *   kept; the UI says "We couldn't find your saved profile on this device" with `retryOrphan()` (Try again)
 *   and `startFresh()` (Start fresh), texts `common.profile.orphaned*`;
 * - `error`: the profile could not be loaded (network or storage), `error` holds the code.
 */
export type ProfileStatus = 'loading' | 'anonymous' | 'ready' | 'orphaned' | 'error';
export type RestoreState = 'pending' | 'restored' | 'invalid' | 'cancelled' | null;

interface ProfileContextValue {
  status: ProfileStatus;
  profile: PublicProfile | null;
  /** Error code when status is 'error' (e.g. 'network', 'storage_unavailable'). */
  error: string | null;
  balance: number;
  streak: Profile['streak'] | null;
  /** Score of the latest week map, null until one exists or while loading it. */
  lastScore: number | null;
  /**
   * Result of a restore link on this page load. `pending`: the link opens another profile while this
   * browser already has one with progress; show `pendingRestore` and ask (texts `common.profile.restoreAsk*`),
   * then call `confirmRestore()` or `cancelRestore()`.
   */
  restore: RestoreState;
  /** The profile the pending restore link would open. */
  pendingRestore: PublicProfile | null;
  confirmRestore(): Promise<void>;
  cancelRestore(): void;
  /** Switches back to the profile used before the last switch; false if there is none or it no longer exists. */
  restorePrevious(): Promise<boolean>;
  hasPrevious(): boolean;
  /** For `orphaned`: tries the kept credentials again; true if the profile is back. */
  retryOrphan(): Promise<boolean>;
  /** For `orphaned`: forgets the unrecognised profile; a new one is created on the next action. */
  startFresh(): void;
  refresh(): Promise<void>;
  /** Creates the profile if needed and returns it. */
  ensure(): Promise<PublicProfile>;
  update(patch: ProfilePatch): Promise<PublicProfile>;
  /** Shows points from a response (`pointsAwarded`): flies them from `originEl` if given, otherwise a toast. */
  applyAwards(awards: PointsAward[] | undefined, originEl?: Element | null): void;
  remove(): Promise<void>;
  restoreLink(): string | null;
  /** The email account this profile belongs to, or null for a guest profile (GET /api/profile `account`). */
  account: { email: string } | null;
  /** Makes these credentials (from log in or a demo account) the active ones and loads that profile. */
  signIn(creds: Credentials): Promise<boolean>;
  /** Logs this device out (POST /api/auth/logout) and forgets the credentials; a new guest is made when needed. */
  signOut(): Promise<void>;
  /** Lets screens that just computed a new map show its score without waiting for a refetch. */
  setLastScore(score: number | null): void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export interface AwardPresenters {
  /** Kit's flyPoints(fromEl, amount). */
  fly?: (fromEl: Element, amount: number) => void;
  /** The receipt under the header counter; receives the awards (labels are shop.earn.* keys). */
  toast?: (awards: PointsAward[]) => void;
}

const REFRESH_ON_FOCUS_MS = 30_000;

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function ProfileProvider({ children, presenters }: { children: ReactNode; presenters?: AwardPresenters }) {
  const { locale } = useT();
  const router = useRouter();
  const [status, setStatus] = useState<ProfileStatus>('loading');
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restore, setRestore] = useState<RestoreState>(null);
  const [pending, setPending] = useState<{ creds: Credentials; profile: PublicProfile } | null>(null);
  const loadedAt = useRef(0);
  const restoreParam = useRef<{ raw: string; clean: string } | null | undefined>(undefined);
  const tzSyncing = useRef(false);
  const seq = useRef(0);

  const accept = useCallback((p: PublicProfile) => {
    setProfile((prev) => (prev && prev.id === p.id && prev.version > p.version ? prev : p));
    setStatus('ready');
    setError(null);
    loadedAt.current = Date.now();
    // Keep the stored time zone current (the server uses it for "today") and move profiles made in RU/KK
    // to English, the only interface language now (generated content follows profile.locale); silent, best-effort.
    const tz = browserTimeZone();
    const patch: ProfilePatch = {};
    if (tz && tz !== p.tz) patch.tz = tz;
    if (p.locale !== 'en') patch.locale = 'en';
    if (Object.keys(patch).length && !tzSyncing.current) {
      tzSyncing.current = true;
      apiFetch<PublicProfile>('/api/profile', { method: 'PATCH', body: patch })
        .then((np) => setProfile((prev) => (prev && prev.id === np.id && prev.version > np.version ? prev : np)))
        .catch(() => undefined)
        .finally(() => {
          tzSyncing.current = false;
        });
    }
  }, []);

  const refresh = useCallback(async () => {
    const creds = loadCredentials();
    const mySeq = ++seq.current;
    if (!creds) {
      setProfile(null);
      setStatus(loadOrphanCredentials() ? 'orphaned' : 'anonymous');
      return;
    }
    try {
      const p = await apiFetch<PublicProfile>('/api/profile', { profile: creds });
      if (mySeq !== seq.current) return; // a newer refresh (or account switch) won
      accept(p);
    } catch (err) {
      if (mySeq !== seq.current) return;
      if (err instanceof ApiError && err.status === 401) {
        // The server does not recognise these credentials. Keep them aside (never wipe silently) and let the person decide.
        orphanCredentials(creds);
        setProfile(null);
        setStatus('orphaned');
        return;
      }
      setError(err instanceof ApiError ? err.code : 'network');
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
    }
  }, [accept]);

  // First load, including a restore link (`#restore=<id>.<secret>`, or the older `?restore=`).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Read once per mount and keep it in a ref: in development React runs this effect twice, and the
      // first run (cancelled) has already removed the parameter from the address.
      if (restoreParam.current === undefined) restoreParam.current = readRestoreParam();
      const param = restoreParam.current;
      const raw = param?.raw ?? null;
      if (param) {
        // Drop the secret from the address bar now. The history entry is replaced both directly and through
        // the router, because Next's router writes its own initial URL after this child effect has run.
        window.history.replaceState(window.history.state, '', param.clean);
        router.replace(param.clean, { scroll: false });
      }
      if (raw !== null) {
        const creds = parseCredentialString(raw);
        try {
          if (!creds) throw new ApiError('unauthorized', 401, 'malformed restore link');
          const target = await apiFetch<PublicProfile>('/api/profile', { profile: creds });
          if (cancelled) return;
          // a profile with an account is opened by logging in, never by a link
          if (target.account) throw new ApiError('unauthorized', 401, 'restore links open guest profiles only');
          const current = loadCredentials();
          if (current && current.id !== creds.id) {
            // Another profile is active here: switching always asks first.
            let currentProfile: PublicProfile | null = null;
            try {
              currentProfile = await apiFetch<PublicProfile>('/api/profile', { profile: current });
            } catch {
              currentProfile = null;
            }
            if (cancelled) return;
            setPending({ creds, profile: target });
            setRestore('pending');
            if (currentProfile) accept(currentProfile);
            else await refresh();
            return;
          }
          saveCredentials(creds); // replaced credentials stay recoverable via restorePrevious()
          accept(target);
          setRestore('restored');
          return;
        } catch (err) {
          if (cancelled) return;
          if (!(err instanceof ApiError) || err.status !== 401) {
            setError(err instanceof ApiError ? err.code : 'network');
          }
          setRestore('invalid');
        }
      }
      if (!cancelled) await refresh();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTo = useCallback(
    async (creds: Credentials, known?: PublicProfile): Promise<boolean> => {
      try {
        const p = known ?? (await apiFetch<PublicProfile>('/api/profile', { profile: creds }));
        seq.current++;
        saveCredentials(creds); // the profile being left moves to the "previous" slot
        accept(p);
        return true;
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return false;
        setError(err instanceof ApiError ? err.code : 'network');
        return false;
      }
    },
    [accept],
  );

  const confirmRestore = useCallback(async () => {
    if (!pending) return;
    const { creds, profile: target } = pending;
    setPending(null);
    await switchTo(creds, target);
    setRestore('restored');
  }, [pending, switchTo]);

  const cancelRestore = useCallback(() => {
    setPending(null);
    setRestore('cancelled');
  }, []);

  const restorePrevious = useCallback(async () => {
    const prev = loadPreviousCredentials();
    return prev && prev.id !== loadCredentials()?.id ? switchTo(prev) : false;
  }, [switchTo]);

  const hasPrevious = useCallback(() => {
    const prev = loadPreviousCredentials();
    return Boolean(prev && prev.id !== loadCredentials()?.id);
  }, []);

  const retryOrphan = useCallback(async () => {
    const orphan = loadOrphanCredentials();
    if (!orphan) return false;
    const ok = await switchTo(orphan);
    if (ok) clearOrphanCredentials();
    return ok;
  }, [switchTo]);

  const startFresh = useCallback(() => {
    clearOrphanCredentials();
    if (!loadCredentials()) {
      setProfile(null);
      setStatus('anonymous');
    }
  }, []);

  // Other tabs: storage event (credentials changed) and broadcast (profile data changed); refetch on focus.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (isProfileStorageKey(e.key)) void refresh();
    };
    const channel = profileChannel();
    const onMessage = () => void refresh();
    const onFocus = () => {
      if (document.visibilityState === 'visible' && Date.now() - loadedAt.current > REFRESH_ON_FOCUS_MS) void refresh();
    };
    window.addEventListener('storage', onStorage);
    channel?.addEventListener('message', onMessage);
    document.addEventListener('visibilitychange', onFocus);
    window.addEventListener('focus', onFocus);
    return () => {
      window.removeEventListener('storage', onStorage);
      channel?.removeEventListener('message', onMessage);
      document.removeEventListener('visibilitychange', onFocus);
      window.removeEventListener('focus', onFocus);
    };
  }, [refresh]);

  const update = useCallback(
    async (patch: ProfilePatch) => {
      let p: PublicProfile;
      try {
        p = await apiFetch<PublicProfile>('/api/profile', { method: 'PATCH', body: patch });
      } catch (err) {
        // the server already retried a race 3 times; one more try from here before showing an error
        if (!(err instanceof ApiError && err.status === 409)) throw err;
        p = await apiFetch<PublicProfile>('/api/profile', { method: 'PATCH', body: patch });
      }
      accept(p);
      notifyOtherTabs();
      return p;
    },
    [accept],
  );

  // Score of the latest week map (the map lives in its own record), keyed by map id so a stale answer is never shown.
  const lastXrayId = profile?.lastXrayId;
  const [score, setScore] = useState<{ id: string; value: number | null } | null>(null);
  const lastScore = score && score.id === lastXrayId ? score.value : null;
  useEffect(() => {
    if (!lastXrayId) return;
    let cancelled = false;
    apiFetch<{ xray?: { score?: number } }>(`/api/xray/${encodeURIComponent(lastXrayId)}`)
      .then((r) => {
        if (!cancelled) setScore({ id: lastXrayId, value: typeof r.xray?.score === 'number' ? r.xray.score : null });
      })
      .catch(() => {
        if (!cancelled) setScore({ id: lastXrayId, value: null });
      });
    return () => {
      cancelled = true;
    };
  }, [lastXrayId]);
  const setLastScore = useCallback(
    (value: number | null) => {
      if (lastXrayId) setScore({ id: lastXrayId, value });
    },
    [lastXrayId],
  );

  const ensure = useCallback(async () => {
    if (profile && loadCredentials()?.id === profile.id) return profile;
    const creds = await ensureProfile(locale);
    const p = await apiFetch<PublicProfile>('/api/profile', { profile: creds });
    accept(p);
    return p;
  }, [profile, locale, accept]);

  const applyAwards = useCallback(
    (awards: PointsAward[] | undefined, originEl?: Element | null) => {
      if (!awards?.length) return;
      const total = awards.reduce((n, a) => n + a.points, 0);
      if (total === 0) return;
      setProfile((p) => (p ? { ...p, points: { ...p.points, balance: p.points.balance + total } } : p));
      if (originEl && presenters?.fly) presenters.fly(originEl, total);
      else presenters?.toast?.(awards);
      notifyOtherTabs();
      void refresh(); // reconcile with the server's balance and events
    },
    [presenters, refresh],
  );

  const signIn = useCallback(async (creds: Credentials) => {
    clearOrphanCredentials();
    return switchTo(creds);
  }, [switchTo]);

  const signOut = useCallback(async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' });
    } catch {
      // the server copy is revoked or unreachable: this device forgets the credentials either way
    }
    seq.current++;
    clearCredentials();
    setProfile(null);
    setStatus('anonymous');
  }, []);

  const remove = useCallback(async () => {
    try {
      await apiFetch('/api/profile', { method: 'DELETE' });
    } catch (err) {
      if (!(err instanceof ApiError && err.status === 401)) throw err; // already gone: still clear locally
    }
    seq.current++;
    clearCredentials();
    setProfile(null);
    setStatus('anonymous');
  }, []);

  const restoreLink = useCallback(() => {
    const creds = loadCredentials();
    return creds ? restoreLinkFor(creds) : null;
  }, []);

  const value = useMemo<ProfileContextValue>(
    () => ({
      status,
      profile,
      error,
      balance: profile?.points.balance ?? 0,
      streak: profile?.streak ?? null,
      lastScore,
      restore,
      pendingRestore: pending?.profile ?? null,
      confirmRestore,
      cancelRestore,
      restorePrevious,
      hasPrevious,
      retryOrphan,
      startFresh,
      refresh,
      ensure,
      update,
      applyAwards,
      remove,
      restoreLink,
      setLastScore,
      account: accountOf(profile),
      signIn,
      signOut,
    }),
    [
      status,
      profile,
      error,
      lastScore,
      restore,
      pending,
      confirmRestore,
      cancelRestore,
      restorePrevious,
      hasPrevious,
      retryOrphan,
      startFresh,
      refresh,
      ensure,
      update,
      applyAwards,
      remove,
      restoreLink,
      setLastScore,
      signIn,
      signOut,
    ],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

/** The account part of GET /api/profile (`account: { email } | null`), tolerant of profiles from before accounts. */
export function accountOf(p: PublicProfile | null): { email: string } | null {
  const a = (p as { account?: { email?: unknown } | null } | null)?.account;
  return a && typeof a.email === 'string' && a.email ? { email: a.email } : null;
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfile() needs <ProfileProvider> above it (root layout).');
  return ctx;
}

/** For components that also render outside the provider (e.g. the language switcher in the gallery). */
export function useOptionalProfile(): ProfileContextValue | null {
  return useContext(ProfileContext);
}
