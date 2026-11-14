import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { loadEnv } from './ai/load-env';

/**
 * Saves the real pipeline output the landing shows into src/components/landing/fixtures/.
 *
 *   npx tsx scripts/landing-fixtures.ts            the nurse week from the sample résumé (two model calls, cents)
 *   npx tsx scripts/landing-fixtures.ts --typical  no model: the typical O*NET week of the same occupation
 *
 * Everything is produced by the functions the product runs:
 *   week.json   readSample('nurse') → analyzeResume → proposeWeek → computeXray (the /start flow)
 *   reps.json   one bank rep per type for three occupations (checked with checkBankEntry), with trapSpots for the Delegate inputs
 * The landing never types a number by hand: it reads these files.
 */

loadEnv();

const ROOT = process.cwd();
const OUT = path.join(ROOT, 'src', 'components', 'landing', 'fixtures');
const typical = process.argv.includes('--typical');

const REPS = [
  { key: 'slip', file: '29-1141.00/slip-1.json' },
  { key: 'delegate', file: '13-2011.00/delegate-1.json' },
  { key: 'edge', file: '47-2111.00/edge-1.json' },
] as const;

/** Typical weeks shown next to the nurse's, to compare jobs that a single risk number flattens. */
const OTHER_WEEKS = ['13-2011.00', '15-1252.00'] as const;

const readJson = (file: string) => JSON.parse(readFileSync(file, 'utf8'));
const write = (name: string, value: unknown) => {
  writeFileSync(path.join(OUT, name), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote fixtures/${name}`);
};

async function main() {
  const { readSample } = await import('@/content/samples');
  const { analyzeResume } = await import('@/server/xray/resume');
  const { proposeWeek, typicalWeek } = await import('@/server/xray/week');
  const { loadBundle, getLocalTitles } = await import('@/server/xray/data');
  const { readTips } = await import('@/server/xray/tips');
  const { computeXray } = await import('@/domain/xray');
  const { checkBankEntry } = await import('@/server/reps/bank');
  const { trapSpots } = await import('@/domain/reps');
  mkdirSync(OUT, { recursive: true });

  /* ---------- the nurse week ---------- */
  let code = '29-1141.00';
  let jobTitle: string | null = null;
  let week;
  if (typical) {
    const bundle = await loadBundle(code);
    if (!bundle) throw new Error(`no bundle for ${code}`);
    week = typicalWeek(bundle);
  } else {
    const text = await readSample('nurse');
    const analysis = await analyzeResume({ text, mode: 'resume', locale: 'en' });
    const top = analysis.ranked[0];
    if (!top) throw new Error('the sample résumé matched no occupation');
    code = top.code;
    jobTitle = analysis.facts.title?.trim() || null;
    const bundle = await loadBundle(code);
    if (!bundle) throw new Error(`no bundle for ${code}`);
    week = await proposeWeek({ bundle, duties: analysis.facts.duties, locale: 'en' });
  }
  const bundle = (await loadBundle(code))!;
  const { result, breakdown } = computeXray(bundle, week.shares);
  const used = new Set(result.shares.map((s) => s.taskId));

  // Labels and translations the product already generated for this occupation (read only, never generated here).
  const texts: Record<string, Record<string, { text: string; short: string }>> = {};
  const titles: Record<string, string> = { en: bundle.title };
  for (const locale of ['ru', 'kk'] as const) {
    const record = await readTips(code, locale).catch(() => null);
    if (record) {
      const map: Record<string, { text: string; short: string }> = {};
      for (const t of bundle.tasks) {
        const r = record.tasks[t.id];
        if (used.has(t.id) && r?.text && r.short) map[t.id] = { text: r.text, short: r.short };
      }
      if (Object.keys(map).length === used.size) texts[locale] = map;
    }
    const local = (await getLocalTitles(locale).catch(() => null))?.get(code);
    if (local) titles[locale] = local;
  }

  const { defaultShares } = await import('@/domain/shares');
  const others = [];
  for (const c of OTHER_WEEKS) {
    const b = await loadBundle(c);
    if (!b) throw new Error(`no bundle for ${c}`);
    const shares = defaultShares(b);
    const x = computeXray(b, shares).result;
    const byId = new Map(b.tasks.map((t) => [t.id, t]));
    const t: Record<string, string> = { en: b.title };
    for (const locale of ['ru', 'kk'] as const) {
      const local = (await getLocalTitles(locale).catch(() => null))?.get(c);
      if (local) t[locale] = local;
    }
    others.push({
      code: b.code,
      slug: b.slug,
      titles: t,
      hours: x.hours,
      percent: x.percent,
      baseScore: x.baseScore,
      weekExposure: x.weekExposure,
      tasks: x.shares.map((s) => {
        const task = byId.get(s.taskId)!;
        return { id: task.id, label: task.short ?? task.text, text: task.text, share: s.share, category: task.evidence.category, evidenceLevel: task.evidence.evidenceLevel };
      }),
    });
  }

  write('week.json', {
    source: week.source,
    sample: typical ? null : 'resume-nurse.txt',
    jobTitle: jobTitle ?? bundle.title,
    titles,
    bundle: {
      code: bundle.code,
      slug: bundle.slug,
      title: bundle.title,
      description: bundle.description,
      wage: bundle.wage,
      typicalHumanShare: bundle.typicalHumanShare,
      dataVersion: bundle.dataVersion,
      related: [],
      relatedCount: 0,
      tasks: bundle.tasks.filter((t) => used.has(t.id)),
    },
    result,
    breakdown,
    texts,
    others,
  });

  /* ---------- one bank rep per type ---------- */
  const reps: Record<string, unknown> = {};
  for (const { key, file } of REPS) {
    const checked = checkBankEntry(readJson(path.join(ROOT, 'data', 'rep-bank', file)));
    if (!checked.ok) throw new Error(`${file}: ${checked.problem}`);
    const e = checked.entry;
    const occ = await loadBundle(e.occupationCode);
    const task = occ?.tasks.find((t) => t.id === e.taskId);
    const base = { file, occupationCode: e.occupationCode, occupation: occ?.title ?? null, taskShort: task?.short ?? null, title: e.title };
    if (e.type === 'slip') {
      // The answers stay in the bank: this rep can be someone's practice rep.
      reps[key] = { ...base, docType: e.docType ?? null, document: e.slip.document, mistakes: e.slip.errors.length };
    } else if (e.type === 'delegate') {
      const shown = e.delegate.traps[0];
      reps[key] = {
        ...base,
        scenario: e.delegate.scenario,
        goal: e.delegate.goal,
        inputs: e.delegate.inputs,
        criteria: e.delegate.criteria.length,
        traps: e.delegate.traps.length,
        // one trap is shown on the landing, the others stay hidden
        shownTrap: { description: shown.description, spots: trapSpots([shown], e.delegate.inputs, undefined).map((s) => [s.start, s.end]) },
      };
    } else {
      reps[key] = { ...base, scenario: e.edge.scenario, persona: e.edge.personaPublic, opening: e.edge.opening, goal: e.edge.goal, criteria: e.edge.criteria.map((c) => c.text) };
    }
  }
  write('reps.json', reps);

  console.log(`week: ${bundle.title}, ${week.source}, score ${result.baseScore}, human ${result.percent.human_edge}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
