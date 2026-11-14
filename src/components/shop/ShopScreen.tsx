'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { planOf, type ProfilePlan } from '@/components/cup/plan';
import { Button } from '@/components/kit/Button';
import { Skeleton } from '@/components/kit/Skeleton';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import type { ShopFixture } from './__fixtures__/shop';
import { loadShop, redeem } from './api';
import { History } from './History';
import { discountOnYearly, rewardName } from './names';
import { RedeemDialog } from './RedeemDialog';
import { Coupon, Freeze, GiftCard, Pass, SoonSlot, type Offer } from './Tickets';
import type { RedeemResult, Redemption, Reward, ShopData } from './types';
import { Wallet } from './Wallet';
import st from './shop.module.css';

/** Hint flag: the header's reward dot on «Shop» goes away once the shop has been opened. */
const SHOP_HINT = 'shop_opened';

const isPro = (id: string) => id.startsWith('pro_');
const byCost = (a: Reward, b: Reward) => (a.cost ?? 0) - (b.cost ?? 0);

/**
 * /shop: points as a shelf of values. The balance and the nearest reward on top, then the shelves (Pro
 * discounts and months, AI tools, the streak freeze, room for partners) and the person's own rewards.
 * `fixture` (development only) replaces the API and the profile with a stored state.
 */
export function ShopScreen({ fixture }: { fixture?: ShopFixture }) {
  const { t, f } = useT();
  const prof = useProfile();
  const live = !fixture;
  const [data, setData] = useState<ShopData | null>(fixture?.data ?? null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [fx, setFx] = useState(() => (fixture ? { balance: fixture.data.points.balance, redemptions: fixture.redemptions, freezes: fixture.freezes } : null));
  const [shown, setShown] = useState<Record<string, Redemption>>({});
  const [turnedBack, setTurnedBack] = useState<Set<string>>(() => new Set());
  const [asking, setAsking] = useState<Reward | null>(null);

  const status = prof.status;
  const profileId = prof.profile?.id ?? null;
  const fetchShop = useCallback(
    () =>
      loadShop().then(
        (d) => {
          setData(d);
          setLoadError(null);
        },
        (err) => setLoadError(err instanceof ApiError ? err.code : 'network'),
      ),
    [],
  );
  useEffect(() => {
    if (!live || status === 'loading') return;
    void fetchShop();
  }, [live, status, profileId, fetchShop]);
  const load = () => {
    setLoadError(null);
    void fetchShop();
  };

  // Opening the shop clears the «reward available» dot on the header's Shop link.
  const { update, profile } = prof;
  const hinted = useRef(false);
  useEffect(() => {
    if (!live || !profile || hinted.current || profile.hintsSeen.includes(SHOP_HINT)) return;
    hinted.current = true;
    update({ hintsSeen: [SHOP_HINT] }).catch(() => undefined);
  }, [live, profile, update]);

  const balance = fx ? fx.balance : status === 'ready' ? prof.balance : (data?.points.balance ?? 0);
  const redemptions = useMemo(() => (fx ? fx.redemptions : (profile?.redemptions ?? [])), [fx, profile]);
  const freezes = fx ? fx.freezes : (profile?.streak.freezes ?? 0);
  const plan = planOf((fixture ? fixture.plan : profile?.plan) as ProfilePlan | undefined);
  const subscribed = plan.active && plan.stripe;
  const lastXrayId = profile?.lastXrayId ?? null;

  const rewards = useMemo(() => data?.rewards ?? [], [data]);
  const catalogue = useMemo(() => new Map(rewards.map((r) => [r.id, r])), [rewards]);
  const pendingPro = useMemo(() => [...redemptions].reverse().find((r) => r.status === 'issued' && isPro(r.rewardId)) ?? null, [redemptions]);

  const freezeMax = data?.freezeMax ?? 2;
  const blocked = (r: Reward): string | null => {
    if (isPro(r.id) && pendingPro) {
      const p = catalogue.get(pendingPro.rewardId);
      return t('shop.blocked.oneCode', { name: p ? rewardName(t, p) : pendingPro.rewardId });
    }
    if (r.kind === 'streak_freeze' && freezes >= freezeMax) return t('shop.blocked.freezes', { max: freezeMax });
    return null;
  };

  const priced = rewards.filter((r) => r.cost != null && r.kind !== 'coming_soon').sort(byCost);
  const first = priced[0] ?? null;
  // The nearest reward still to reach. The one whose code is already waiting and a freeze beyond the limit are not goals.
  const notGoal = (r: Reward) => r.id === pendingPro?.rewardId || (r.kind === 'streak_freeze' && freezes >= freezeMax);
  const next = priced.find((r) => (r.cost ?? 0) > balance && !notGoal(r)) ?? null;
  const affordable = priced.filter((r) => (r.cost ?? 0) <= balance && !blocked(r));
  const ready = affordable.filter((r) => r.kind !== 'streak_freeze').at(-1) ?? affordable.at(-1) ?? null;
  const earned = new Set((data?.points.events.length ? data.points.events : (profile?.points.events ?? [])).map((e) => e.type));

  const run = (rewardId: string, email: string | undefined, requestId: string): Promise<RedeemResult> => {
    if (live) return redeem(rewardId, email, requestId);
    // Development fixture: behave like the API without touching Stripe.
    const reward = catalogue.get(rewardId)!;
    return new Promise((resolve) =>
      window.setTimeout(() => {
        const code = reward.kind === 'pro_discount' || reward.kind === 'pro_months' ? `IRR-${Math.random().toString(36).slice(2, 6).toUpperCase()}-TEST` : undefined;
        const status: Redemption['status'] = reward.kind === 'partner_gift' ? 'requested' : reward.kind === 'streak_freeze' ? 'applied' : 'issued';
        resolve({ redemption: { id: `fx-${Date.now()}`, rewardId, cost: reward.cost ?? 0, status, code, email, at: new Date().toISOString() }, balance: (fx?.balance ?? 0) - (reward.cost ?? 0) });
      }, 700),
    );
  };

  const onRedeemed = (res: RedeemResult) => {
    const rewardId = res.redemption.rewardId;
    setAsking(null);
    setShown((s) => ({ ...s, [rewardId]: res.redemption }));
    if (fx) {
      setFx({
        balance: res.balance,
        redemptions: [...fx.redemptions, res.redemption],
        freezes: fx.freezes + (rewardId === 'streak_freeze' ? 1 : 0),
      });
    } else {
      void prof.refresh();
    }
    // The result lands where the reward lives on the shelf.
    window.setTimeout(() => {
      const el = document.getElementById(`reward-${rewardId}`);
      const rect = el?.getBoundingClientRect();
      if (el && rect && (rect.top < 64 || rect.bottom > window.innerHeight)) {
        const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'center' });
      }
    }, 60);
  };

  const offer = (r: Reward): Offer => {
    const just = shown[r.id] ?? null;
    const waiting = !just && pendingPro && pendingPro.rewardId === r.id && !turnedBack.has(pendingPro.id) ? pendingPro : null;
    return {
      reward: r,
      balance,
      blocked: blocked(r),
      onRedeem: () => setAsking(r),
      shown: just ?? waiting,
      onDone: () => {
        setShown((s) => {
          const n = { ...s };
          delete n[r.id];
          return n;
        });
        // A code waiting for checkout would turn the object over again; remember it was put away.
        const put = just ?? waiting;
        if (put) setTurnedBack((s) => new Set(s).add(put.id));
      },
    };
  };

  if (live && (status === 'loading' || (!data && !loadError))) return <ShopSkeleton />;
  if (!data) {
    return (
      <div className={st.page}>
        <div className={st.failed} role="alert">
          <h1 className={st.h2}>{t('shop.errors.loadTitle')}</h1>
          <p>{loadError === 'network' ? t('common.errors.network') : t('shop.errors.load')}</p>
          <Button onClick={load}>{t('common.actions.retry')}</Button>
        </div>
      </div>
    );
  }

  const discounts = rewards.filter((r) => r.kind === 'pro_discount').sort(byCost);
  const months = rewards.filter((r) => r.kind === 'pro_months').sort(byCost);
  const year = months.length > 1 ? months[months.length - 1] : null;
  const shortMonths = year ? months.slice(0, -1) : months;
  const gifts = rewards.filter((r) => r.kind === 'partner_gift');
  const freeze = rewards.find((r) => r.kind === 'streak_freeze') ?? null;
  const soon = rewards.filter((r) => r.kind === 'coming_soon');
  const soonShapes = ['coupon', 'gift', 'pass'] as const;

  return (
    <div className={st.page}>
      <Wallet
        balance={balance}
        ready={ready}
        next={next}
        first={first}
        rules={data.points.rules}
        earned={earned}
        fresh={redemptions.length === 0}
        mapHref={lastXrayId ? `/x/${lastXrayId}` : null}
        onRedeem={setAsking}
      />

      {discounts.length || months.length ? (
        <section className={st.shelf} aria-labelledby="shelf-pro">
          <div className={st.shelfHead}>
            <h2 id="shelf-pro" className={st.h2}>
              {t('shop.shelf.pro')}
            </h2>
            <p className={st.shelfNote}>{t('shop.shelf.proNote')}</p>
          </div>
          {discounts.length ? (
            <div className={st.coupons}>
              {discounts.map((r) => (
                <div key={r.id} id={`reward-${r.id}`} className={st.slot}>
                  <Coupon
                    offer={offer(r)}
                    first={r.id === first?.id && redemptions.length === 0}
                    note={t('shop.coupon.note', { amount: f.currency(discountOnYearly(r.percentOff ?? 0), { cents: true }) })}
                  />
                </div>
              ))}
            </div>
          ) : null}
          {months.length ? (
            <div className={st.months}>
              {shortMonths.map((r) => (
                <div key={r.id} id={`reward-${r.id}`} className={st.slot}>
                  <Pass offer={offer(r)} />
                </div>
              ))}
              {year ? (
                <div id={`reward-${year.id}`} className={`${st.slot} ${st.yearSlot}`}>
                  <Pass offer={offer(year)} feature />
                </div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {gifts.length || freeze ? (
        <div className={st.pair}>
          {gifts.length ? (
            <section className={st.shelf} aria-labelledby="shelf-ai">
              <div className={st.shelfHead}>
                <h2 id="shelf-ai" className={st.h2}>
                  {t('shop.shelf.ai')}
                </h2>
              </div>
              <div className={st.gifts}>
                {gifts.map((r) => (
                  <div key={r.id} id={`reward-${r.id}`} className={st.slot}>
                    <GiftCard offer={offer(r)} />
                  </div>
                ))}
              </div>
            </section>
          ) : null}
          {freeze ? (
            <section className={st.shelf} aria-labelledby="shelf-streak">
              <div className={st.shelfHead}>
                <h2 id="shelf-streak" className={st.h2}>
                  {t('shop.shelf.streak')}
                </h2>
              </div>
              <div id={`reward-${freeze.id}`} className={st.slot}>
                <Freeze offer={offer(freeze)} held={freezes} max={freezeMax} />
              </div>
            </section>
          ) : null}
        </div>
      ) : null}

      {soon.length ? (
        <section className={st.shelf} aria-labelledby="shelf-partners">
          <div className={st.shelfHead}>
            <h2 id="shelf-partners" className={st.h2}>
              {t('shop.shelf.partners')}
            </h2>
          </div>
          <div className={st.partners}>
            <div className={st.soonRow}>
              {soon.slice(0, 3).map((r, i) => (
                <SoonSlot key={r.id} shape={soonShapes[i % soonShapes.length]} />
              ))}
            </div>
            <p className={st.soonText}>
              <b>{t('shop.soon.title')}</b> {t('shop.soon.body')}
            </p>
          </div>
        </section>
      ) : null}

      <History items={redemptions} catalogue={catalogue} />

      {asking ? (
        <RedeemDialog
          reward={asking}
          balance={balance}
          subscribed={subscribed}
          lastEmail={[...redemptions].reverse().find((r) => r.email)?.email ?? null}
          onClose={() => setAsking(null)}
          run={run}
          onRedeemed={onRedeemed}
        />
      ) : null}
    </div>
  );
}

function ShopSkeleton() {
  return (
    <div className={st.page} aria-busy="true">
      <div className={st.wallet}>
        <div className={st.walletTop}>
          <Skeleton width={260} height={52} />
          <div className={st.goal}>
            <Skeleton width="60%" height={22} />
            <Skeleton width="100%" height={14} style={{ marginTop: 14 }} />
          </div>
        </div>
      </div>
      <div className={st.shelf}>
        <Skeleton width={280} height={36} />
        <div className={st.coupons}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={150} style={{ borderRadius: 20 }} />
          ))}
        </div>
        <div className={st.months}>
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} width="100%" height={330} style={{ borderRadius: 20 }} />
          ))}
          <div className={st.yearSlot}>
            <Skeleton width="100%" height={330} style={{ borderRadius: 20 }} />
          </div>
        </div>
      </div>
    </div>
  );
}
