'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useState } from 'react';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import { CUP_OFFER_UNTIL, cupOfferOpen, planOf, unlockCup, type PlanView, type ProfilePlan } from './plan';

export type CupPhase = 'idle' | 'busy' | 'done' | 'error';

/**
 * The Business Cup unlock as one small state machine shared by /cup and every paywall dialog:
 * create the profile if this browser has none (no sign-up), POST /api/billing/cup, then refresh the
 * profile and the server-rendered parts of the current screen so it opens up in place.
 */
export function useCupUnlock({ onUnlocked, initialPlan, hasMapInitial = false }: { onUnlocked?: () => void; initialPlan?: ProfilePlan | null; hasMapInitial?: boolean } = {}) {
  const { t, f } = useT();
  const prof = useProfile();
  const router = useRouter();
  const [state, setState] = useState<{ phase: CupPhase; code?: string; plan?: ProfilePlan }>({ phase: 'idle' });

  const unlock = useCallback(async () => {
    setState({ phase: 'busy' });
    try {
      await prof.ensure();
      const r = await unlockCup();
      setState({ phase: 'done', plan: r.plan });
      await prof.refresh();
      router.refresh();
      onUnlocked?.();
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      if (code === 'already_pro') await prof.refresh().catch(() => undefined);
      setState({ phase: 'error', code });
    }
  }, [prof, router, onUnlocked]);

  // Until the profile loads, the server's reading of the cookie decides (no flash of the offer for a Pro visitor).
  const fromProfile = planOf(prof.status === 'loading' ? initialPlan : (prof.profile?.plan as ProfilePlan | undefined));
  const plan: PlanView = state.phase === 'done' && state.plan ? planOf(state.plan) : fromProfile;
  const until = f.date(`${CUP_OFFER_UNTIL}T12:00:00Z`, 'long');

  /** What went wrong, in the person's words, or null. */
  const errorText = (() => {
    if (state.phase !== 'error' || !state.code) return null;
    if (state.code === 'already_pro') return t('cup.errors.already_pro');
    if (state.code === 'offer_ended') return t('cup.errors.offer_ended', { date: until });
    const common = t(`common.errors.${state.code}`);
    return common.startsWith('common.errors.') ? t('cup.errors.failed') : `${t('cup.errors.failedShort')} ${common}`;
  })();

  return {
    phase: state.phase,
    code: state.code ?? null,
    plan,
    /** The person already had Pro through Stripe when they tried. */
    alreadyPro: state.code === 'already_pro' || (plan.active && plan.kind !== 'cup' && state.phase !== 'done'),
    offerOpen: cupOfferOpen() && state.code !== 'offer_ended',
    hasMap: prof.status === 'loading' ? hasMapInitial : !!prof.profile?.lastXrayId,
    until,
    runsUntil: plan.periodEnd ? f.date(plan.periodEnd, 'long') : null,
    /** The same date in the short form, for the stamp. */
    runsUntilShort: plan.periodEnd ? f.date(plan.periodEnd, 'medium') : null,
    errorText,
    unlock,
    reset: () => setState({ phase: 'idle' }),
  };
}
