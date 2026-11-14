'use client';

import { ChevronDown } from 'lucide-react';
import Link from 'next/link';
import { useId, useState } from 'react';
import { Button } from '@/components/kit/Button';
import { RollingNumber } from '@/components/kit/RollingNumber';
import { useT } from '@/i18n/client';
import { rewardName } from './names';
import type { EarnRule, Reward } from './types';
import st from './shop.module.css';

/** Actions that get a fresh profile to its first reward, in the order a first session meets them (rule ids). */
const FIRST_STEPS: { id: string; href: (mapHref: string | null) => string }[] = [
  { id: 'xray_completed', href: () => '/start' },
  { id: 'first_rep', href: () => '/today' },
  { id: 'ai_or_me', href: () => '/today' },
  { id: 'week_confirmed', href: (m) => m ?? '/start' },
];

/**
 * The top of the shop: the balance, the nearest reward as a ruler filling with the person's own points,
 * the reward that is ready now, and «How to earn» with the full rules table.
 */
export function Wallet({
  balance,
  ready,
  next,
  first,
  rules,
  earned,
  fresh,
  mapHref,
  onRedeem,
}: {
  balance: number;
  /** The best reward this balance pays for now. */
  ready: Reward | null;
  /** The cheapest reward still out of reach. */
  next: Reward | null;
  /** The cheapest reward of all, the person's first goal. */
  first: Reward | null;
  rules: EarnRule[];
  /** Point types this profile has already received. */
  earned: Set<string>;
  /** Nothing redeemed yet: the way to the first reward is shown step by step. */
  fresh: boolean;
  mapHref: string | null;
  onRedeem: (r: Reward) => void;
}) {
  const { t, f } = useT();
  const [open, setOpen] = useState(false);
  const tableId = useId();
  const nextCost = next?.cost ?? 0;
  const pct = next && nextCost ? Math.max(0, Math.min(100, (balance / nextCost) * 100)) : 100;
  const beforeFirst = fresh && !!first && balance < (first.cost ?? 0);
  const steps = beforeFirst
    ? FIRST_STEPS.map((s) => ({ ...s, rule: rules.find((r) => r.id === s.id) }))
        .filter((s) => s.rule && !earned.has(s.rule.type))
        .slice(0, 3)
    : [];

  return (
    <section className={st.wallet} aria-labelledby="balance">
      <div className={st.walletTop}>
        <h1 id="balance" className={st.balance}>
          <i className={st.coinBig} aria-hidden="true" />
          <RollingNumber value={balance} className={st.balanceV} duration={900} />
          <span className={st.balanceK}>{t('shop.points')}</span>
        </h1>

        <div className={st.goal}>
          {next ? (
            <>
              <p className={st.goalLine}>
                <b>{t('shop.goal.to', { points: f.number(nextCost - balance), reward: rewardName(t, next) })}</b>
                <span>{t('shop.goal.of', { balance: f.number(balance), cost: f.number(nextCost) })}</span>
              </p>
              <span
                className={st.ruler}
                role="progressbar"
                aria-label={rewardName(t, next)}
                aria-valuemin={0}
                aria-valuemax={nextCost}
                aria-valuenow={balance}
                aria-valuetext={t('shop.goal.of', { balance: f.number(balance), cost: f.number(nextCost) })}
              >
                <i style={{ width: `${Math.max(pct, balance > 0 ? 3 : 0)}%` }} />
              </span>
            </>
          ) : (
            <p className={st.goalLine}>
              <b>{t('shop.goal.all')}</b>
            </p>
          )}
          {ready ? (
            <div className={st.ready}>
              <p>
                {t('shop.goal.ready')} <b>{rewardName(t, ready)}</b>
              </p>
              <Button size="sm" onClick={() => onRedeem(ready)}>
                {t('shop.redeem.button')}
              </Button>
            </div>
          ) : null}
          {steps.length ? (
            <div className={st.steps}>
              <p>{t('shop.goal.firstSteps', { reward: rewardName(t, first!) })}</p>
              <ul>
                {steps.map((s) => (
                  <li key={s.id}>
                    <Link href={s.href(mapHref)} className={st.step}>
                      {t(s.rule!.labelKey)}
                      <b>{s.rule!.max > s.rule!.min ? t('shop.earn.range', { from: f.number(s.rule!.min), to: f.number(s.rule!.max) }) : t('shop.earn.one', { points: f.number(s.rule!.min) })}</b>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>

      {rules.length ? (
        <div className={st.earn}>
          <button type="button" className={st.earnToggle} aria-expanded={open} aria-controls={tableId} onClick={() => setOpen((o) => !o)}>
            {t('shop.earn.title')}
            <ChevronDown strokeWidth={2} aria-hidden="true" />
          </button>
          {open ? <EarnList id={tableId} rules={rules} /> : null}
        </div>
      ) : null}
    </section>
  );
}

/** «How to earn» as plain actions with what each one brings, collapsed until asked for. */
function EarnList({ id, rules }: { id: string; rules: EarnRule[] }) {
  const { t, f } = useT();
  return (
    <ul id={id} className={st.earnList}>
      {rules.map((r) => (
        <li key={r.id}>
          <span>{t(r.labelKey)}</span>
          <b>{r.max > r.min ? t('shop.earn.range', { from: f.number(r.min), to: f.number(r.max) }) : t('shop.earn.one', { points: f.number(r.min) })}</b>
        </li>
      ))}
    </ul>
  );
}
