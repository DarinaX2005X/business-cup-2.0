import type { Locale, PointsAward, ProofEntry } from '@/domain/types';
import { apiFetch } from '@/lib/client/api';
import type { Phrase, ProgressResponse, ReviewKitResponse } from '@/server/progress/types';

/** Client calls of the progress package (05.1). Errors arrive as ApiError with the server's code. */

export const loadProgress = (locale: Locale) => apiFetch<ProgressResponse>(`/api/progress?locale=${locale}`);

export const setProofPublic = (id: string, value: boolean) =>
  apiFetch<{ entry: ProofEntry; publicSlug: string | null }>(`/api/proof/${encodeURIComponent(id)}`, { method: 'PATCH', body: { public: value } });

export const shareProofPage = () => apiFetch<{ url: string; slug: string; pointsAwarded: PointsAward[] }>('/api/proof/share', { method: 'POST' });

export const buildReviewKit = (locale: Locale) => apiFetch<ReviewKitResponse>('/api/review-kit', { method: 'POST', body: { locale } });

type T = (key: string, params?: Record<string, string | number | null | undefined>) => string;

/** A server phrase in the visitor's language. */
export const say = (t: T, p: Phrase) => t(p.key, p.params);

/** A local day (YYYY-MM-DD) as a date in the visitor's language. */
export const dayDate = (f: { date(d: string, style?: 'medium' | 'long' | 'short'): string }, day: string, style: 'medium' | 'long' | 'short' = 'medium') =>
  f.date(`${day}T12:00:00Z`, style);

/** «Nov 12» without the year, for chart ticks and compact labels. */
export function shortDay(locale: Locale, day: string): string {
  const tag = locale === 'ru' ? 'ru-RU' : locale === 'kk' ? 'kk-KZ' : 'en-US';
  return new Intl.DateTimeFormat(tag, { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${day}T12:00:00Z`));
}

/**
 * XP and level from GET /api/points (billing agent, round 3): `{ xp, level, levelName, nextAt }`, plus
 * `levelAt` (XP where this level started) when the server sends it. Null until the server has them.
 */
export interface LevelView {
  xp: number;
  level: number;
  levelName: string | null;
  /** "Level 3 · Steady hand", the same wording everywhere in the product. */
  label: string | null;
  nextAt: number | null;
  levelAt: number | null;
}

export async function loadLevel(): Promise<LevelView | null> {
  const r = await apiFetch<{ xp?: unknown; level?: unknown; levelName?: unknown; levelLabel?: unknown; nextAt?: unknown; levelAt?: unknown }>('/api/points');
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const xp = n(r.xp);
  const level = n(r.level);
  if (xp === null || level === null) return null;
  return { xp, level, levelName: typeof r.levelName === 'string' && r.levelName ? r.levelName : null, label: typeof r.levelLabel === 'string' && r.levelLabel ? r.levelLabel : null, nextAt: n(r.nextAt), levelAt: n(r.levelAt) };
}
