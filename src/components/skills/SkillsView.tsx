'use client';

import Link from 'next/link';
import { Check, Plus, TrendingUp, X } from 'lucide-react';
import { Fragment, useCallback, useEffect, useId, useRef, useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { CupOffer } from '@/components/cup/CupOffer';
import { Button } from '@/components/kit/Button';
import { Field } from '@/components/kit/Field';
import { LockedPanel } from '@/components/kit/Shop';
import { Skeleton } from '@/components/kit/Skeleton';
import { sound } from '@/components/kit/sound';
import { Toast } from '@/components/kit/Toast';
import btn from '@/components/kit/controls.module.css';
import { readResumeFile } from '@/components/start/readFile';
import type { SkillKind } from '@/domain/types';
import { useT } from '@/i18n/client';
import { ApiError, apiFetch } from '@/lib/client/api';
import type { SkillGap, SkillNeed, SkillsPatch, SkillsResponse, SkillView } from '@/server/growth/types';
import st from './skills.module.css';

type State = { kind: 'loading' } | { kind: 'ready'; data: SkillsResponse } | { kind: 'error' };
type Notice = { key: number; text: string; tone: 'neutral' | 'error'; undo?: () => void };
type PatchResponse = SkillsResponse & { item: { id: string; name: string } | null };

const GROUPS: SkillKind[] = ['skill', 'tool', 'knowledge'];

/**
 * The Skills tab of the week map: one plain sentence on top, the skills the person brings (read from
 * their résumé, kept or added by them) and the few worth building next for their job and the jobs near
 * it. Nothing here is filled in for them: an empty profile gets a place to paste the résumé.
 */
export function SkillsView({ xrayId }: { xrayId: string }) {
  const { t } = useT();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [selected, setSelected] = useState<string | null>(null);
  const [fresh, setFresh] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [rereading, setRereading] = useState(false);
  const [keepingAll, setKeepingAll] = useState(false);
  const seq = useRef(0);

  const load = useCallback(async () => {
    try {
      const data = await apiFetch<SkillsResponse>(`/api/skills?xray=${encodeURIComponent(xrayId)}`);
      setState({ kind: 'ready', data });
    } catch {
      setState({ kind: 'error' });
    }
  }, [xrayId]);

  useEffect(() => {
    void load();
  }, [load]);

  const say = (text: string, tone: Notice['tone'] = 'neutral', undo?: () => void) => setNotice({ key: ++seq.current, text, tone, undo });

  /** A change with an optimistic picture; on failure the last saved state comes back. */
  const patch = async (body: SkillsPatch, optimistic?: (d: SkillsResponse) => SkillsResponse): Promise<PatchResponse | null> => {
    if (state.kind !== 'ready') return null;
    const before = state.data;
    if (optimistic) setState({ kind: 'ready', data: optimistic(before) });
    try {
      const res = await apiFetch<PatchResponse>('/api/skills', { method: 'PATCH', body: { ...body, xray: xrayId } });
      setState({ kind: 'ready', data: res });
      return res;
    } catch (err) {
      setState({ kind: 'ready', data: before });
      say(err instanceof ApiError && err.code === 'limit' ? t('skills.add.limit') : t('skills.errors.save'), 'error');
      return null;
    }
  };

  const setSource = (ids: Set<string> | 'all') => (d: SkillsResponse): SkillsResponse => ({
    ...d,
    skills: d.skills.map((s) => (s.source === 'resume' && (ids === 'all' || ids.has(s.id)) ? { ...s, source: 'confirmed' } : s)),
  });

  const keep = async (s: SkillView) => {
    sound.play('tap');
    setFresh(s.id);
    await patch({ op: 'confirm', id: s.id }, setSource(new Set([s.id])));
  };

  const keepAll = async () => {
    setKeepingAll(true);
    sound.play('tap');
    setFresh('*');
    await patch({ op: 'confirm_all' }, setSource('all'));
    setKeepingAll(false);
  };

  const remove = async (s: SkillView) => {
    setSelected(null);
    const res = await patch({ op: 'remove', id: s.id }, (d) => ({ ...d, skills: d.skills.filter((x) => x.id !== s.id), count: d.count - 1 }));
    if (res) {
      say(t('skills.removed', { name: s.name }), 'neutral', async () => {
        setNotice(null);
        const back = await patch({ op: 'restore', id: s.id });
        if (back) setFresh(s.id);
      });
    }
  };

  const add = async (name: string): Promise<boolean> => {
    const res = await patch({ op: 'add', name });
    if (!res) return false;
    if (res.item) {
      setFresh(res.item.id);
      sound.play('tap');
      say(t('skills.add.added', { name: res.item.name }));
    }
    return true;
  };

  if (state.kind === 'loading') {
    return (
      <div className={st.skills} aria-busy="true" aria-label={t('skills.loading')}>
        <Skeleton width="62%" height={30} />
        <div className={st.columns}>
          <div className={st.panel}>
            <div className={st.chips}>
              {[120, 96, 150, 88, 132, 104, 76].map((w, i) => (
                <Skeleton key={i} width={w} height={40} radius={12} />
              ))}
            </div>
          </div>
          <div className={st.gapsPanel}>
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} height={92} radius={18} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <section className={st.problem} role="alert">
        <p>{t('skills.errors.load')}</p>
        <Button variant="primary" onClick={() => (setState({ kind: 'loading' }), void load())}>
          {t('skills.retry')}
        </Button>
      </section>
    );
  }

  const d = state.data;
  const occupation = d.occupation.title;

  if (d.locked) return <LockedSkills data={d} xrayId={xrayId} onUnlocked={() => void load()} />;

  const reader = (
    <Reader
      xrayId={xrayId}
      again={d.status === 'ready'}
      onDone={(data) => {
        setState({ kind: 'ready', data });
        setRereading(false);
        setFresh('*');
        sound.play('found');
      }}
      onCancel={d.status === 'ready' ? () => setRereading(false) : undefined}
    />
  );

  if (d.status === 'empty') {
    return (
      <div className={st.skills}>
        {reader}
        <section className={st.panel} aria-labelledby="skills-add">
          <h3 id="skills-add" className={st.h3}>
            {t('skills.empty.orAdd')}
          </h3>
          <AddSkill onAdd={add} />
        </section>
        <Source />
        <Dock notice={notice} onClose={() => setNotice(null)} />
      </div>
    );
  }

  const unchecked = d.skills.filter((s) => s.source === 'resume').length;
  const sel = d.skills.find((s) => s.id === selected) ?? null;

  return (
    <div className={st.skills}>
      <Summary data={d} />

      {d.otherOccupation ? <p className={st.note}>{t('skills.otherJob')}</p> : null}

      <div className={st.columns}>
        <section className={st.panel} aria-labelledby="skills-yours">
          <div className={st.panelHead}>
            <h3 id="skills-yours" className={st.h3}>
              {t('skills.yours.title')}
            </h3>
            {!rereading ? (
              <button type="button" className={st.textBtn} onClick={() => setRereading(true)}>
                {t('skills.again.open')}
              </button>
            ) : null}
          </div>

          {rereading ? reader : null}

          {unchecked > 0 ? (
            <div className={st.review}>
              <p>{t('skills.yours.review')}</p>
              <Button variant="secondary" size="sm" icon={<Check size={18} strokeWidth={2.25} />} loading={keepingAll} loadingLabel={t('skills.yours.keepingAll')} onClick={keepAll}>
                {t('skills.yours.keepAll')}
              </Button>
            </div>
          ) : null}

          {GROUPS.map((kind) => {
            const list = d.skills.filter((s) => s.kind === kind);
            if (!list.length) return null;
            const open = sel && sel.kind === kind ? sel : null;
            return (
              <div key={kind} className={st.group}>
                <h4 className={st.groupTitle}>{t(`skills.yours.groups.${kind}`)}</h4>
                <ul className={st.chips}>
                  {list.map((s, i) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        className={st.chip}
                        data-source={s.source}
                        data-fresh={fresh === s.id || (fresh === '*' && s.source !== 'resume') || undefined}
                        aria-expanded={selected === s.id}
                        aria-controls={`skill-detail-${kind}`}
                        style={{ '--i': i } as CSSProperties}
                        onClick={() => setSelected((x) => (x === s.id ? null : s.id))}
                      >
                        <span>{s.name}</span>
                        {s.years ? <span className={st.chipYears}>{t('skills.yours.years', { count: s.years })}</span> : null}
                        {s.hot ? <TrendingUp className={st.chipHot} size={15} strokeWidth={2.25} aria-label={t('skills.detail.hot')} /> : null}
                        {s.source === 'resume' ? <span className="sr-only">, {t('skills.yours.unchecked')}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
                {open ? <Detail id={`skill-detail-${kind}`} skill={open} onKeep={() => keep(open)} onRemove={() => remove(open)} onClose={() => setSelected(null)} /> : null}
              </div>
            );
          })}

          <AddSkill onAdd={add} />
        </section>

        <section className={st.gapsPanel} aria-labelledby="skills-gaps">
          <h3 id="skills-gaps" className={st.h3}>
            {t('skills.gaps.title')}
          </h3>
          {d.gaps.length ? (
            <>
              <ol className={st.gaps}>
                {d.gaps.map((g, i) => (
                  <GapCard key={g.id} gap={g} occupation={occupation} index={i} onHave={() => add(gapName(g, t))} />
                ))}
              </ol>
              <p className={st.gapsFoot}>{t('skills.gaps.inPlan')}</p>
            </>
          ) : (
            <p className={st.gapsNone}>{t('skills.gaps.none')}</p>
          )}
        </section>
      </div>

      <Source />
      <Dock notice={notice} onClose={() => setNotice(null)} />
    </div>
  );
}

/* ---------- pieces ---------- */

type T = ReturnType<typeof useT>['t'];

function gapName(n: Pick<SkillNeed, 'key' | 'name'>, t: T): string {
  return n.key ? t(`skills.onet.${n.key}.name`) : n.name;
}

function gapWhat(n: Pick<SkillNeed, 'key'>, t: T): string | null {
  return n.key ? t(`skills.onet.${n.key}.what`) : null;
}

/** «You bring 24 skills to your work. The two worth building next are A and B.», with A and B on plates. */
function Summary({ data }: { data: SkillsResponse }) {
  const { t } = useT();
  const [a, b] = data.gaps;
  const key = b ? 'skills.summary.two' : a ? 'skills.summary.one' : 'skills.summary.none';
  const text = t(key, { count: data.count, first: '\u0001', second: '\u0002' });
  const parts = text.split(/(\u0001|\u0002)/);
  return (
    <p className={st.summary}>
      {parts.map((p, i) =>
        p === '\u0001' && a ? (
          <span key={i} className={st.plate}>
            {gapName(a, t)}
          </span>
        ) : p === '\u0002' && b ? (
          <span key={i} className={st.plate}>
            {gapName(b, t)}
          </span>
        ) : (
          <Fragment key={i}>{p}</Fragment>
        ),
      )}
    </p>
  );
}

function Detail({ id, skill, onKeep, onRemove, onClose }: { id: string; skill: SkillView; onKeep: () => void; onRemove: () => void; onClose: () => void }) {
  const { t } = useT();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [skill.id]);
  const counts = skill.onetKey ? t(`skills.onet.${skill.onetKey}.name`) : null;
  return (
    <div ref={ref} id={id} className={st.detail} role="region" aria-label={skill.name}>
      <button type="button" className={st.detailClose} aria-label={t('skills.detail.close')} onClick={onClose}>
        <X size={18} strokeWidth={2} />
      </button>
      {skill.quotes.length ? (
        <figure className={st.quote}>
          <figcaption>{t('skills.detail.quote')}</figcaption>
          {skill.quotes.map((q) => (
            <blockquote key={q}>
              <mark>{q}</mark>
            </blockquote>
          ))}
        </figure>
      ) : null}
      <ul className={st.facts}>
        {counts ? <li>{t('skills.detail.countsToward', { name: counts })}</li> : null}
        {skill.hot ? <li>{t('skills.detail.hot')}</li> : null}
      </ul>
      <div className={st.detailActions}>
        {skill.source === 'resume' ? (
          <Button variant="primary" size="sm" icon={<Check size={18} strokeWidth={2.25} />} onClick={onKeep}>
            {t('skills.detail.keep')}
          </Button>
        ) : (
          <span className={st.kept}>
            <Check size={16} strokeWidth={2.5} aria-hidden="true" />
            {skill.source === 'added' ? t('skills.detail.added') : t('skills.detail.kept')}
          </span>
        )}
        <Button variant="quiet" size="sm" onClick={onRemove}>
          {t('skills.detail.remove')}
        </Button>
      </div>
    </div>
  );
}

function GapCard({ gap, occupation, index, onHave }: { gap: SkillGap; occupation: string; index: number; onHave: () => Promise<boolean> }) {
  const { t } = useT();
  const [busy, setBusy] = useState(false);
  const what = gapWhat(gap, t);
  return (
    <li className={st.gap} style={{ '--i': index } as CSSProperties}>
      <span className={st.slot} aria-hidden="true">
        <Plus size={18} strokeWidth={2} />
      </span>
      <div className={st.gapBody}>
        <h4 className={st.gapName}>{gapName(gap, t)}</h4>
        {what ? <p className={st.gapWhat}>{what}</p> : null}
        <p className={st.gapWhy}>{t(`skills.gaps.reason.${gap.reason}`, { occupation })}</p>
        {gap.leadsTo.length ? (
          <p className={st.leads}>
            <span>{t('skills.gaps.leadsTo')}</span>{' '}
            {gap.leadsTo.slice(0, 3).map((j, i, all) => (
              <Fragment key={j.code}>
                <Link href={`/pivot/${j.slug}`} className={st.leadLink}>
                  {j.title}
                </Link>
                {i < all.length - 1 ? ', ' : ''}
              </Fragment>
            ))}
          </p>
        ) : null}
        <button
          type="button"
          className={st.have}
          disabled={busy}
          aria-busy={busy || undefined}
          onClick={async () => {
            setBusy(true);
            const ok = await onHave();
            if (!ok) setBusy(false);
          }}
        >
          {busy ? t('skills.gaps.having') : t('skills.gaps.have')}
        </button>
      </div>
    </li>
  );
}

function AddSkill({ onAdd }: { onAdd: (name: string) => Promise<boolean> }) {
  const { t } = useT();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = value.trim();
    if (name.replace(/[^\p{L}]/gu, '').length < 2) {
      setError(t('skills.add.tooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    const ok = await onAdd(name);
    setBusy(false);
    if (ok) setValue('');
  };
  return (
    <form className={st.add} onSubmit={submit} noValidate>
      <Field
        label={t('skills.add.label')}
        placeholder={t('skills.add.placeholder')}
        value={value}
        maxLength={60}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        error={error ?? undefined}
        trailing={
          <Button type="submit" variant="secondary" loading={busy} loadingLabel={t('skills.add.adding')}>
            {t('skills.add.button')}
          </Button>
        }
      />
    </form>
  );
}

/** Paste or upload a résumé; the text goes to POST /api/skills once and is not kept. */
function Reader({ xrayId, again, onDone, onCancel }: { xrayId: string; again: boolean; onDone: (d: SkillsResponse) => void; onCancel?: () => void }) {
  const { t } = useT();
  const id = useId();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState<{ page: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async () => {
    if (text.trim().split(/\s+/).length < 8) {
      setError(t('skills.errors.too_short'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDone(await apiFetch<SkillsResponse>('/api/skills', { method: 'POST', body: { text, xray: xrayId } }));
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'generic';
      const key =
        code === 'not_work' || code === 'too_short' || code === 'ai_unavailable' || code === 'rate_limited' ? `skills.errors.${code}` : 'skills.errors.generic';
      setError(t(key));
      setBusy(false);
    }
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    try {
      const out = await readResumeFile(file, (p, total) => setPage({ page: p, total }));
      setText(out.trim());
    } catch {
      setError(t('skills.errors.file'));
    } finally {
      setPage(null);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <section className={st.reader} data-again={again || undefined} aria-labelledby={`${id}-title`}>
      {!again ? (
        <>
          <h2 id={`${id}-title`} className={st.readerTitle}>
            {t('skills.empty.title')}
          </h2>
          <p className={st.readerLead}>{t('skills.empty.lead')}</p>
        </>
      ) : (
        <p id={`${id}-title`} className={st.readerLead}>
          {t('skills.again.lead')}
        </p>
      )}
      <label htmlFor={`${id}-text`} className={st.label}>
        {t('skills.empty.field')}
      </label>
      <textarea
        id={`${id}-text`}
        className={st.textarea}
        rows={again ? 6 : 9}
        placeholder={t('skills.empty.placeholder')}
        value={text}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          if (error) setError(null);
        }}
      />
      {error ? (
        <p id={`${id}-err`} className={st.error} role="alert">
          {error}
        </p>
      ) : null}
      {page ? <p className={st.hint}>{t('skills.empty.reading', page)}</p> : null}
      <div className={st.readerActions}>
        <Button variant="primary" loading={busy} loadingLabel={t('skills.empty.running')} onClick={run}>
          {t('skills.empty.run')}
        </Button>
        <label className={`${btn.btn} ${btn.b_secondary} ${btn.s_md} ${st.upload}`} aria-disabled={busy || undefined}>
          <input ref={fileRef} type="file" accept=".pdf,.txt,.md,.rtf,text/plain,application/pdf" className="sr-only" disabled={busy} onChange={(e) => void onFile(e.target.files?.[0])} />
          <span>{t('skills.empty.upload')}</span>
        </label>
        {onCancel && !busy ? (
          <button type="button" className={st.textBtn} onClick={onCancel}>
            {t('skills.again.cancel')}
          </button>
        ) : null}
      </div>
      {busy ? <p className={st.hint}>{t('skills.empty.runningLead')}</p> : null}
    </section>
  );
}

/** Free: what their job relies on most (public O*NET data), and the rest locked. */
function LockedSkills({ data, xrayId, onUnlocked }: { data: SkillsResponse; xrayId: string; onUnlocked: () => void }) {
  const { t } = useT();
  const reason = data.count > 0 ? `${t('skills.locked.reason')} ${t('skills.locked.found', { count: data.count })}` : t('skills.locked.reason');
  const action: ReactNode = (
    <span className={st.proWays}>
      <Link href={`/pricing?from=${xrayId}`} className={`${btn.btn} ${btn.b_primary} ${btn.s_md}`}>
        {t('xray.pro.trial')}
      </Link>
      <CupOffer onUnlocked={onUnlocked} />
    </span>
  );
  return (
    <div className={st.skills}>
      <section className={st.panel} aria-labelledby="skills-needs">
        <h3 id="skills-needs" className={st.h3}>
          {t('skills.needs.title', { occupation: data.occupation.title })}
        </h3>
        <ol className={st.needs}>
          {data.needs.map((n, i) => (
            <li key={n.id} style={{ '--i': i } as CSSProperties}>
              <b>{gapName(n, t)}</b>
              <span>{gapWhat(n, t)}</span>
            </li>
          ))}
        </ol>
      </section>
      <LockedPanel shape="list" title={t('skills.locked.title')} reason={reason} action={action} />
      <Source />
    </div>
  );
}

function Source() {
  const { t } = useT();
  return (
    <p className={st.source}>
      {t('skills.source')}{' '}
      <Link href="/method" className={st.sourceLink}>
        {t('skills.sourceLink')}
      </Link>
    </p>
  );
}

function Dock({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  const { t } = useT();
  if (!notice) return null;
  return (
    <div className={st.dock}>
      <Toast
        key={notice.key}
        message={notice.text}
        tone={notice.tone === 'error' ? 'error' : 'neutral'}
        actionLabel={notice.undo ? t('skills.undo') : undefined}
        onAction={notice.undo}
        onClose={onClose}
        duration={notice.undo ? 8000 : 4000}
      />
    </div>
  );
}
