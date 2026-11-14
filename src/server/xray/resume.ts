import { searchOccupations } from '@/domain/search';
import { taskWeight } from '@/domain/shares';
import type { Locale, ResumeFacts } from '@/domain/types';
import type { Actor } from '@/server/ai/budget';
import { callModel } from '@/server/ai/client';
import { occupationPickPrompt, occupationPickSchema, type PickCandidate } from '@/server/ai/prompts/occupation-pick';
import { MAX_DUTIES, MAX_TOOLS, resumeParsePrompt, resumeParseSchema, type ResumeParse } from '@/server/ai/prompts/resume-parse';
import { HttpError } from '@/server/profile/http';
import { getLocalTitles, getSearchIndex, getTitlePhrases, loadBundle } from './data';
import { checkResume } from './resume-check';

/**
 * POST /api/xray/resume (02.1.2): text → facts (resume.parse) → candidates from the search index
 * (up to 12) → occupation.pick ranks 3 of them. The model can only choose among the candidates;
 * the server checks every code and falls back to search order.
 * The résumé text itself is never stored: only the model results are cached (keyed by a hash of the text).
 */

export const MAX_TEXT = 20_000;
export const MAX_CANDIDATES = 12;
const TOP_TASKS = 5;
/** Confidence when the model's choice could not be used and the search order stands in for it. */
const FALLBACK_CONFIDENCE = 0.3;

export type ResumeMode = 'resume' | 'description';

export interface RankedOccupation {
  code: string;
  title: string;
  localTitle: string | null;
  reason: string;
}

export interface ResumeAnalysis {
  facts: ResumeFacts;
  ranked: RankedOccupation[];
  confidence: number;
  truncated: boolean;
}

export async function analyzeResume(input: { text: string; mode: ResumeMode; locale: Locale; actor?: Actor }): Promise<ResumeAnalysis> {
  const { mode, locale, actor } = input;
  const clean = input.text.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const truncated = clean.length > MAX_TEXT;
  const text = truncated ? clean.slice(0, MAX_TEXT) : clean;

  if (mode === 'description') {
    const words = text.split(/\s+/).filter((w) => /\p{L}{2,}/u.test(w));
    if (words.length < 3) {
      throw new HttpError(422, 'too_short', 'Describe your work in at least one full sentence.', { reason: 'too_short' });
    }
  } else {
    const check = checkResume(text, await getTitlePhrases());
    if (!check.ok) {
      throw new HttpError(422, 'not_a_resume', 'This text does not look like a résumé.', { reason: 'no_resume_signals', signals: check.signals });
    }
  }

  const { data: parsed } = await callModel({
    op: 'resume.parse',
    schema: resumeParseSchema,
    system: resumeParsePrompt.system(mode),
    user: resumeParsePrompt.user(text),
    locale,
    cacheKey: mode,
    maxTokens: 3000,
    temperature: 0,
    actor,
  });

  const facts = toFacts(parsed);
  if (!parsed.isWorkText || (facts.duties.length === 0 && !facts.title)) {
    const code = mode === 'resume' ? 'not_a_resume' : 'unclear_description';
    throw new HttpError(422, code, 'The text does not describe work we can map.', { reason: 'not_work_text', problem: parsed.problem ?? null });
  }

  const candidates = await findCandidates(parsed, facts);
  if (!candidates.length) {
    throw new HttpError(422, 'no_match', 'No occupation matches this text.', { reason: 'no_candidates' });
  }

  const pickInput = {
    title: parsed.titleEn ?? facts.title ?? null,
    industry: facts.industry,
    duties: facts.duties.map((d) => d.en),
    candidates,
  };
  const { data: pick } = await callModel({
    op: 'occupation.pick',
    schema: occupationPickSchema,
    system: occupationPickPrompt.system(locale),
    user: occupationPickPrompt.user(pickInput),
    locale,
    cacheKey: locale,
    maxTokens: 800,
    temperature: 0,
    actor,
  });

  const { ranked, confidence } = applyPick(pick, candidates);
  const local = await getLocalTitles(locale);
  return {
    facts,
    ranked: ranked.map((r) => ({ ...r, localTitle: local?.get(r.code) ?? null })),
    confidence,
    truncated,
  };
}

function toFacts(p: ResumeParse): ResumeFacts {
  const seen = new Set<string>();
  const duties: ResumeFacts['duties'] = [];
  for (const d of p.duties) {
    const original = d.original.trim().slice(0, 300);
    const en = d.en.trim().slice(0, 300);
    if (!original || !en) continue;
    const key = en.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    duties.push({ original, en });
    if (duties.length >= MAX_DUTIES) break;
  }
  const years = p.seniorityYears;
  return {
    title: (p.title ?? p.titleEn ?? '').trim().slice(0, 120),
    seniorityYears: years !== null && Number.isFinite(years) && years >= 0 && years <= 60 ? Math.round(years * 10) / 10 : null,
    industry: p.industry?.trim().slice(0, 120) || null,
    duties,
    tools: [...new Set(p.tools.map((t) => t.trim()).filter(Boolean))].slice(0, MAX_TOOLS),
  };
}

/** Candidate occupations in search order: English title, original title, alternative titles, then duty words. */
async function findCandidates(p: ResumeParse, facts: ResumeFacts): Promise<PickCandidate[]> {
  const idx = await getSearchIndex();
  const codes: string[] = [];
  const add = (query: string | null | undefined, limit: number) => {
    if (!query || query.trim().length < 2 || codes.length >= MAX_CANDIDATES) return;
    for (const hit of searchOccupations(idx, query, limit).results) {
      if (!codes.includes(hit.code) && codes.length < MAX_CANDIDATES) codes.push(hit.code);
    }
  };
  add(p.titleEn, 5);
  if (facts.title && facts.title !== p.titleEn) add(facts.title, 3);
  for (const alt of p.altTitlesEn) add(alt, 3);
  for (const d of facts.duties) add(d.en, 2);

  const candidates: PickCandidate[] = [];
  for (const code of codes) {
    const bundle = await loadBundle(code);
    if (!bundle) continue;
    const tasks = bundle.tasks
      .map((t, i) => ({ t, i, w: taskWeight(t) }))
      .sort((a, b) => b.w - a.w || a.i - b.i)
      .slice(0, TOP_TASKS)
      .map((x) => x.t.text);
    candidates.push({ code, title: bundle.title, tasks });
  }
  return candidates;
}

/**
 * Keeps only candidate codes (deduplicated), tops the list up to 3 in search order and caps the
 * confidence when the model's first choice was unusable.
 */
export function applyPick(
  pick: { ranked: { code: string; reason: string }[]; confidence: number },
  candidates: readonly { code: string; title: string }[],
): { ranked: Omit<RankedOccupation, 'localTitle'>[]; confidence: number } {
  const byCode = new Map(candidates.map((c) => [c.code, c]));
  const ranked: Omit<RankedOccupation, 'localTitle'>[] = [];
  for (const r of pick.ranked) {
    const c = byCode.get(r.code.trim());
    if (!c || ranked.some((x) => x.code === c.code)) continue;
    ranked.push({ code: c.code, title: c.title, reason: r.reason.trim().slice(0, 240) });
    if (ranked.length === 3) break;
  }
  const firstValid = ranked.length > 0 && pick.ranked[0] && byCode.has(pick.ranked[0].code.trim());
  for (const c of candidates) {
    if (ranked.length >= 3) break;
    if (!ranked.some((x) => x.code === c.code)) ranked.push({ code: c.code, title: c.title, reason: '' });
  }
  const conf = Number.isFinite(pick.confidence) ? Math.min(1, Math.max(0, pick.confidence)) : 0;
  return { ranked, confidence: firstValid ? Math.round(conf * 100) / 100 : Math.min(conf, FALLBACK_CONFIDENCE) };
}
