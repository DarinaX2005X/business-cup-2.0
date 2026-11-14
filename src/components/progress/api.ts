import type { Locale, PointsAward, ProofEntry } from '@/domain/types';
import { apiFetch } from '@/lib/client/api';
import type { Phrase, PlanResponse, ProgressResponse, ReviewKitResponse } from '@/server/progress/types';

/** Client calls of the progress package (05.1). Errors arrive as ApiError with the server's code. */

export const loadProgress = (locale: Locale) => apiFetch<ProgressResponse>(`/api/progress?locale=${locale}`);

export const setProofPublic = (id: string, value: boolean) =>
  apiFetch<{ entry: ProofEntry; publicSlug: string | null }>(`/api/proof/${encodeURIComponent(id)}`, { method: 'PATCH', body: { public: value } });

export const shareProofPage = () => apiFetch<{ url: string; slug: string; pointsAwarded: PointsAward[] }>('/api/proof/share', { method: 'POST' });

export const loadPlan = (locale: Locale) => apiFetch<PlanResponse>(`/api/plan?locale=${locale}`);

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
