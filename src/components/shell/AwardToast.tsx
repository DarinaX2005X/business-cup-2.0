'use client';

import { Check, X } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { PointsAward } from '@/domain/types';
import { useT } from '@/i18n/client';
import st from './shell.module.css';

/** Awards that arrive within this window join one toast (a rep and its streak bonus are one moment). */
const MERGE_MS = 1500;
const SHOW_MS = 4500;

/**
 * Points earned without a control to fly from: one quiet receipt under the header counter (above the tab
 * bar on phones). One award reads «+150 7-day streak»; several read «+190 points» with their labels listed.
 */
export function useAwardToast() {
  const [toast, setToast] = useState<{ awards: PointsAward[]; at: number; key: number } | null>(null);
  const push = useCallback((awards: PointsAward[]) => {
    const list = awards.filter((a) => a.points > 0);
    if (!list.length) return;
    const now = Date.now();
    setToast((cur) => (cur && now - cur.at < MERGE_MS ? { awards: [...cur.awards, ...list], at: now, key: cur.key } : { awards: list, at: now, key: now }));
  }, []);
  const close = useCallback(() => setToast(null), []);
  return { toast, push, close };
}

export function AwardToast({ toast, onClose }: { toast: { awards: PointsAward[]; at: number; key: number } | null; onClose: () => void }) {
  const { t, f } = useT();
  const timer = useRef(0);
  // Each merged award restarts the clock, so the receipt stays long enough to read the whole list.
  useEffect(() => {
    if (!toast) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(onClose, SHOW_MS);
    return () => window.clearTimeout(timer.current);
  }, [toast, onClose]);
  if (!toast) return null;
  const { awards } = toast;
  const total = awards.reduce((n, a) => n + a.points, 0);
  const one = awards.length === 1;
  return (
    <div className={st.awardDock}>
      <div key={toast.key} className={st.award} role="status">
        <span className={st.awardIcon} aria-hidden="true">
          <Check size={16} strokeWidth={2.2} />
        </span>
        <div className={st.awardText}>
          {one ? (
            <p>
              <b>+{f.integer(total)}</b> {t(awards[0].labelKey)}
            </p>
          ) : (
            <>
              <p>
                <b>{t('common.points.earned', { count: total })}</b>
              </p>
              <ul>
                {awards.map((a, i) => (
                  <li key={i}>
                    <span>{t(a.labelKey)}</span> <b>+{f.integer(a.points)}</b>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
        <button type="button" className={st.awardClose} aria-label={t('common.actions.close')} onClick={onClose}>
          <X size={16} strokeWidth={1.75} />
        </button>
      </div>
    </div>
  );
}
