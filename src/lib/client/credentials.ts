/**
 * Where the browser keeps the anonymous profile: localStorage (`irr_profile`) plus the `irr_p`
 * cookie (`<id>.<secret>`, SameSite=Lax, 400 days) so the server can render the right profile.
 * Other tabs learn about changes through the `storage` event and a BroadcastChannel.
 */

export interface Credentials {
  id: string;
  secret: string;
}

const STORAGE_KEY = 'irr_profile';
const PREV_KEY = 'irr_profile_prev';
const ORPHAN_KEY = 'irr_profile_orphan';
export const PROFILE_COOKIE = 'irr_p';
const COOKIE_MAX_AGE = 400 * 24 * 3600;
const ID_RE = /^[0-9A-Za-z]{22}$/;
const SECRET_RE = /^[A-Za-z0-9_-]{43}$/;

export function isCredentials(v: unknown): v is Credentials {
  const c = v as Credentials | null;
  return !!c && typeof c === 'object' && ID_RE.test(String(c.id)) && SECRET_RE.test(String(c.secret));
}

/** Parses `<id>.<secret>` (restore links and the cookie). */
export function parseCredentialString(raw: string | null | undefined): Credentials | null {
  if (!raw) return null;
  const dot = raw.indexOf('.');
  if (dot < 0) return null;
  const c = { id: raw.slice(0, dot), secret: raw.slice(dot + 1) };
  return isCredentials(c) ? c : null;
}

function readCookie(): string | null {
  const m = document.cookie.match(new RegExp(`(?:^|; )${PROFILE_COOKIE}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(c: Credentials | null) {
  const secure = window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = c
    ? `${PROFILE_COOKIE}=${c.id}.${c.secret}; Path=/; Max-Age=${COOKIE_MAX_AGE}; SameSite=Lax${secure}`
    : `${PROFILE_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
}

function safeGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string | null) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // storage blocked (private mode): the cookie still carries the profile
  }
}

/** Stored credentials; falls back to the cookie and repairs whichever copy is missing. */
export function loadCredentials(): Credentials | null {
  if (typeof window === 'undefined') return null;
  let fromStorage: Credentials | null = null;
  try {
    const parsed = JSON.parse(safeGet(STORAGE_KEY) ?? 'null');
    fromStorage = isCredentials(parsed) ? parsed : null;
  } catch {
    fromStorage = null;
  }
  const fromCookie = parseCredentialString(readCookie());
  const creds = fromStorage ?? fromCookie;
  if (creds && (!fromCookie || fromCookie.id !== creds.id)) writeCookie(creds);
  if (creds && !fromStorage) safeSet(STORAGE_KEY, JSON.stringify(creds));
  return creds;
}

export function saveCredentials(c: Credentials): void {
  const prev = loadCredentials();
  if (prev && prev.id !== c.id) safeSet(PREV_KEY, JSON.stringify(prev));
  safeSet(STORAGE_KEY, JSON.stringify(c));
  writeCookie(c);
  notifyOtherTabs();
}

export function clearCredentials(): void {
  safeSet(STORAGE_KEY, null);
  writeCookie(null);
  notifyOtherTabs();
}

export const isProfileStorageKey = (key: string | null) => key === STORAGE_KEY || key === ORPHAN_KEY;

function loadSlot(key: string): Credentials | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(safeGet(key) ?? 'null');
    return isCredentials(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The profile this browser used before the last switch (restore link or restorePrevious). */
export function loadPreviousCredentials(): Credentials | null {
  return loadSlot(PREV_KEY);
}

/** Credentials the server stopped recognising (401). Kept until the person retries or starts fresh. */
export function loadOrphanCredentials(): Credentials | null {
  return loadSlot(ORPHAN_KEY);
}

/** Moves the active credentials aside instead of deleting them, so a temporary server problem loses nothing. */
export function orphanCredentials(c: Credentials): void {
  safeSet(ORPHAN_KEY, JSON.stringify(c));
  if (loadCredentials()?.id === c.id) {
    safeSet(STORAGE_KEY, null);
    writeCookie(null);
  }
  notifyOtherTabs();
}

export function clearOrphanCredentials(): void {
  safeSet(ORPHAN_KEY, null);
  notifyOtherTabs();
}

let channel: BroadcastChannel | null = null;
export function profileChannel(): BroadcastChannel | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return (channel ??= new BroadcastChannel('irr-profile'));
}

/** Tells other tabs that the profile changed so they refetch it. */
export function notifyOtherTabs(): void {
  profileChannel()?.postMessage({ type: 'changed', at: Date.now() });
}
