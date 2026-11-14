import { createHash } from 'node:crypto';
import type { OccupationBundle, ProfileSkill, ProfileSkills, SkillKind } from '@/domain/types';
import { MAX_SKILLS, type ProfileSkillsOutput } from '@/server/ai/prompts/profile-skills';
import { NEVER_A_GAP, ONET_ELEMENTS, onetById, onetIdsByName, onetKey, type OnetElement } from './onet';
import { matchTechnology, techWords, type Technology } from './technology';
import type { SkillGap, SkillNeed, SkillsPatch, SkillView } from './types';
import skillsEn from '@/i18n/sections/skills.en.json';

/*
 * Pure parts of «Skills from your résumé»: checking what the model read against the text, merging a
 * read into the profile's skills, the person's edits, and the gaps for their job and the jobs next to it.
 * I/O (model call, store, bundles) lives in ./service.ts.
 */

export const SKILLS_TEXT_MAX = 20_000;
export const QUOTE_MAX = 160;
export const ITEMS_MAX = 40;
export const REMOVED_MAX = 60;
export const NAME_MAX = 48;
/** How many neighbouring jobs feed the «next jobs» gaps and the list the model checks. */
export const RELATED_USED = 8;

// ---------------------------------------------------------------------------------------------
// Text and quotes

/** The same clean-up the résumé reader applies (02.1.2), so quotes are checked against the same text. */
export function cleanText(input: string): string {
  return input.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, SKILLS_TEXT_MAX);
}

export const textHash = (text: string) => createHash('sha256').update(text).digest('hex');

function foldChar(c: string): string {
  if (/[‘’‚‛′`]/.test(c)) return "'";
  if (/[“”„‟″]/.test(c)) return '"';
  if (/[‐-―−]/.test(c)) return '-';
  if (/\s/.test(c)) return ' ';
  return c.toLowerCase();
}

/** Folded text (lower case, plain quotes and dashes, single spaces) with a map back to the original offsets. */
function fold(text: string): { folded: string; map: number[] } {
  let folded = '';
  const map: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = foldChar(text[i]);
    if (c === ' ' && (folded.length === 0 || folded.endsWith(' '))) continue;
    folded += c;
    map.push(i);
  }
  return { folded, map };
}

const folds = new WeakMap<object, { folded: string; map: number[] }>();

/**
 * The excerpt of `text` the model quoted, taken from the text itself, or null when the quote is not in it.
 * Case, curly quotes, dashes and runs of spaces may differ; words and their order may not. Quotes that
 * join two places with «...» are refused.
 */
export function findQuote(text: string, quote: string, cache?: object): string | null {
  let q = quote.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  q = q.replace(/[.;,:]+$/, '').trim();
  if (q.length < 2 || !/\p{L}/u.test(q)) return null;
  if (/\.\.\.|…/.test(q)) return null;
  let f = cache ? folds.get(cache) : undefined;
  if (!f) {
    f = fold(text);
    if (cache) folds.set(cache, f);
  }
  const fq = fold(q).folded.trim();
  if (!fq) return null;
  const at = f.folded.indexOf(fq);
  if (at < 0) return null;
  const start = f.map[at];
  const end = f.map[at + fq.length - 1] + 1;
  return shortQuote(text.slice(start, end).replace(/\s+/g, ' ').trim());
}

/** Quotes longer than QUOTE_MAX are cut at a word and end with «…». */
export function shortQuote(q: string): string {
  if (q.length <= QUOTE_MAX) return q;
  const cut = q.slice(0, QUOTE_MAX - 1);
  const sp = cut.lastIndexOf(' ');
  return `${(sp > 60 ? cut.slice(0, sp) : cut).replace(/[\s,;:.]+$/, '')}…`;
}

// ---------------------------------------------------------------------------------------------
// Names and ids

export function cleanName(name: string): string {
  return name.replace(/\s+/g, ' ').trim().replace(/^[-•*·\s]+/, '').replace(/[.;,:]+$/, '').slice(0, NAME_MAX).trim();
}

/** Comparison key of a skill name: «Python 3» and «python3» stay apart, «Patient-triage» = «patient triage». */
export function skillKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[#+]/g, (c) => (c === '#' ? ' sharp' : ' plus'))
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export const skillIdFor = (name: string) => `sk_${createHash('sha256').update(skillKey(name)).digest('hex').slice(0, 10)}`;

// ---------------------------------------------------------------------------------------------
// The elements a read checks

export interface BundleLike {
  code: string;
  title: string;
  skills: OccupationBundle['skills'];
  knowledge: OccupationBundle['knowledge'];
}
export type RelatedLike = OccupationBundle['related'];

/** O*NET elements of the job (top skills and knowledge) and the ones its neighbours need more of. */
export function elementsToCheck(bundle: BundleLike, related: RelatedLike): OnetElement[] {
  const ids: string[] = [];
  for (const s of [...bundle.skills, ...bundle.knowledge]) if (onetById(s.id)) ids.push(s.id);
  for (const r of related.slice(0, RELATED_USED)) for (const name of r.missingSkills) ids.push(...onetIdsByName(name));
  return [...new Set(ids)].map((id) => onetById(id)!).filter(Boolean);
}

// ---------------------------------------------------------------------------------------------
// Checking a read

export interface VerifiedRead {
  isWorkText: boolean;
  seniorityYears: number | null;
  items: Omit<ProfileSkill, 'source' | 'at'>[];
  shown: { onetId: string; quote: string }[];
  checked: string[];
  /** What was dropped and why (logs and tests). */
  dropped: { name: string; why: 'no_quote' | 'duplicate' | 'empty' | 'over_limit' }[];
}

const sane = (y: number | null | undefined, max = 50) =>
  typeof y === 'number' && Number.isFinite(y) && y > 0 && y <= max ? Math.round(y * 2) / 2 : null;

/**
 * Keeps only what the text supports: every quote must be found in the text, every id must be one we
 * asked about, tools are matched to the job's O*NET technologies, years must be plausible.
 */
export function verifyRead(out: ProfileSkillsOutput, text: string, elements: readonly OnetElement[], techs: readonly Technology[]): VerifiedRead {
  const cache = {};
  const allowed = new Set(elements.map((e) => e.id));
  const seniority = sane(out.seniorityYears, 60);
  const items: VerifiedRead['items'] = [];
  const dropped: VerifiedRead['dropped'] = [];
  const seen = new Set<string>();

  for (const s of out.skills) {
    const name = cleanName(s.name);
    if (!name || !/\p{L}/u.test(name)) {
      dropped.push({ name: s.name, why: 'empty' });
      continue;
    }
    const key = skillKey(name);
    if (seen.has(key)) {
      dropped.push({ name, why: 'duplicate' });
      continue;
    }
    const quotes = [...new Set(s.quotes.map((q) => findQuote(text, q, cache)).filter((q): q is string => !!q))].slice(0, 2);
    if (!quotes.length) {
      dropped.push({ name, why: 'no_quote' });
      continue;
    }
    if (items.length >= MAX_SKILLS) {
      dropped.push({ name, why: 'over_limit' });
      continue;
    }
    seen.add(key);
    const kind: SkillKind = s.kind;
    const tech = kind === 'tool' ? matchTechnology(name, techs) : null;
    let years = sane(s.years);
    if (years !== null && seniority !== null && years > seniority + 1) years = null;
    items.push({
      id: skillIdFor(name),
      name,
      kind,
      onetId: s.onetId && allowed.has(s.onetId.trim()) ? s.onetId.trim() : null,
      tech: tech?.name ?? null,
      quotes,
      years,
    });
  }

  const shown: VerifiedRead['shown'] = [];
  for (const s of out.shown) {
    const id = s.onetId.trim();
    if (!allowed.has(id) || shown.some((x) => x.onetId === id)) continue;
    const quote = findQuote(text, s.quote, cache);
    if (quote) shown.push({ onetId: id, quote });
  }

  return { isWorkText: out.isWorkText, seniorityYears: seniority, items, shown, checked: [...allowed], dropped };
}

// ---------------------------------------------------------------------------------------------
// Merging into the profile

export function emptySkills(now: string): ProfileSkills {
  return { items: [], shown: [], checked: [], removed: [], occupationCode: null, textHash: null, seniorityYears: null, extractedAt: null, updatedAt: now };
}

/**
 * A new read replaces what the last read found, keeps what the person added or kept, and never brings
 * back a skill they removed.
 */
export function applyRead(prev: ProfileSkills | undefined, read: VerifiedRead, meta: { occupationCode: string; textHash: string; now: string }): ProfileSkills {
  const base = prev ?? emptySkills(meta.now);
  const removed = new Set(base.removed.map((r) => r.key));
  const kept = base.items.filter((i) => i.source !== 'resume');
  const byKey = new Map(kept.map((i) => [skillKey(i.name), i]));
  const items: ProfileSkill[] = [...kept];
  for (const r of read.items) {
    const key = skillKey(r.name);
    if (removed.has(key)) continue;
    const mine = byKey.get(key);
    if (mine) {
      // The person's own entry stays theirs; the read adds its evidence.
      const i = items.indexOf(mine);
      items[i] = {
        ...mine,
        quotes: mine.quotes.length ? mine.quotes : r.quotes,
        onetId: mine.onetId ?? r.onetId,
        tech: mine.tech ?? r.tech,
        years: mine.years ?? r.years,
      };
      continue;
    }
    items.push({ ...r, source: 'resume', at: meta.now });
  }
  return {
    ...base,
    items: items.slice(0, ITEMS_MAX),
    shown: read.shown,
    checked: read.checked,
    occupationCode: meta.occupationCode,
    textHash: meta.textHash,
    seniorityYears: read.seniorityYears,
    extractedAt: meta.now,
    updatedAt: meta.now,
  };
}

// ---------------------------------------------------------------------------------------------
// The person's edits

export class SkillsPatchError extends Error {
  constructor(
    readonly code: 'not_found' | 'too_short' | 'exists' | 'limit',
    message: string,
  ) {
    super(message);
    this.name = 'SkillsPatchError';
  }
}

type Labels = Record<string, { name: string; what?: string }>;
const ONET_LABELS = (skillsEn as { onet: Labels }).onet;

/** The O*NET element a typed name stands for: its official name or its plain label. */
export function onetForName(name: string): OnetElement | null {
  const key = skillKey(name);
  for (const e of ONET_ELEMENTS) {
    if (skillKey(e.name) === key) return e;
    const label = ONET_LABELS[onetKey(e.id)]?.name;
    if (label && skillKey(label) === key) return e;
  }
  return null;
}

export function patchSkills(prev: ProfileSkills | undefined, patch: SkillsPatch, ctx: { now: string; techs: readonly Technology[] }): { skills: ProfileSkills; item: ProfileSkill | null } {
  const s: ProfileSkills = structuredClone(prev ?? emptySkills(ctx.now));
  s.updatedAt = ctx.now;
  const find = (id: string) => s.items.find((i) => i.id === id);

  switch (patch.op) {
    case 'confirm': {
      const item = find(patch.id);
      if (!item) throw new SkillsPatchError('not_found', 'skill not found');
      if (item.source === 'resume') item.source = 'confirmed';
      return { skills: s, item };
    }
    case 'confirm_all': {
      for (const i of s.items) if (i.source === 'resume') i.source = 'confirmed';
      return { skills: s, item: null };
    }
    case 'remove': {
      const item = find(patch.id);
      if (!item) throw new SkillsPatchError('not_found', 'skill not found');
      s.items = s.items.filter((i) => i !== item);
      const key = skillKey(item.name);
      s.removed = [{ key, item }, ...s.removed.filter((r) => r.key !== key)].slice(0, REMOVED_MAX);
      return { skills: s, item };
    }
    case 'restore': {
      const r = s.removed.find((x) => x.item.id === patch.id);
      if (!r) throw new SkillsPatchError('not_found', 'nothing to restore');
      s.removed = s.removed.filter((x) => x !== r);
      if (!find(r.item.id)) s.items.push(r.item);
      return { skills: s, item: r.item };
    }
    case 'add': {
      const name = cleanName(patch.name);
      if (name.length < 2 || !/\p{L}/u.test(name)) throw new SkillsPatchError('too_short', 'name: at least two letters');
      const key = skillKey(name);
      const existing = s.items.find((i) => skillKey(i.name) === key);
      if (existing) {
        if (existing.source === 'resume') existing.source = 'confirmed';
        return { skills: s, item: existing };
      }
      if (s.items.length >= ITEMS_MAX) throw new SkillsPatchError('limit', `at most ${ITEMS_MAX} skills`);
      const wasRemoved = s.removed.find((r) => r.key === key);
      if (wasRemoved) {
        s.removed = s.removed.filter((r) => r !== wasRemoved);
        const item = { ...wasRemoved.item, source: 'confirmed' as const };
        s.items.push(item);
        return { skills: s, item };
      }
      const element = onetForName(name);
      const tech = !element ? matchTechnology(name, ctx.techs) : null;
      const kind: SkillKind = patch.kind ?? (tech ? 'tool' : element ? element.kind : 'skill');
      const item: ProfileSkill = {
        id: skillIdFor(name),
        name: element && !tech ? labelOf(element) : tech ? tech.name : name,
        kind,
        onetId: element?.id ?? null,
        tech: tech?.name ?? null,
        source: 'added',
        quotes: [],
        years: null,
        at: ctx.now,
      };
      s.items.push(item);
      return { skills: s, item };
    }
  }
}

export const labelOf = (e: OnetElement) => ONET_LABELS[onetKey(e.id)]?.name ?? e.name;

// ---------------------------------------------------------------------------------------------
// Views and gaps

export function viewSkill(item: ProfileSkill, techs: readonly Technology[]): SkillView {
  const tech = item.tech ? techs.find((t) => t.name === item.tech) : null;
  const el = item.onetId ? onetById(item.onetId) : undefined;
  return { ...item, hot: Boolean(tech && (tech.hot || tech.inDemand)), onetKey: el ? onetKey(el.id) : null, onetName: el?.name ?? null };
}

const KIND_ORDER: Record<SkillKind, number> = { skill: 0, tool: 1, knowledge: 2 };

export function sortSkills(items: SkillView[]): SkillView[] {
  return [...items].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      Number(b.quotes.length > 0) - Number(a.quotes.length > 0) ||
      (b.years ?? 0) - (a.years ?? 0) ||
      Number(b.hot) - Number(a.hot) ||
      a.name.localeCompare(b.name),
  );
}

/** O*NET elements the person shows: verified résumé quotes plus what their own skills count toward. */
export function coveredElements(skills: ProfileSkills | undefined): Set<string> {
  const out = new Set<string>();
  if (!skills) return out;
  for (const s of skills.shown) out.add(s.onetId);
  for (const i of skills.items) if (i.onetId) out.add(i.onetId);
  return out;
}

function coveredTech(skills: ProfileSkills | undefined, techs: readonly Technology[]): Set<string> {
  const out = new Set<string>();
  if (!skills) return out;
  for (const i of skills.items) {
    if (i.tech) out.add(i.tech);
    const m = matchTechnology(i.name, techs);
    if (m) out.add(m.name);
  }
  return out;
}

const needOf = (e: OnetElement): SkillNeed => ({ id: e.id, kind: e.kind, name: e.name, key: onetKey(e.id) });

/** What the job relies on most (skills and knowledge together, by O*NET importance). */
export function jobNeeds(bundle: BundleLike, limit = 6): (SkillNeed & { importance: number })[] {
  return [...bundle.skills, ...bundle.knowledge]
    .filter((x) => onetById(x.id) && !NEVER_A_GAP.has(x.id))
    .sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id))
    .slice(0, limit)
    .map((x) => ({ ...needOf(onetById(x.id)!), importance: x.importance }));
}

export const GAPS_MAX = 5;

/**
 * Worth building next, up to five: two from their own job (important there, not shown in the résumé),
 * two the jobs next to theirs need more of (with the jobs each one opens), one technology often named in
 * job posts for their job; then the rest in that order. An element the read never checked is not called
 * missing for their own job.
 */
export function computeGaps(input: { bundle: BundleLike; related: RelatedLike; techs: readonly Technology[]; skills: ProfileSkills | undefined }): SkillGap[] {
  const { bundle, related, techs, skills } = input;
  const covered = coveredElements(skills);
  const checked = new Set(skills?.checked ?? []);
  const known = (id: string) => checked.size === 0 || checked.has(id);
  const importance = new Map([...bundle.skills, ...bundle.knowledge].map((x) => [x.id, x.importance]));

  const own: SkillGap[] = [...bundle.skills, ...bundle.knowledge]
    .filter((x) => x.importance >= 3 && onetById(x.id) && !NEVER_A_GAP.has(x.id) && !covered.has(x.id) && known(x.id))
    .sort((a, b) => b.importance - a.importance || a.id.localeCompare(b.id))
    .map((x) => ({ ...needOf(onetById(x.id)!), reason: 'own_job' as const, leadsTo: [], importance: x.importance }));

  const nextMap = new Map<string, SkillGap>();
  for (const r of related.slice(0, RELATED_USED)) {
    for (const name of r.missingSkills) {
      const ids = onetIdsByName(name);
      if (!ids.length || ids.some((id) => covered.has(id) || NEVER_A_GAP.has(id))) continue;
      const id = ids[0];
      const g = nextMap.get(id) ?? { ...needOf(onetById(id)!), reason: 'next_job' as const, leadsTo: [], importance: importance.get(id) ?? null };
      if (!g.leadsTo.some((j) => j.code === r.code)) g.leadsTo.push({ code: r.code, slug: r.slug, title: r.title });
      nextMap.set(id, g);
    }
  }
  const next = [...nextMap.values()].sort((a, b) => b.leadsTo.length - a.leadsTo.length);

  const haveTech = coveredTech(skills, techs);
  const tools: SkillGap[] = techs
    .filter((t) => t.inDemand && !haveTech.has(t.name))
    .map((t) => ({ id: `tech:${t.name}`, kind: 'tool' as const, name: t.name, key: null, reason: 'in_demand' as const, leadsTo: [], importance: null }));

  const out: SkillGap[] = [];
  const push = (g: SkillGap | undefined) => {
    if (!g) return;
    const same = out.find((x) => x.id === g.id);
    if (same) {
      for (const j of g.leadsTo) if (!same.leadsTo.some((x) => x.code === j.code)) same.leadsTo.push(j);
      return;
    }
    if (out.length < GAPS_MAX) out.push({ ...g, leadsTo: [...g.leadsTo] });
  };
  own.slice(0, 2).forEach(push);
  next.filter((g) => !out.some((x) => x.id === g.id)).slice(0, 2).forEach(push);
  push(tools[0]);
  for (const g of [...own.slice(2), ...next, ...tools.slice(1)]) push(g);
  return out;
}

/** For a person-facing name of a gap or skill element (plain label when there is one). */
export function gapLabel(g: Pick<SkillGap, 'id' | 'name' | 'kind'>): string {
  const el = onetById(g.id);
  return el ? labelOf(el) : g.name;
}

/** What a gap means in plain words (O*NET elements), or that it is a tool. */
export function gapWhat(g: Pick<SkillGap, 'id' | 'name'>): string {
  const el = onetById(g.id);
  return el ? (ONET_LABELS[onetKey(el.id)]?.what ?? el.name) : `the software or system ${g.name}`;
}

export { techWords };
