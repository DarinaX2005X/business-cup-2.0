'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { RotateCcw, ShieldAlert } from 'lucide-react';
import { Button, ScoreDial, WeekBar, groupWeek, sound, type WeekTask } from '@/components/kit';
import { computeXray } from '@/domain/xray';
import type { PointsAward, WeekShare, XrayResult } from '@/domain/types';
import { useT } from '@/i18n/client';
import { ApiError, apiFetch } from '@/lib/client/api';
import { ensureProfile, useOptionalProfile } from '@/lib/client/profile';
import { readScan, saveFirstFrame, scanKeyOf, storageBlocked, writeScan } from './data';
import type { Bundle, Chosen, FromMap } from './types';
import st from './week.module.css';

/** The beam crosses the bar in 1.8 s, category totals rise at 1.75 s and roll for 0.9 s. */
const BEAM_MS = 1800;
const SETTLE_MS = 2700;
/** A short hold on the finished frame before the map page takes over. */
const HOLD_MS = 450;

type Saved = { id: string; xray: XrayResult; awards: PointsAward[] };

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function newRequestId() {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 20);
}

/**
 * Step 4: the scan happens on the week the person just edited. Categories are known on the client
 * from the bundle, so the painting never waits for the server; saving runs at the same time and the
 * map page opens as soon as both are done.
 */
export function ScanStage({
  chosen,
  bundle,
  shares,
  tasks,
  shortLabels,
  from,
  sourceText,
  onBack,
}: {
  chosen: Chosen;
  bundle: Bundle;
  shares: WeekShare[];
  tasks: WeekTask[];
  shortLabels: Record<string, string>;
  from: FromMap | null;
  sourceText?: string | null;
  onBack: () => void;
}) {
  const { t, locale } = useT();
  const router = useRouter();
  const profileCtx = useOptionalProfile();
  const profileRef = useRef(profileCtx);
  useEffect(() => {
    profileRef.current = profileCtx;
  }, [profileCtx]);
  const [animDone, setAnimDone] = useState(false);
  // A browser that keeps nothing cannot own a map: the week is shown here, unsaved, and says so.
  const [blocked] = useState(() => typeof window !== 'undefined' && storageBlocked());
  const [state, setState] = useState<'saving' | 'saved' | 'error' | 'local'>(blocked ? 'local' : 'saving');
  const [saved, setSaved] = useState<Saved | null>(null);
  const [scoreShown, setScoreShown] = useState(0);
  // The same week keeps the same request id across reloads, so the server returns the map it already saved.
  const scanKey = scanKeyOf(chosen.code, chosen.jobTitle, shares);
  const [requestId] = useState(() => {
    const rec = typeof window !== 'undefined' ? readScan() : null;
    if (rec && rec.key === scanKey) return rec.requestId;
    const id = newRequestId();
    if (typeof window !== 'undefined') writeScan({ key: scanKey, requestId: id, savedId: null });
    return id;
  });
  const stage = useRef<HTMLDivElement>(null);

  const practice = useMemo(() => {
    const scores = (profileCtx?.profile?.repLog ?? []).map((r) => r.score).filter((x): x is number => typeof x === 'number' && x >= 0);
    if (!scores.length) return { n: 0, avgScore: 0 };
    const norm = scores.map((x) => (x > 1 ? Math.min(1, x / 100) : x));
    return { n: norm.length, avgScore: norm.reduce((a, b) => a + b, 0) / norm.length };
  }, [profileCtx?.profile?.repLog]);
  const local = useMemo(() => computeXray(bundle, shares, { practice }).result, [bundle, shares, practice]);
  const score = saved?.xray.score ?? local.score;

  // The painting: beam, tiles, a soft «place» per tile, totals, then the score.
  useEffect(() => {
    stage.current?.scrollIntoView({ block: 'start', behavior: reducedMotion() ? 'auto' : 'smooth' });
    const timers: number[] = [];
    if (reducedMotion()) {
      timers.push(window.setTimeout(() => setAnimDone(true), 0));
      return () => timers.forEach((x) => window.clearTimeout(x));
    }
    let acc = 0;
    for (const g of groupWeek(tasks)) {
      for (const task of g.tasks) {
        const at = (acc + task.share / 2) / 100;
        acc += task.share;
        timers.push(window.setTimeout(() => sound.play('place'), at * BEAM_MS));
      }
    }
    timers.push(window.setTimeout(() => setScoreShown(local.score), BEAM_MS - 50));
    timers.push(window.setTimeout(() => setAnimDone(true), SETTLE_MS));
    return () => timers.forEach((x) => window.clearTimeout(x));
    // The scan plays once per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dialValue = animDone ? score : scoreShown;

  const save = useCallback(async () => {
    try {
      const creds = await ensureProfile(locale);
      let xray: XrayResult & { pointsAwarded?: PointsAward[] };
      const patchable = from?.isOwner && from.occupationCode === chosen.code;
      if (patchable) {
        const patch = (version: number) => apiFetch<XrayResult>(`/api/xray/${from.id}`, { method: 'PATCH', body: { shares, version }, profile: creds });
        try {
          xray = await patch(from.version);
        } catch (err) {
          const current = (err as ApiError).body as { xray?: XrayResult } | null;
          if (err instanceof ApiError && err.status === 409 && current?.xray) xray = await patch(current.xray.version);
          else throw err;
        }
      } else {
        xray = await apiFetch<XrayResult & { pointsAwarded: PointsAward[] }>('/api/xray', {
          method: 'POST',
          profile: creds,
          body: {
            occupationCode: chosen.code,
            shares,
            jobTitle: chosen.jobTitle.slice(0, 120),
            inputSource: chosen.inputSource,
            requestId,
          },
        });
      }
      const { pointsAwarded = [], ...rest } = xray;
      writeScan({ key: scanKey, requestId, savedId: rest.id });
      // Skills come from the same résumé or description, read in the background; the text is not stored.
      if (sourceText && (chosen.inputSource === 'resume' || chosen.inputSource === 'description')) {
        apiFetch('/api/skills', { method: 'POST', body: { text: sourceText, xray: rest.id }, profile: creds, keepalive: sourceText.length < 60_000 }).catch(() => undefined);
      }
      setSaved({ id: rest.id, xray: rest as XrayResult, awards: pointsAwarded });
      setState('saved');
    } catch {
      setState('error');
    }
  }, [chosen, shares, from, locale, requestId, scanKey, sourceText]);

  useEffect(() => {
    if (!blocked) queueMicrotask(() => void save());
  }, [save, blocked]);

  // Both the painting and the save are done: hand the finished frame to the map page.
  useEffect(() => {
    if (!animDone || !saved) return;
    const timer = window.setTimeout(
      () => {
        saveFirstFrame({ id: saved.id, xray: saved.xray, short: shortLabels });
        const p = profileRef.current;
        p?.setLastScore(saved.xray.score);
        p?.applyAwards(saved.awards);
        void p?.refresh();
        router.push(`/x/${saved.id}`);
      },
      reducedMotion() ? 0 : HOLD_MS,
    );
    return () => window.clearTimeout(timer);
  }, [animDone, saved, shortLabels, router]);

  return (
    <section ref={stage} className={st.scan} aria-labelledby="scan-title">
      <div className={st.verdict}>
        <div className={st.verdictText}>
          <h1 id="scan-title" className={st.verdictJob}>
            {chosen.jobTitle}
          </h1>
          <p className={st.verdictOcc}>{t('start.scan.occupation', { title: chosen.title })}</p>
        </div>
        <div className={st.verdictDial}>
          <ScoreDial value={dialValue} surface="violet" size={220} label={t('start.scan.score')} />
        </div>
      </div>

      <div className={st.scanBar}>
        <WeekBar tasks={tasks} scanning totals orientation="auto" ariaLabel={t('start.week.barLabel')} />
      </div>

      <div className={st.scanStatus} aria-live="polite">
        {state === 'error' ? (
          <div className={st.problem} role="alert">
            <p>{t('start.scan.error')}</p>
            <div className={st.btnRow}>
              <Button
                size="sm"
                icon={<RotateCcw />}
                onClick={() => {
                  setState('saving');
                  void save();
                }}
              >
                {t('start.scan.retry')}
              </Button>
              <Button variant="quiet" size="sm" onClick={onBack}>
                {t('start.scan.back')}
              </Button>
            </div>
          </div>
        ) : state === 'local' ? (
          <div className={st.localNote} role="status">
            <ShieldAlert size={20} strokeWidth={1.75} aria-hidden="true" />
            <div>
              <p>
                <b>{t('start.scan.notSaved')}</b>
              </p>
              <p>{t('start.scan.notSavedLead')}</p>
              <Button variant="quiet" size="sm" onClick={onBack}>
                {t('start.scan.back')}
              </Button>
            </div>
          </div>
        ) : animDone && state === 'saving' ? (
          <p className={st.saving}>
            <span className={st.dot} aria-hidden="true" />
            {t('start.scan.saving')}
          </p>
        ) : !animDone ? (
          <p className="sr-only">{t('start.scan.status')}</p>
        ) : null}
      </div>
    </section>
  );
}
