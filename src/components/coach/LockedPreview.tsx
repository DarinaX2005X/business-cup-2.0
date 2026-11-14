'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CupOffer } from '@/components/cup/CupOffer';
import { Button } from '@/components/kit/Button';
import { CategorySwatch } from '@/components/kit/Evidence';
import { TIER_PRICES } from '@/domain/points';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import { getPreview, type CoachPreview, type CoachStarter } from './api';
import { CoachLine, UserLine } from './CoachChat';
import st from './coach.module.css';

type Load = { phase: 'loading' } | { phase: 'ready'; preview: CoachPreview } | { phase: 'failed' };

/**
 * Free and Pro: the coach page with one real exchange on the person's own week, marked as a preview, the
 * other questions they could ask, and the way in: «Upgrade to Max» (Stripe Checkout for the Max tier, id
 * `coach`; /pricing when checkout cannot start, e.g. a Pro subscription that switches in the portal) or
 * the Business Cup 2.0 offer, which opens Max free.
 */
export function LockedPreview({ starters, onUnlocked }: { starters: CoachStarter[]; onUnlocked(): void }) {
  const { t, f } = useT();
  const router = useRouter();
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [upgrading, setUpgrading] = useState(false);
  const max = TIER_PRICES.coach;

  const upgrade = async () => {
    if (upgrading) return;
    setUpgrading(true);
    try {
      const { url } = await apiFetch<{ url: string }>('/api/billing/checkout', { method: 'POST', body: { tier: 'coach', interval: 'month' } });
      window.location.assign(url);
    } catch {
      setUpgrading(false);
      router.push('/pricing');
    }
  };

  useEffect(() => {
    let live = true;
    getPreview()
      .then((preview) => live && setLoad({ phase: 'ready', preview }))
      .catch(() => live && setLoad({ phase: 'failed' }));
    return () => {
      live = false;
    };
  }, [attempt]);

  const question = load.phase === 'ready' ? load.preview.question : starters[0]?.q;
  const others = starters.filter((s) => s.q !== question).slice(0, 3);
  const at = new Date(0).toISOString();

  return (
    <>
      <div className={st.log} data-locked>
        <p className={st.previewTag}>
          <b>{t('coach.locked.tag')}</b>
          <span>{t('coach.locked.tagLong')}</span>
        </p>
        <ol className={st.thread}>
          {question ? (
            <li>
              <UserLine m={{ id: 'preview-q', role: 'user', text: question, at }} />
            </li>
          ) : null}
          <li>
            {load.phase === 'ready' ? (
              <CoachLine m={{ id: 'preview-a', role: 'coach', text: load.preview.answer, at }} actions={false} />
            ) : load.phase === 'loading' ? (
              <CoachLine m={{ id: 'preview-a', role: 'coach', text: '', at, state: 'waiting' }} actions={false} />
            ) : (
              <div className={st.failRow} role="alert">
                <span>{t('coach.locked.failed')}</span>
                <Button size="sm" variant="secondary" onClick={() => { setLoad({ phase: 'loading' }); setAttempt((n) => n + 1); }}>
                  {t('coach.errors.retry')}
                </Button>
              </div>
            )}
          </li>
        </ol>
        {others.length ? (
          <div className={st.moreAsk}>
            <p className={st.moreAskTitle}>{t('coach.locked.more')}</p>
            <ul>
              {others.map((s) => (
                <li key={s.q}>
                  <span className={st.starterQ}>{s.q}</span>
                  {s.basis ? (
                    <span className={st.starterBasis}>
                      {s.cat ? <CategorySwatch category={s.cat} size="sm" /> : null}
                      {s.basis}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      <section className={st.lockPanel} aria-labelledby="coach-lock-title">
        <div className={st.lockText}>
          <h2 id="coach-lock-title" className={st.lockTitle}>
            {t('coach.locked.title')}
          </h2>
          <p>{t('coach.locked.body')}</p>
          <p className={st.lockPrice}>
            {t('coach.locked.price', { month: f.currency(max.month.usd), yearMonthly: f.currency(Math.round((max.year.usd / 12) * 100) / 100, { cents: true }) })}
          </p>
        </div>
        <div className={st.lockActions}>
          <Button variant="apricot" loading={upgrading} onClick={() => void upgrade()}>
            {t('coach.locked.cta')}
          </Button>
          <CupOffer surface="violet" onUnlocked={onUnlocked} />
        </div>
      </section>
    </>
  );
}
