import type { Category } from '@/domain/types';

/** A week as tiles for the mini Week Bar: one per task, share 0..100. */
export type WeekTiles = { category: Category; share: number }[];

/** One neighbouring job as its card shows it. Built on the server from the data build. */
export interface MoveView {
  code: string;
  slug: string;
  /** In the interface language when the build has a translation, else English (`titleEn`). */
  title: string;
  titleEn: boolean;
  /** Skill and knowledge similarity, 0..1. */
  similarity: number;
  /** Median annual pay of the target minus the person's occupation (BLS), or null. */
  wageDelta: number | null;
  /** How the pay line reads: higher, lower, about the same, one shared BLS figure, or no data. */
  pay: 'more' | 'less' | 'same' | 'shared' | 'none';
  /** The target's typical week (defaultShares), hours by category. */
  hours: Record<Category, number>;
  tiles: WeekTiles;
  /** Skills and knowledge the target needs that the person's occupation rates clearly lower. */
  skills: { key: string; label: string }[];
}

export interface PivotView {
  xrayId: string;
  jobTitle: string;
  occupationTitle: string;
  /** The person's own week from their latest map. */
  now: { hours: Record<Category, number>; tiles: WeekTiles };
  /** The neighbours this viewer may see (all on Pro, the first on Free). */
  moves: MoveView[];
  /** How many neighbours exist in all. */
  total: number;
  isPro: boolean;
}

/** /pivot/[slug]: the person's week moved into one neighbouring job. */
export interface AsJobView {
  move: MoveView;
  xrayId: string;
  jobTitle: string;
  /** Share of the current week (0..100) that found a matching task. */
  carried: number;
  /** Hours by category: now and in the target job. */
  now: Record<Category, number>;
  then: Record<Category, number>;
  /** The moved week for the kit Week Bar. */
  week: { id: string; label: string; text: string; share: number; category: Category }[];
  /** Target tasks that received hours from the person's week, with the labels of those source tasks. */
  carriedTasks: { id: string; label: string; hours: number; from: string[] }[];
  freshTasks: { id: string; label: string; hours: number }[];
  /** Task labels are English (no generated labels in the interface language yet). */
  labelsEn: boolean;
}
