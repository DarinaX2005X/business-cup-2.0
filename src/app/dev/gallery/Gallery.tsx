'use client';

import { TodaySection } from './TodaySection';
import { Volume2, VolumeX } from 'lucide-react';
import { useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import {
  Button,
  CategoryChip,
  Combobox,
  Dialog,
  Dropzone,
  EvidenceBadge,
  EvidenceMeter,
  Field,
  FieldArches,
  KeystoneMark,
  LanguageSwitch,
  KitProvider,
  LockedPanel,
  PointsCounter,
  RepCard,
  ScoreDial,
  Segmented,
  Sheet,
  SheetStack,
  ShopSoon,
  ShopVoucher,
  Skeleton,
  Slider,
  SourceNote,
  StreakWeek,
  TaskRow,
  TaskRowSkeleton,
  Toast,
  WeekBar,
  WeekBarSkeleton,
  Wordmark,
  flyPoints,
  sound,
  useKit,
  weekTasksFrom,
  type CharRange,
  type ComboItem,
  type Locale,
  type OccupationBundle,
  type ReviewMark,
  type Surface,
  type WeekShare,
} from '@/components/kit';
import { electrician, electricianShares, nurse, nurseShares, shortLabels } from '@/components/kit/__fixtures__/occupations';
import { repDocument, repMarks, repUserRanges } from '@/components/kit/__fixtures__/rep';
import { defaultShares, redistributeShares } from '@/domain/shares';
import pipelineNurse from '../../../../tests/fixtures/occupations/29-1141.00.json';
import pipelineElectrician from '../../../../tests/fixtures/occupations/47-2111.00.json';
import { kitStringsFor } from '@/components/kit/locales';
import { shortByLocale } from './strings';
import g from './gallery.module.css';

export type GalleryWidth = '1440' | '768' | '390';

const SECTIONS = [
  ['tokens', 'Tokens'],
  ['week', 'Week Bar'],
  ['rows', 'Task rows'],
  ['meter', 'Evidence'],
  ['rep', 'Rep card'],
  ['score', 'Score'],
  ['points', 'Points and streak'],
  ['shop', 'Shop'],
  ['locked', 'Locked, source, badges'],
  ['buttons', 'Buttons'],
  ['fields', 'Fields and choices'],
  ['overlays', 'Sheet and dialog'],
  ['toast', 'Toast'],
  ['drop', 'Dropzone'],
  ['skeleton', 'Skeleton'],
  ['today', 'Today'],
] as const;

export function Gallery({ initialLang, initialWidth, only }: { initialLang: Locale; initialWidth: GalleryWidth; only?: string[] }) {
  const show = (id: string) => !only || only.includes(id);
  const [lang, setLang] = useState<Locale>(initialLang);
  const [w, setW] = useState<GalleryWidth>(initialWidth);
  const strings = kitStringsFor(lang);
  const soundOn = useSyncExternalStore(sound.subscribe, sound.isEnabled, () => true);

  return (
    <KitProvider locale={lang} strings={strings}>
      <div className={g.page}>
        <header className={g.bar}>
          <div className={g.barIn}>
            <div className={g.brand}>
              <Wordmark size={32} />
              <span className={g.brandSub}>Craft kit</span>
            </div>
            <div className={g.tools}>
              <Segmented
                label="Gallery language"
                value={lang}
                onChange={setLang}
                options={[
                  { value: 'en', label: 'EN' },
                  { value: 'ru', label: 'RU' },
                  { value: 'kk', label: 'KK' },
                ]}
              />
              <Segmented
                label="Container width"
                value={w}
                onChange={setW}
                options={[
                  { value: '1440', label: '1440' },
                  { value: '768', label: '768' },
                  { value: '390', label: '390' },
                ]}
              />
              <Button variant="secondary" size="sm" icon={soundOn ? <Volume2 /> : <VolumeX />} onClick={() => sound.setEnabled(!soundOn)}>
                {soundOn ? 'Sound on' : 'Sound off'}
              </Button>
            </div>
          </div>
          <nav className={g.nav} aria-label="Sections">
            {SECTIONS.map(([id, label]) => (
              <a key={id} href={`#${id}`}>
                {label}
              </a>
            ))}
          </nav>
        </header>

        <main className={g.main}>
          {show('tokens') ? <TokensSection w={w} lang={lang} /> : null}
          {show('week') ? <WeekSection w={w} lang={lang} /> : null}
          {show('rows') ? <RowsSection w={w} /> : null}
          {show('meter') ? <MeterSection w={w} /> : null}
          {show('rep') ? <RepSection w={w} /> : null}
          {show('score') ? <ScoreSection w={w} /> : null}
          {show('points') ? <PointsSection w={w} /> : null}
          {show('shop') ? <ShopSection w={w} /> : null}
          {show('locked') ? <LockedSection w={w} /> : null}
          {show('buttons') ? <ButtonsSection w={w} /> : null}
          {show('fields') ? <FieldsSection w={w} /> : null}
          {show('overlays') ? <OverlaySection w={w} /> : null}
          {show('toast') ? <ToastSection w={w} /> : null}
          {show('drop') ? <DropSection w={w} /> : null}
          {show('skeleton') ? <SkeletonSection w={w} /> : null}
          {show('today') ? <TodaySection w={w} /> : null}
        </main>
      </div>
    </KitProvider>
  );
}

/* ---------- layout helpers ---------- */

function Section({ id, title, note, children, tools }: { id: string; title: string; note?: string; children: ReactNode; tools?: ReactNode }) {
  return (
    <section id={id} className={g.section} aria-labelledby={`${id}-h`}>
      <div className={g.sHead}>
        <div>
          <h2 id={`${id}-h`}>{title}</h2>
          {note ? <p>{note}</p> : null}
        </div>
        {tools ? <div className={g.sTools}>{tools}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Frame({ w, children, field, pad = true }: { w: GalleryWidth; children: ReactNode; field?: boolean; pad?: boolean }) {
  return (
    <div className={g.frameOuter} data-w={w}>
      <div className={`${g.frame} ${field ? `${g.fieldFrame} field` : ''}`} data-pad={pad || undefined} data-surface={field ? 'field' : undefined}>
        {field ? <FieldArches className={g.arches} /> : null}
        {children}
      </div>
    </div>
  );
}

function State({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className={g.state}>
      <div className={g.stateName}>{name}</div>
      {children}
    </div>
  );
}

/* ---------- tokens ---------- */

const PALETTE: [string, [string, string][]][] = [
  ['Brand', [['--field', 'Violet field'], ['--violet', 'Actions on paper'], ['--violet-hi', 'Hover, focus'], ['--violet-deep', 'Pressed, geometry'], ['--violet-soft', 'Selected'], ['--violet-tint', 'Plates']]],
  ['Paper', [['--paper', 'Page'], ['--card', 'Sheets'], ['--sunk', 'Wells, tracks'], ['--line', 'Dividers']]],
  ['Ink', [['--ink', 'Text'], ['--ink-2', 'Secondary text'], ['--on-violet', 'Text on violet'], ['--on-violet-2', 'Secondary on violet']]],
  ['Human edge', [['--apricot', 'You, the human part'], ['--apricot-hi', 'Top light'], ['--apricot-low', 'Lower face'], ['--apricot-deep', 'Text on warm']]],
  ['Machine', [['--machine', 'Hatch lines'], ['--machine-field', 'Under dense hatch'], ['--speed-field', 'Under sparse hatch']]],
  ['System', [['--success', 'Success'], ['--warning', 'Warning'], ['--error', 'Error']]],
];

function TokensSection({ w, lang }: { w: GalleryWidth; lang: Locale }) {
  const samples: Record<Locale, { h: string; b: string }> = {
    en: { h: 'Find the mistake AI made in your own work', b: 'Your week, 40 h across 8 tasks. Score 62 of 100.' },
    ru: { h: 'Найдите ошибку AI в документе вашей профессии', b: 'Ваша неделя, 40 ч и 8 задач. Балл 62 из 100.' },
    kk: { h: 'Өз мамандығыңыздағы AI қатесін табыңыз', b: 'Сіздің аптаңыз, 40 сағ, 8 тапсырма. Ұпай 62/100.' },
  };
  return (
    <Section id="tokens" title="Tokens" note="Values from tokens.css. Category colours always come with a pattern and a word.">
      <Frame w={w}>
        <div className={g.palette}>
          {PALETTE.map(([group, items]) => (
            <div key={group} className={g.palGroup}>
              <h3>{group}</h3>
              {items.map(([v, role]) => (
                <div key={v} className={g.chip}>
                  <span style={{ background: `var(${v})` }} />
                  <b>{v}</b>
                  <small>{role}</small>
                </div>
              ))}
            </div>
          ))}
        </div>

        <h3 className={g.h3}>Type, Onest</h3>
        <div className={g.typeRows}>
          {[
            [96, 700, -0.035, 'Spot the slip'],
            [64, 700, -0.03, samples[lang].h],
            [44, 700, -0.03, samples.ru.h],
            [28, 700, -0.025, samples.kk.h],
            [20, 400, 0, samples[lang].b],
            [17, 400, 0, 'Take metformin 500 mg twice daily with meals. Glucose stayed between 6.1 and 8.4 mmol/L over 48 hours.'],
            [15, 500, 0, samples[lang].b],
            [13, 500, 0, 'Anthropic Economic Index, June 2026'],
          ].map(([size, weight, track, text]) => (
            <div key={`${size}`} className={g.typeRow}>
              <span className={g.spec}>
                <b>{size}</b> {weight}
              </span>
              <span style={{ fontSize: `min(${size}px, 12cqw)`, fontWeight: Number(weight), letterSpacing: `${track}em`, lineHeight: Number(size) > 40 ? 1.02 : 1.5 }}>{text}</span>
            </div>
          ))}
        </div>
        <div className={g.glyphs}>
          {[400, 500, 600, 700, 800].map((wt) => (
            <div key={wt} style={{ fontWeight: wt }}>
              <span className={g.spec}>{wt}</span> Әә Ғғ Ққ Ңң Өө Ұұ Үү Һһ Іі 0123456789 Ёё Йй
            </div>
          ))}
        </div>

        <div className={g.tokenGrid}>
          <div>
            <h3 className={g.h3}>Radii</h3>
            <div className={g.radii}>
              {[
                ['panel', 28],
                ['card', 20],
                ['control', 14],
                ['chip', 10],
                ['tag', 6],
              ].map(([n, r]) => (
                <div key={n} style={{ borderRadius: Number(r) }}>
                  <b>{r}</b>
                  {n}
                </div>
              ))}
            </div>
          </div>
          <div>
            <h3 className={g.h3}>Elevation</h3>
            <div className={g.shadows}>
              {['rest', 'raised', 'overlay'].map((s) => (
                <div key={s} style={{ boxShadow: `var(--shadow-${s})` }}>
                  {s}
                </div>
              ))}
            </div>
          </div>
        </div>

        <h3 className={g.h3}>Hatching on paper and on the violet field</h3>
        <div className={g.hatches}>
          <div style={{ background: 'var(--hatch-dense), var(--machine-field)' }}>dense, 6 px</div>
          <div style={{ background: 'var(--hatch-sparse), var(--speed-field)' }}>sparse, 12 px</div>
          <div className="field" data-surface="field" style={{ backgroundImage: 'var(--hatch-dense-violet)' }}>
            dense on violet
          </div>
          <div className="field" data-surface="field" style={{ backgroundImage: 'var(--hatch-sparse-violet)' }}>
            sparse on violet
          </div>
        </div>

        <h3 className={g.h3}>Mark</h3>
        <div className={g.marks}>
          <div className={g.markCard}>
            <Wordmark size={56} />
            <div className={g.sizes}>
              {[96, 48, 32, 16].map((s) => (
                <KeystoneMark key={s} size={s} />
              ))}
            </div>
          </div>
          <div className={`${g.markCard} field`}>
            <Wordmark size={56} tone="violet" />
            <div className={g.sizes}>
              {[96, 48, 32, 16].map((s) => (
                <KeystoneMark key={s} size={s} tone="violet" />
              ))}
            </div>
          </div>
          <div className={g.markCard}>
            <Wordmark size={40} tone="ink" />
            <KeystoneMark size={16} tone="ink" />
          </div>
          <div className={`${g.markCard} field`}>
            <Wordmark size={40} tone="light" />
            <KeystoneMark size={16} tone="light" />
          </div>
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- week bar ---------- */

type Prof = 'nurse' | 'electrician';
type Orient = 'auto' | 'horizontal' | 'vertical';

function useWeek(prof: Prof, lang: Locale) {
  const bundle = prof === 'nurse' ? nurse : electrician;
  const base = prof === 'nurse' ? nurseShares : electricianShares;
  const short = lang === 'en' ? shortLabels : shortByLocale[lang];
  return { bundle, base, short };
}

function WeekSection({ w, lang }: { w: GalleryWidth; lang: Locale }) {
  const [total, setTotal] = useState<string | null>(null);
  const [prof, setProf] = useState<Prof>('nurse');
  const [surface, setSurface] = useState<Surface>('paper');
  const [orient, setOrient] = useState<Orient>('auto');
  const [scanKey, setScanKey] = useState(0);
  const { bundle, base, short } = useWeek(prof, lang);
  const [shares, setShares] = useState<WeekShare[]>(base);
  const [dragging, setDragging] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [prevBase, setPrevBase] = useState(base);
  if (prevBase !== base) {
    setPrevBase(base);
    setShares(base);
    setSel(null);
  }

  const ready = useMemo(() => weekTasksFrom(bundle, base, short), [bundle, base, short]);
  const edited = useMemo(() => weekTasksFrom(bundle, shares, short), [bundle, shares, short]);
  const selected = sel ?? ready.find((t) => t.category === 'human_edge')?.id ?? null;
  const human = ready.filter((t) => t.category === 'human_edge');
  const growth = Object.fromEntries(human.map((t, i) => [t.id, [1, 0.6, 0.3][i] ?? 0]));
  const field = surface === 'violet';
  const editTask = edited.find((t) => t.category === 'human_edge') ?? edited[0];

  return (
    <Section
      id="week"
      title="Week Bar"
      note="Six states on illustrative nurse and electrician bundles. Auto turns vertical under 560 px; hover a tile for the full task, click to select."
      tools={
        <>
          <Segmented label="Profession" value={prof} onChange={setProf} options={[{ value: 'nurse', label: 'Nurse' }, { value: 'electrician', label: 'Electrician' }]} />
          <Segmented label="Surface" value={surface} onChange={setSurface} options={[{ value: 'paper', label: 'Paper' }, { value: 'violet', label: 'Violet' }]} />
          <Segmented label="Orientation" value={orient} onChange={setOrient} options={[{ value: 'auto', label: 'Auto' }, { value: 'horizontal', label: 'Horizontal' }, { value: 'vertical', label: 'Vertical' }]} />
        </>
      }
    >
      <div className={g.stack}>
        <Frame w={w} field={field}>
          <State name="Empty">
            <WeekBar tasks={[]} variant={surface} emptyLabel="Your week will be laid out here, hour by hour" />
          </State>
        </Frame>
        <Frame w={w} field={field}>
          <State name="Scanning">
            <WeekBar key={`${scanKey}-${prof}-${orient}`} tasks={ready} scanning variant={surface} orientation={orient} />
            <div className={g.below}>
              <Button variant={field ? 'lavender' : 'secondary'} size="sm" onClick={() => setScanKey((k) => k + 1)}>
                Replay the scan
              </Button>
            </div>
          </State>
        </Frame>
        <Frame w={w} field={field}>
          <State name="Ready">
            <WeekBar tasks={ready} variant={surface} orientation={orient} onSelect={setSel} />
          </State>
        </Frame>
        <Frame w={w} field={field}>
          <State name="Selected">
            <WeekBar tasks={ready} variant={surface} orientation={orient} selectedId={selected} onSelect={setSel} />
          </State>
        </Frame>
        <Frame w={w} field={field}>
          <State name="Editing, drag the slider">
            <WeekBar tasks={edited} variant={surface} orientation={orient} editable dragging={dragging} selectedId={editTask?.id} />
            {editTask ? (
              <div className={g.editRow}>
                <TaskRow
                  id={editTask.id}
                  text={editTask.text}
                  short={editTask.label}
                  useShort
                  share={editTask.share}
                  category={editTask.category}
                  evidence={bundle.tasks.find((t) => t.id === editTask.id)!.evidence}
                  editing
                  showMeter={false}
                  surface={surface}
                  onShareChange={(id, v) => setShares((s) => redistributeShares(s, id, v))}
                  onDragChange={setDragging}
                />
              </div>
            ) : null}
          </State>
        </Frame>
        <Frame w={w} field={field}>
          <State name="Neutral: unpainted, in the given order (the /start week editor)">
            <WeekBar tasks={edited} tone="neutral" variant={surface} orientation="horizontal" editable dragging={dragging} selectedId={editTask?.id} onSelect={() => undefined} />
          </State>
        </Frame>
        <Frame w={w} field={field}>
          <State name="Totals as buttons (onTotal)">
            <WeekBar tasks={ready} variant={surface} orientation={orient} onTotal={(c) => setTotal(c)} />
            {total ? <p className={g.small}>Opened the breakdown of: {total}</p> : null}
          </State>
        </Frame>
        <Frame w={w} field={field}>
          <State name="Grown after practice">
            <WeekBar tasks={ready} variant={surface} orientation={orient} growth={growth} />
          </State>
        </Frame>
        <PipelineWeeks w={w} surface={surface} orient={orient} />
      </div>
    </Section>
  );
}

function PipelineWeeks({ w, surface, orient }: { w: GalleryWidth; surface: Surface; orient: Orient }) {
  const bundles = [pipelineNurse, pipelineElectrician] as unknown as OccupationBundle[];
  return (
    <>
      {bundles.map((b) => {
        const tasks = weekTasksFrom(b, defaultShares(b));
        return (
          <Frame key={b.code} w={w} field={surface === 'violet'}>
            <State name={`From the data pipeline: ${b.title}, typical week, full O*NET texts as labels`}>
              <WeekBar tasks={tasks} variant={surface} orientation={orient} onSelect={() => undefined} />
            </State>
          </Frame>
        );
      })}
    </>
  );
}

/* ---------- task rows ---------- */

function RowsSection({ w }: { w: GalleryWidth }) {
  const t = Object.fromEntries([...nurse.tasks, ...electrician.tasks].map((x) => [x.id, x]));
  const [share, setShare] = useState(23);
  const [sel, setSel] = useState<string | null>('rn-01');
  const row = (id: string, extra: Partial<Parameters<typeof TaskRow>[0]> = {}) => (
    <TaskRow id={id} text={t[id].text} short={shortLabels[id]} share={extra.share ?? 12} category={t[id].evidence.category} evidence={t[id].evidence} onSelect={(x) => setSel((s) => (s === x ? null : x))} selected={sel === id} {...extra} />
  );
  return (
    <Section id="rows" title="Task rows" note="Hover, selected with its evidence, editing with a slider, no data, the longest O*NET text, both evidence levels, disabled with a reason.">
      <Frame w={w}>
        <div className={g.rows}>
          <State name="Observed, selectable (click)">{row('rn-01', { share: 15 })}</State>
          <State name="Research estimate">{row('rn-05', { share: 23 })}</State>
          <State name="Editing">
            {row('rn-03', {
              share,
              editing: true,
              onShareChange: (_id, v) => setShare(v),
            })}
          </State>
          <State name="No data yet">{row('rn-08', { share: 4 })}</State>
          <State name="Longest O*NET text, clamped to three lines">{row('el-05', { share: 17 })}</State>
          <State name="Short label instead of the full text">{row('el-05', { share: 17, useShort: true })}</State>
          <State name="Without categories, with details and an action (the /start week editor)">
            {row('rn-03', {
              share,
              editing: true,
              hideCategory: true,
              useShort: true,
              showMeter: false,
              sliderMax: 60,
              onShareChange: (_id, v) => setShare(v),
              details: <p className={g.small}>From your résumé: “Chart assessments in Epic in real time.”</p>,
              actions: (
                <Button variant="quiet" size="sm">
                  Remove
                </Button>
              ),
            })}
          </State>
          <State name="Disabled with a reason">
            {row('el-04', { share: 24, editing: true, disabled: true, disabledReason: 'Confirm your week first, then adjust the hours.' })}
          </State>
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- evidence meter ---------- */

function MeterSection({ w }: { w: GalleryWidth }) {
  const base = nurse.tasks[0].evidence;
  return (
    <Section id="meter" title="Evidence meter" note="Share of AI work conversations against the busiest task of the release, and how they split between AI doing it and doing it together.">
      <Frame w={w}>
        <div className={g.grid2}>
          <State name="Observed">
            <EvidenceMeter evidence={base} />
          </State>
          <State name="Not observed, research rating E1">
            <EvidenceMeter evidence={nurse.tasks[2].evidence} />
          </State>
          <State name="Tiny share, mostly together">
            <EvidenceMeter evidence={{ ...base, aeiShare: 0.000031, aeiAutomation: 0.05 }} />
          </State>
          <State name="Large share, almost all AI">
            <EvidenceMeter evidence={{ ...base, aeiShare: 0.0185, aeiAutomation: 0.97 }} />
          </State>
          <State name="Seen in AI usage, but rarely">
            <EvidenceMeter evidence={{ ...nurse.tasks[2].evidence, observed: false, seenRarely: true, aeiShare: 0.00004 }} />
          </State>
          <State name="No research rating">
            <EvidenceMeter evidence={{ ...base, observed: false, aeiShare: null, theoryLabel: null, evidenceLevel: 'none' }} />
          </State>
          <State name="Compact">
            <EvidenceMeter evidence={base} compact />
          </State>
        </div>
      </Frame>
      <Frame w={w} field>
        <div className={g.grid2}>
          <EvidenceMeter evidence={base} surface="violet" />
          <EvidenceMeter evidence={nurse.tasks[4].evidence} surface="violet" />
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- rep card ---------- */

function RepSection({ w }: { w: GalleryWidth }) {
  const { num } = useKit();
  const [ranges, setRanges] = useState<CharRange[]>([]);
  const [mode, setMode] = useState<'answer' | 'review'>('answer');
  return (
    <Section id="rep" title="Rep card" note="Answer: drag across words or tap a word, tap a highlight to remove it, or use the keyboard. Review: marks appear one by one; tap a mark to open its note.">
      <div className={g.stack}>
        <Frame w={w}>
          <State name="Answer, interactive">
            <RepCard
              document={repDocument}
              mode={mode}
              ranges={ranges}
              onRangesChange={setRanges}
              marks={mode === 'review' ? marksFor(ranges) : []}
              footer={
                <div className={g.repFoot}>
                  <span>
                    {mode === 'answer' ? `${num(ranges.length)} highlighted` : `${num(marksFor(ranges).filter((m) => m.kind === 'found').length)} of 3 caught`}
                  </span>
                  <div className={g.repBtns}>
                    {mode === 'answer' ? (
                      <Button disabledReason={ranges.length ? undefined : 'Highlight at least one place first'} onClick={() => setMode('review')}>
                        Check my answer
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={() => {
                          setMode('answer');
                          setRanges([]);
                        }}
                      >
                        Start again
                      </Button>
                    )}
                  </div>
                </div>
              }
            />
          </State>
        </Frame>
        <Frame w={w}>
          <State name="Answer with highlights">
            <RepCard document={repDocument} mode="answer" ranges={repUserRanges} />
          </State>
        </Frame>
        <Frame w={w} field>
          <State name="Review, every kind of mark">
            <RepCard
              document={repDocument}
              mode="review"
              ranges={repUserRanges}
              marks={repMarks}
              surface="violet"
              footer={
                <div className={g.totals}>
                  <div>
                    <b>2 of 3</b>mistakes caught
                  </div>
                  <div>
                    <b style={{ color: 'var(--violet)' }}>+80</b>points
                  </div>
                  <div>
                    <b>62 → 63</b>Irreplaceability score
                  </div>
                </div>
              }
            />
          </State>
        </Frame>
      </div>
    </Section>
  );
}

/** Gallery stand-in for the server grader: overlap with a planted error counts as a catch. */
function marksFor(ranges: CharRange[]) {
  const errors = repMarks.filter((m) => m.kind === 'found' || m.kind === 'missed');
  const out: ReviewMark[] = errors.map((m) => {
    const hit = ranges.some((r) => r[0] < m.end && r[1] > m.start);
    return { ...m, kind: hit ? ('found' as const) : ('missed' as const), title: hit ? 'Caught' : 'Slipped past' };
  });
  let firstFalse = true;
  ranges.forEach((r, i) => {
    if (errors.some((m) => r[0] < m.end && r[1] > m.start)) return;
    out.push({ id: `u${i}`, kind: firstFalse ? 'first_false' : 'false', start: r[0], end: r[1], title: 'Not a mistake', body: firstFalse ? 'This part is correct. The first extra mark is free.' : 'This part is correct.', n: undefined });
    firstFalse = false;
  });
  return out;
}

/* ---------- score ---------- */

function ScoreSection({ w }: { w: GalleryWidth }) {
  const [v, setV] = useState(62);
  const [d, setD] = useState<number | undefined>(undefined);
  return (
    <Section id="score" title="Score" note="Rolls only when the value changes.">
      <Frame w={w}>
        <div className={g.scores}>
          <ScoreDial value={0} size={220} />
          <ScoreDial value={37} size={220} />
          <ScoreDial value={88} size={220} />
          <ScoreDial value={100} size={220} />
          <div className={g.col}>
            <ScoreDial value={v} delta={d} size={220} />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setV((x) => Math.min(100, x + 2));
                setD(2);
              }}
            >
              Practise once more
            </Button>
          </div>
        </div>
      </Frame>
      <Frame w={w}>
        <State name="Compact, for headers and rows">
          <div className={g.row}>
            <ScoreDial value={v} delta={d} variant="compact" />
            <ScoreDial value={91} variant="compact" />
          </div>
        </State>
      </Frame>
      <Frame w={w} field>
        <div className={g.grid2}>
          <ScoreDial value={v} delta={d} surface="violet" size={260} />
          <div className={g.col}>
            <ScoreDial value={v} delta={d} variant="strip" surface="violet" />
            <ScoreDial value={v} variant="compact" surface="violet" />
          </div>
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- points ---------- */

function PointsSection({ w }: { w: GalleryWidth }) {
  const [pts, setPts] = useState(1240);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <Section id="points" title="Points and streak">
      <Frame w={w}>
        <div className={g.miniHeader}>
          <Wordmark size={28} />
          <PointsCounter value={pts} />
        </div>
        <div className={g.row}>
          <Button
            ref={btn}
            variant="primary"
            onClick={async () => {
              await flyPoints(btn.current, 40);
              setPts((p) => p + 40);
            }}
          >
            Fly +40
          </Button>
        </div>
        <div className={g.streaks}>
          <StreakWeek done={[false, false, false, false, false, false, false]} today={0} />
          <StreakWeek done={[true, false, true, false, false, false, false]} today={3} />
          <StreakWeek done={[true, true, true, true, true, true, true]} today={6} />
        </div>
      </Frame>
      <Frame w={w} field>
        <div className={g.row}>
          <PointsCounter value={pts} surface="violet" />
          <StreakWeek done={[true, true, true, false, false, false, false]} today={2} surface="violet" />
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- shop ---------- */

function ShopSection({ w }: { w: GalleryWidth }) {
  const [busy, setBusy] = useState(false);
  const [code, setCode] = useState<string | undefined>(undefined);
  return (
    <Section id="shop" title="Shop" note="Enough points, not enough, redeemed (press Redeem: it tears along the line and turns over), coming soon.">
      <Frame w={w}>
        <div className={g.shelf}>
          <ShopVoucher
            big="10%"
            bigSub="off yearly"
            brand="Irreplaceable Pro"
            name="Your next yearly plan, paid once"
            cost={250}
            balance={1240}
            redeeming={busy}
            code={code}
            onRedeem={() => {
              setBusy(true);
              window.setTimeout(() => {
                setBusy(false);
                setCode('IRR-7Q4K-2M');
              }, 700);
            }}
          />
          <ShopVoucher big="1 month" bigSub="of Pro" brand="Irreplaceable Pro" name="Daily reps, the 90-day plan and your portfolio" cost={9000} balance={1240} />
          <ShopVoucher big="Claude Pro" bigSub="1 month" brand="AI tools" tone="deep" showMark={false} name="Pilot reward: we email you when your code is ready" cost={25000} balance={1240} />
          <ShopSoon />
        </div>
        <div className={g.below}>
          <Button variant="quiet" size="sm" onClick={() => setCode(undefined)}>
            Reset the redeemed voucher
          </Button>
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- locked, source, badges ---------- */

function LockedSection({ w }: { w: GalleryWidth }) {
  return (
    <Section id="locked" title="Locked panel, source note, badges and chips">
      <Frame w={w}>
        <div className={g.grid2}>
          <LockedPanel title="Your 90-day plan" reason="The plan turns your week into twelve weeks of reps. It is part of Pro." action={<Button>Start your 7-day free trial</Button>} />
          <LockedPanel shape="list" title="Review kit" reason="A brief for your next review, built from your proof. Part of Pro." action={<Button variant="secondary">See what Pro includes</Button>} />
        </div>
        <div className={g.badgeRows}>
          <div className={g.row}>
            <EvidenceBadge level="observed" />
            <EvidenceBadge level="estimate" />
            <EvidenceBadge level="none" />
            <EvidenceBadge level="observed" size="sm" />
          </div>
          <div className={g.row}>
            <CategoryChip category="ai_does" />
            <CategoryChip category="ai_speeds" />
            <CategoryChip category="human_edge" />
            <CategoryChip category="no_data" />
          </div>
          <SourceNote href="https://www.anthropic.com/economic-index">Anthropic Economic Index, release of 26 June 2026</SourceNote>
          <SourceNote>O*NET 31.0 task statements, CC BY 4.0</SourceNote>
        </div>
      </Frame>
      <Frame w={w} field>
        <div className={g.badgeRows}>
          <div className={g.row}>
            <EvidenceBadge level="observed" surface="violet" />
            <EvidenceBadge level="estimate" surface="violet" />
            <EvidenceBadge level="none" surface="violet" />
          </div>
          <div className={g.row}>
            <CategoryChip category="ai_does" surface="violet" />
            <CategoryChip category="human_edge" surface="violet" />
          </div>
          <SourceNote surface="violet">Anthropic Economic Index, June 2026</SourceNote>
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- buttons ---------- */

function ButtonsSection({ w }: { w: GalleryWidth }) {
  const [loading, setLoading] = useState(false);
  return (
    <Section id="buttons" title="Buttons" note="Hover lifts 2 px, press compresses to 0.97 and springs back, focus ring 3 px. Disabled states say why.">
      <Frame w={w}>
        <div className={g.btnGrid}>
          <Button>Map my week</Button>
          <Button variant="secondary">Upload your résumé</Button>
          <Button variant="quiet">How we measure</Button>
          <Button variant="destructive">Delete my profile</Button>
          <Button size="lg">Start my free rep</Button>
          <Button size="sm">Check my answer</Button>
          <Button
            loading={loading}
            loadingLabel="Checking your answer"
            onClick={() => {
              setLoading(true);
              window.setTimeout(() => setLoading(false), 1800);
            }}
          >
            Check my answer
          </Button>
          <Button disabledReason="Highlight at least one place first">Check my answer</Button>
        </div>
      </Frame>
      <Frame w={w} field>
        <div className={g.btnGrid}>
          <Button variant="lavender" size="lg">
            Map my week
          </Button>
          <Button variant="apricot" size="lg">
            Start my free rep
          </Button>
          <Button variant="ghost">Save to portfolio</Button>
          <Button variant="lavender" disabledReason="Type your job title first">
            Map my week
          </Button>
          <Button variant="lavender" loading loadingLabel="Finding your job">
            Map my week
          </Button>
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- fields ---------- */

const TITLES: { value: string; label: string; aliases: string[] }[] = [
  { value: '29-1141.00', label: 'Registered Nurses', aliases: ['RN', 'staff nurse'] },
  { value: '29-2061.00', label: 'Licensed Practical and Licensed Vocational Nurses', aliases: ['LPN', 'LVN'] },
  { value: '29-1171.00', label: 'Nurse Practitioners', aliases: ['NP'] },
  { value: '31-1131.00', label: 'Nursing Assistants', aliases: ['CNA'] },
  { value: '29-1151.00', label: 'Nurse Anesthetists', aliases: ['CRNA'] },
];

/** Gallery stand-in for the search route: a hit on an alias shows what matched. */
function searchTitles(q: string): ComboItem[] {
  const n = q.trim().toLowerCase();
  if (!n) return [];
  return TITLES.flatMap((t) => {
    if (t.label.toLowerCase().includes(n)) return [{ value: t.value, label: t.label }];
    const a = t.aliases.find((x) => x.toLowerCase().startsWith(n));
    return a ? [{ value: t.value, label: t.label, matched: a }] : [];
  });
}

function FieldsSection({ w }: { w: GalleryWidth }) {
  const [langPick, setLangPick] = useState<Locale>('en');
  const [q, setQ] = useState('nurs');
  const [q2, setQ2] = useState('rn');
  const [picked, setPicked] = useState('');
  const [val, setVal] = useState(18);
  const [seg, setSeg] = useState('month');
  const filter = searchTitles;
  return (
    <Section id="fields" title="Fields, combobox, slider, segmented">
      <Frame w={w}>
        <div className={g.grid2}>
          <div className={g.col}>
            <Field label="Your salary, per year" placeholder="93,600" inputMode="numeric" help="Used only to estimate the pay tied to each task." />
            <Field label="Job title" defaultValue="Registerd nurse" error="We could not find this title. Check the spelling or pick from the list." />
            <Slider label="Share of week" value={val} onChange={setVal} format={(v) => `${v}% · ${((v * 40) / 100).toFixed(1)} h`} />
            <Segmented label="Billing" value={seg} onChange={setSeg} options={[{ value: 'month', label: 'Monthly, $19' }, { value: 'year', label: 'Yearly, $119' }]} />
            <LanguageSwitch label="Language" value={langPick} onChange={setLangPick} locales={['en', 'ru', 'kk']} />
          </div>
          <div className={g.comboBox}>
            <Combobox label="What do you do?" query={q} onQueryChange={setQ} items={filter(q)} onPick={(i) => { setPicked(i.label); setQ(i.label); }} defaultOpen placeholder="Registered nurse" />
            {picked ? <p className={g.small}>Picked: {picked}</p> : null}
          </div>
        </div>
      </Frame>
      <Frame w={w} field>
        <div className={g.comboBox}>
          <Combobox
            label="What do you do?"
            surface="violet"
            size="lg"
            query={q2}
            onQueryChange={setQ2}
            items={filter(q2)}
            onPick={(i) => setQ2(i.label)}
            defaultOpen
            placeholder="Registered nurse"
            trailing={
              <Button variant="lavender" size="lg">
                Map my week
              </Button>
            }
          />
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- overlays ---------- */

function OverlaySection({ w }: { w: GalleryWidth }) {
  const [dlg, setDlg] = useState(false);
  const [sheet, setSheet] = useState(false);
  const body = (
    <>
      <p>Your week map, your reps and your points will be removed from this device and from our storage. This cannot be undone.</p>
    </>
  );
  const foot = (close: () => void) => (
    <>
      <Button variant="secondary" onClick={close}>
        Keep my profile
      </Button>
      <Button variant="destructive" onClick={close}>
        Delete my profile
      </Button>
    </>
  );
  return (
    <Section id="overlays" title="Sheet and dialog" note="Shown open in place; the buttons open the real modal layers with focus trap and Escape.">
      <Frame w={w} pad={false}>
        <div className={g.grid2}>
          <Dialog inline open onClose={() => undefined} title="Delete your profile?" footer={foot(() => undefined)}>
            {body}
          </Dialog>
          <Sheet inline open onClose={() => undefined} title="Charting">
            <div className={g.col}>
              <p style={{ color: 'var(--ink)' }}>{nurse.tasks[0].text}</p>
              <EvidenceMeter evidence={nurse.tasks[0].evidence} />
            </div>
          </Sheet>
        </div>
      </Frame>
      <div className={g.row} style={{ marginTop: 16 }}>
        <Button variant="secondary" onClick={() => setDlg(true)}>
          Open the dialog
        </Button>
        <Button variant="secondary" onClick={() => setSheet(true)}>
          Open the sheet
        </Button>
      </div>
      <Dialog open={dlg} onClose={() => setDlg(false)} title="Delete your profile?" footer={foot(() => setDlg(false))}>
        {body}
      </Dialog>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Charting">
        <div className={g.col}>
          <p style={{ color: 'var(--ink)' }}>{nurse.tasks[0].text}</p>
          <EvidenceMeter evidence={nurse.tasks[0].evidence} />
        </div>
      </Sheet>
    </Section>
  );
}

/* ---------- toast ---------- */

function ToastSection({ w }: { w: GalleryWidth }) {
  const { s } = useKit();
  const [shown, setShown] = useState(false);
  return (
    <Section id="toast" title="Toast" note="Appears next to the control that caused it, with Undo where an action can be reversed.">
      <Frame w={w}>
        <div className={g.toasts}>
          <Toast message="Removed “Charting” from your week" actionLabel={s.undo} onAction={() => undefined} onClose={() => undefined} duration={0} />
          <Toast tone="success" message="Saved to your portfolio" onClose={() => undefined} duration={0} />
          <Toast tone="error" message="Could not save your week. Your changes are still here." actionLabel="Try again" onAction={() => undefined} duration={0} />
        </div>
        <div className={g.anchor}>
          <Button variant="secondary" onClick={() => setShown(true)}>
            Remove this task
          </Button>
          {shown ? <Toast className={g.anchored} message="Task removed" actionLabel={s.undo} onAction={() => setShown(false)} onClose={() => setShown(false)} /> : null}
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- dropzone ---------- */

function DropSection({ w }: { w: GalleryWidth }) {
  const [state, setState] = useState<'idle' | 'reading' | 'error' | 'done'>('idle');
  const [name, setName] = useState('');
  return (
    <Section id="drop" title="Dropzone" note="Idle, drag over, reading, failed, done. The first one is live: drop or pick a file.">
      <Frame w={w}>
        <div className={g.grid3}>
          <Dropzone
            state={state}
            fileName={name}
            onFile={(f) => {
              setName(f.name);
              setState('reading');
              window.setTimeout(() => setState(/\.(pdf|docx|txt)$/i.test(f.name) ? 'done' : 'error'), 1400);
            }}
          />
          <Dropzone onFile={() => undefined} forceActive />
          <Dropzone onFile={() => undefined} state="reading" fileName="resume-okafor-2026.pdf" />
          <Dropzone onFile={() => undefined} state="error" />
          <Dropzone onFile={() => undefined} state="done" fileName="resume-okafor-2026.pdf" />
        </div>
      </Frame>
    </Section>
  );
}

/* ---------- skeleton ---------- */

function SkeletonSection({ w }: { w: GalleryWidth }) {
  return (
    <Section id="skeleton" title="Skeleton" note="The same silhouette as the Week Bar and the task rows, so content lands in place.">
      <Frame w={w}>
        <WeekBarSkeleton />
        <div style={{ marginTop: 32 }}>
          <TaskRowSkeleton />
          <TaskRowSkeleton />
          <Skeleton width="40%" height={14} />
        </div>
      </Frame>
      <div className={g.artRow}>
        <Frame w={w} field>
          <SheetStack className={g.art} fit="contain" title="A stack of work sheets, one line under an apricot marker" />
        </Frame>
      </div>
    </Section>
  );
}
