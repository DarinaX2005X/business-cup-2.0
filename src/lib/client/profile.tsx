'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Locale, PointsAward, Profile } from '@/domain/types';
import { useT } from '@/i18n/client';
import { isLocale } from '@/i18n/config';
import { ApiError, apiFetch } from './api';
import {
  clearCredentials,
  isProfileStorageKey,
  loadCredentials,
  notifyOtherTabs,
  parseCredentialString,
  profileChannel,
  saveCredentials,
  type Credentials,
} from './credentials';

export type PublicProfile = Omit<Profile, 'secretHash'>;
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

/** Link that opens this profile on another device or browser: `/?restore=<id>.<secret>`. */
export function restoreLinkFor(creds: Credentials, origin = window.location.origin): string {
  return `${origin}/?restore=${creds.id}.${creds.secret}`;
}

// ---------------------------------------------------------------------------------------------
// Provider

export type ProfileStatus = 'loading' | 'anonymous' | 'ready' | 'error';

interface ProfileContextValue {
  status: ProfileStatus;
  profile: PublicProfile | null;
  /** Error code when status is 'error' (e.g. 'network', 'storage_unavailable'). */
  error: string | null;
  balance: number;
  streak: Profile['streak'] | null;
  /** Score of the latest week map, null until one exists or while loading it. */
  lastScore: number | null;
  /** Result of a `?restore=` link on this page load. */
  restore: 'restored' | 'invalid' | null;
  refresh(): Promise<void>;
  /** Creates the profile if needed and returns it. */
  ensure(): Promise<PublicProfile>;
  update(patch: ProfilePatch): Promise<PublicProfile>;
  /** Shows points from a response (`pointsAwarded`): flies them from `originEl` if given, otherwise a toast. */
  applyAwards(awards: PointsAward[] | undefined, originEl?: Element | null): void;
  remove(): Promise<void>;
  restoreLink(): string | null;
  /** Lets screens that just computed a new map show its score without waiting for a refetch. */
  setLastScore(score: number | null): void;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

export interface AwardPresenters {
  /** Kit's flyPoints(fromEl, amount). */
  fly?: (fromEl: Element, amount: number) => void;
  /** Kit's toast; receives the localized text. */
  toast?: (text: string) => void;
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
  const { t, locale, setLocale } = useT();
  const [status, setStatus] = useState<ProfileStatus>('loading');
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restore, setRestore] = useState<'restored' | 'invalid' | null>(null);
  const loadedAt = useRef(0);
  const tzSyncing = useRef(false);
  const seq = useRef(0);

  const accept = useCallback((p: PublicProfile) => {
    setProfile((prev) => (prev && prev.id === p.id && prev.version > p.version ? prev : p));
    setStatus('ready');
    setError(null);
    loadedAt.current = Date.now();
    // Keep the stored time zone current (the server uses it for "today"); silent and best-effort.
    const tz = browserTimeZone();
    if (tz && tz !== p.tz && !tzSyncing.current) {
      tzSyncing.current = true;
      apiFetch<PublicProfile>('/api/profile', { method: 'PATCH', body: { tz } })
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
      setStatus('anonymous');
      return;
    }
    try {
      const p = await apiFetch<PublicProfile>('/api/profile', { profile: creds });
      if (mySeq !== seq.current) return; // a newer refresh (or account switch) won
      accept(p);
    } catch (err) {
      if (mySeq !== seq.current) return;
      if (err instanceof ApiError && err.status === 401) {
        // deleted elsewhere or the secret no longer matches: this browser has no profile now
        if (loadCredentials()?.id === creds.id) clearCredentials();
        setProfile(null);
        setStatus('anonymous');
        return;
      }
      setError(err instanceof ApiError ? err.code : 'network');
      setStatus((s) => (s === 'ready' ? 'ready' : 'error'));
    }
  }, [accept]);

  // First load, including a `?restore=<id>.<secret>` link.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const url = new URL(window.location.href);
      const raw = url.searchParams.get('restore') ?? new URLSearchParams(url.hash.slice(1)).get('restore');
      if (raw !== null) {
        url.searchParams.delete('restore');
        if (url.hash.includes('restore=')) url.hash = '';
        window.history.replaceState(window.history.state, '', url.toString());
        const creds = parseCredentialString(raw);
        try {
          if (!creds) throw new ApiError('unauthorized', 401, 'malformed restore link');
          const p = await apiFetch<PublicProfile>('/api/profile', { profile: creds });
          if (cancelled) return;
          saveCredentials(creds);
          accept(p);
          setRestore('restored');
          if (p.locale !== locale) void setLocale(p.locale);
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
      else presenters?.toast?.(t('common.points.earned', { count: total }));
      notifyOtherTabs();
      void refresh(); // reconcile with the server's balance and events
    },
    [presenters, t, refresh],
  );

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
      refresh,
      ensure,
      update,
      applyAwards,
      remove,
      restoreLink,
      setLastScore,
    }),
    [status, profile, error, lastScore, restore, refresh, ensure, update, applyAwards, remove, restoreLink, setLastScore],
  );

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
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
