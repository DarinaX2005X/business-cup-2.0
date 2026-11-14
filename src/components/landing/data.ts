import type { WeekTask } from '@/components/kit/types';
import type { ClientBundle } from '@/components/xray/types';
import type { Category, Locale, XrayBreakdown, XrayComputed } from '@/domain/types';
import weekJson from './fixtures/week.json';
import repsJson from './fixtures/reps.json';

/**
 * Everything the landing shows comes from src/components/landing/fixtures/, written by
 * scripts/landing-fixtures.ts with the functions the product runs. This module only shapes it for
 * the sections.
 */

type Texts = Record<string, { text: string; short: string }>;

interface OtherWeekRaw {
  code: string;
  slug: string;
  titles: Partial<Record<Locale, string>>;
  hours: Record<Category, number>;
  baseScore: number;
  weekExposure: number;
  tasks: WeekTask[];
}

const week = weekJson as unknown as {
  source: 'resume' | 'onet';
  jobTitle: string;
  titles: Partial<Record<Locale, string>>;
  bundle: ClientBundle;
  result: XrayComputed;
  breakdown: XrayBreakdown;
  texts: Partial<Record<Locale, Texts>>;
  others: OtherWeekRaw[];
};

export interface OtherWeek {
  code: string;
  slug: string;
  title: string;
  human: number;
  machine: number;
  score: number;
  exposure: number;
  tasks: WeekTask[];
}

export interface WeekView {
  fromResume: boolean;
  jobTitle: string;
  occupation: string;
  bundle: ClientBundle;
  result: XrayComputed;
  breakdown: XrayBreakdown;
  tasks: WeekTask[];
  labels: Record<string, string>;
  fullTexts: Record<string, string>;
  /** People employed in the occupation (BLS), for the note under the single risk number. */
  employment: number | null;
  /** The single occupation-level number a risk calculator would print: sum of share × exposure. */
  exposure: number;
  /** The task the inspector opens on: the largest one AI already touches, else the largest. */
  firstTask: string;
  topMachineTask: string | null;
  others: OtherWeek[];
}

export function weekView(locale: Locale): WeekView {
  const { bundle, result, breakdown } = week;
  const local = locale === 'en' ? undefined : week.texts[locale];
  const byId = new Map(bundle.tasks.map((t) => [t.id, t]));
  const labels: Record<string, string> = {};
  const fullTexts: Record<string, string> = {};
  for (const t of bundle.tasks) {
    labels[t.id] = local?.[t.id]?.short ?? t.short ?? t.text;
    fullTexts[t.id] = local?.[t.id]?.text ?? t.text;
  }
  const tasks: WeekTask[] = result.shares.flatMap(({ taskId, share }) => {
    const t = byId.get(taskId);
    return t ? [{ id: t.id, label: labels[t.id], text: fullTexts[t.id], share, category: t.evidence.category, evidenceLevel: t.evidence.evidenceLevel }] : [];
  });
  const machine = tasks.filter((t) => t.category === 'ai_does' || t.category === 'ai_speeds').sort((a, b) => b.share - a.share);
  return {
    fromResume: week.source === 'resume',
    jobTitle: week.jobTitle,
    occupation: week.titles[locale] ?? bundle.title,
    bundle,
    result,
    breakdown,
    tasks,
    labels,
    fullTexts,
    employment: bundle.wage.employment,
    exposure: result.weekExposure,
    firstTask: machine[0]?.id ?? tasks[0].id,
    topMachineTask: machine[0]?.label ?? null,
    others: week.others.map((o) => ({
      code: o.code,
      slug: o.slug,
      title: o.titles[locale] ?? o.titles.en ?? '',
      human: o.hours.human_edge,
      machine: Math.round((o.hours.ai_does + o.hours.ai_speeds) * 10) / 10,
      score: o.baseScore,
      exposure: o.weekExposure,
      tasks: o.tasks,
    })),
  };
}

/* ---------- the three rep types ---------- */

export interface RepSamples {
  slip: { occupation: string | null; taskShort: string | null; title: string; docType: string | null; document: string; mistakes: number };
  delegate: {
    occupation: string | null;
    taskShort: string | null;
    title: string;
    scenario: string;
    goal: string;
    inputs: string;
    criteria: number;
    traps: number;
    shownTrap: { description: string; spots: [number, number][] };
  };
  edge: { occupation: string | null; taskShort: string | null; title: string; scenario: string; persona: string; opening: string; goal: string; criteria: string[] };
}

export function repSamples(): RepSamples {
  return repsJson as unknown as RepSamples;
}
