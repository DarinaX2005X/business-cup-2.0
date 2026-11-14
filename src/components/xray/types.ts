import type { Locale, OccupationBundle, RelatedOccupation, XrayResult } from '@/domain/types';

/** The week map as the page receives it (a guest's copy has no profileId). */
export type XrayData = Omit<XrayResult, 'profileId'> & { profileId?: string };

/**
 * What the client gets of the occupation bundle: tasks, wage and versions for the live recompute.
 * Skills and knowledge stay on the server; `related` holds only the neighbours this viewer may see
 * (the first one on Free), and `relatedCount` says how many exist in all.
 */
export type ClientBundle = Pick<OccupationBundle, 'code' | 'slug' | 'title' | 'description' | 'wage' | 'tasks' | 'typicalHumanShare' | 'dataVersion'> & {
  related: RelatedOccupation[];
  relatedCount: number;
};

export type TaskTexts = Record<string, { text: string; short: string }>;

export interface TaskTip {
  short: string;
  tip: string;
  kind: 'hand' | 'edge';
  edgeTip: string | null;
}

export interface XrayPageProps {
  xray: XrayData;
  isOwner: boolean;
  isPro: boolean;
  /** The free practice rep is still available to this viewer. */
  trialAvailable: boolean;
  bundle: ClientBundle;
  texts: TaskTexts;
  textsReady: boolean;
  textsLocale: Locale;
  /** Occupation title in the interface language, when the build has one. */
  occupationTitle: string;
  initialFocus: string | null;
}

export type Focus = { kind: 'task'; id: string } | { kind: 'metric'; id: MetricId };
export type MetricId = 'score' | 'pay' | 'hours' | 'observed';

export function parseFocus(raw: string | null | undefined): Focus | null {
  if (!raw) return null;
  const [kind, id] = raw.split(':');
  if (kind === 'task' && id) return { kind: 'task', id };
  if (kind === 'metric' && (id === 'score' || id === 'pay' || id === 'hours' || id === 'observed')) return { kind: 'metric', id };
  return null;
}

export const focusParam = (f: Focus) => `${f.kind}:${f.id}`;
