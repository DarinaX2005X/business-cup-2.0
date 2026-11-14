'use client';

import { Check, Copy, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { Button } from '@/components/kit/Button';
import { KeystoneMark } from '@/components/kit/Mark';
import { sound } from '@/components/kit/sound';
import { useT } from '@/i18n/client';
import { rewardName } from './names';
import type { Redemption, Reward } from './types';
import st from './shop.module.css';

/*
 * The shop's objects. They share one material (a paper card, a violet top cut from the field, a dashed
 * tear line with notches, one light from the top left) but each kind has its own silhouette and scale:
 * a discount is a slim horizontal coupon, a month of Pro is a pass, a year is the largest pass, an AI tool
 * is a gift card on a neutral plate, a streak freeze is a tile that covers a missed day.
 * Redeeming tears the object along its line and turns it over to show the code or what happens next.
 */

export type Phase = 'idle' | 'tear' | 'flipped';

/** Turns over when `shown` arrives; a code already waiting on first render is shown turned over at once. */
function useTurn(shown: boolean): Phase {
  const [phase, setPhase] = useState<Phase>(shown ? 'flipped' : 'idle');
  const [prev, setPrev] = useState(shown);
  if (prev !== shown) {
    setPrev(shown);
    setPhase(shown ? 'tear' : 'idle');
  }
  useEffect(() => {
    if (phase !== 'tear') return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    sound.play('redeem');
    const t = window.setTimeout(() => setPhase('flipped'), reduce ? 0 : 460);
    return () => window.clearTimeout(t);
  }, [phase]);
  return phase;
}

/** What a reward can do for this person right now. */
export interface Offer {
  reward: Reward;
  balance: number;
  /** Why redeeming is not possible even with enough points (one Pro code at a time, freezes full). */
  blocked: string | null;
  onRedeem: () => void;
  /** The redemption shown on the back, if the object is turned over. */
  shown: Redemption | null;
  onDone: () => void;
}

function Action({ reward, balance, blocked, onRedeem, label }: Pick<Offer, 'reward' | 'balance' | 'blocked' | 'onRedeem'> & { label?: string }) {
  const { t, f } = useT();
  const cost = reward.cost ?? 0;
  if (balance < cost) {
    const need = cost - balance;
    return (
      <div className={st.need}>
        <span className={st.needBar} aria-hidden="true">
          <i style={{ width: `${Math.max(2, Math.min(100, (balance / cost) * 100))}%` }} />
        </span>
        <span>{t('shop.need', { points: f.number(need) })}</span>
      </div>
    );
  }
  return (
    <Button size="sm" disabledReason={blocked ?? undefined} onClick={onRedeem} className={st.redeemBtn}>
      {label ?? t('shop.redeem.button')}
    </Button>
  );
}

function Cost({ cost }: { cost: number }) {
  const { t, f } = useT();
  return (
    <p className={st.cost}>
      <i className={st.coin} aria-hidden="true" />
      <b>{f.number(cost)}</b> {t('shop.points')}
    </p>
  );
}

/** The back of every object: the code with Copy, or what happens next, and a way to turn it back. */
function Back({ reward, shown, onDone }: { reward: Reward; shown: Redemption | null; onDone: () => void }) {
  const { t } = useT();
  const [copied, setCopied] = useState(false);
  if (!shown) return <div className={st.back} aria-hidden="true" />;
  const pro = reward.kind === 'pro_discount' || reward.kind === 'pro_months';
  let note: ReactNode;
  if (reward.kind === 'streak_freeze') note = t('shop.back.freeze');
  else if (shown.status === 'requested') note = t('shop.back.requested');
  else if (shown.status === 'applied') note = shown.appliedTo === 'checkout' ? t('shop.back.appliedCheckout') : t('shop.back.applied');
  else if (shown.status === 'sent') note = t('shop.back.sent', { email: shown.email ?? '' });
  else if (pro)
    note = (
      <>
        {t('shop.back.issued')}{' '}
        <Link href="/pricing" className={st.backLink}>
          {t('shop.back.toCheckout')}
        </Link>
      </>
    );
  return (
    <div className={st.back} role="status">
      <span className={st.backHead}>
        <Check strokeWidth={2.25} aria-hidden="true" />
        {t('shop.back.done')}
      </span>
      <b className={st.backName}>{rewardName(t, reward)}</b>
      {shown.code ? (
        <>
          <span className={st.codeK}>{t('shop.back.yourCode')}</span>
          <span className={st.codeRow}>
            <code className={st.code}>{shown.code}</code>
            <button
              type="button"
              className={st.copy}
              onClick={() => {
                void navigator.clipboard?.writeText(shown.code!).catch(() => undefined);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1600);
              }}
            >
              {copied ? <Check strokeWidth={2} aria-hidden="true" /> : <Copy strokeWidth={1.75} aria-hidden="true" />}
              {copied ? t('shop.copied') : t('shop.copy')}
            </button>
          </span>
        </>
      ) : null}
      <p className={st.backNote}>{note}</p>
      <button type="button" className={st.turnBack} onClick={onDone}>
        {t('shop.back.turn')}
      </button>
    </div>
  );
}

/** The flip shell around a front: tear, then turn over. Only the visible face is reachable. */
function Turn({ shape, phase, front, back, style, featured }: { shape: string; phase: Phase; front: ReactNode; back: ReactNode; style?: CSSProperties; featured?: boolean }) {
  return (
    <div className={st.obj} data-shape={shape} data-phase={phase} data-featured={featured || undefined} style={style}>
      <div className={st.turn}>
        <div className={st.front} inert={phase === 'flipped' || undefined}>
          {front}
        </div>
        <div className={st.backFace} inert={phase !== 'flipped' || undefined}>
          {back}
        </div>
      </div>
    </div>
  );
}

/** A discount on the Pro plan: a slim coupon, value on the left, the stub on the right. */
export function Coupon({ offer, first, note }: { offer: Offer; first: boolean; note: string }) {
  const { t } = useT();
  const phase = useTurn(!!offer.shown);
  const r = offer.reward;
  return (
    <Turn
      shape="coupon"
      phase={phase}
      featured={first}
      front={
        <>
          <div className={`${st.top} ${st.couponTop}`}>
            <span className={st.couponBig}>
              {t('shop.coupon.percent', { percent: r.percentOff ?? 0 })}
              <small>{t('shop.coupon.off')}</small>
            </span>
            {first ? <span className={st.firstTag}>{t('shop.coupon.first')}</span> : null}
          </div>
          <div className={st.perf} aria-hidden="true" />
          <div className={st.stub}>
            <Cost cost={r.cost ?? 0} />
            <p className={st.what}>{note}</p>
            <Action {...offer} />
          </div>
        </>
      }
      back={<Back reward={r} shown={offer.shown} onDone={offer.onDone} />}
    />
  );
}

/** Months of Pro: a pass. Twelve months is the largest object on the shelf. */
export function Pass({ offer, feature }: { offer: Offer; feature?: boolean }) {
  const { t } = useT();
  const phase = useTurn(!!offer.shown);
  const r = offer.reward;
  const months = r.months ?? 1;
  return (
    <Turn
      shape={feature ? 'year' : 'pass'}
      phase={phase}
      front={
        <>
          <div className={`${st.top} ${st.passTop}`}>
            <span className={st.brand}>
              <KeystoneMark size={22} tone="violet" />
              {t('shop.pass.brand')}
            </span>
            <span className={st.passBig}>
              {t('shop.pass.months', { count: months })}
              <small>{feature ? t('shop.pass.year') : t('shop.pass.ofPro')}</small>
            </span>
            {feature ? <KeystoneMark size={104} tone="violet" className={st.emblem} /> : null}
          </div>
          <div className={st.perf} aria-hidden="true" />
          <div className={st.stub}>
            <Cost cost={r.cost ?? 0} />
            <p className={st.what}>{t('shop.pass.what', { count: months })}</p>
            <Action {...offer} />
          </div>
        </>
      }
      back={<Back reward={r} shown={offer.shown} onDone={offer.onDone} />}
    />
  );
}

/** A month of an AI tool: the product's name in plain text on a neutral plate, no logos. */
export function GiftCard({ offer }: { offer: Offer }) {
  const { t } = useT();
  const phase = useTurn(!!offer.shown);
  const r = offer.reward;
  const name = r.partner === 'chatgpt' ? 'ChatGPT Plus' : 'Claude Pro';
  return (
    <Turn
      shape="gift"
      phase={phase}
      front={
        <>
          <div className={st.plate}>
            <span className={st.pilot}>{t('shop.gift.pilot')}</span>
            <span className={st.plateName}>
              {name}
              <small>{t('shop.gift.month')}</small>
            </span>
          </div>
          <div className={st.stub}>
            <Cost cost={r.cost ?? 0} />
            <p className={st.what}>{t('shop.gift.what')}</p>
            <Action {...offer} />
          </div>
        </>
      }
      back={<Back reward={r} shown={offer.shown} onDone={offer.onDone} />}
    />
  );
}

/** A streak freeze: three days of a streak, the missed one in the middle covered. */
export function Freeze({ offer, held, max }: { offer: Offer; held: number; max: number }) {
  const { t } = useT();
  const phase = useTurn(!!offer.shown);
  const r = offer.reward;
  return (
    <Turn
      shape="freeze"
      phase={phase}
      front={
        <>
          <div className={st.freezeArt} aria-hidden="true">
            <i data-k="done" />
            <i data-k="cover">
              <ShieldCheck strokeWidth={1.75} />
            </i>
            <i data-k="done" />
          </div>
          <div className={st.freezeText}>
            <h3 className={st.objTitle}>{t('shop.freeze.name')}</h3>
            <p className={st.what}>{t('shop.freeze.what')}</p>
            <p className={st.held}>
              {t('shop.freeze.held', { count: held, max })}
              <span className={st.heldDots} aria-hidden="true">
                {Array.from({ length: max }, (_, i) => (
                  <i key={i} data-on={i < held || undefined} />
                ))}
              </span>
            </p>
            <Cost cost={r.cost ?? 0} />
            <Action {...offer} />
          </div>
        </>
      }
      back={<Back reward={r} shown={offer.shown} onDone={offer.onDone} />}
    />
  );
}

/** Room on the shelf for partner rewards: dashed outlines of the objects still to come. */
export function SoonSlot({ shape }: { shape: 'coupon' | 'gift' | 'pass' }) {
  return (
    <div className={st.soon} data-shape={shape} aria-hidden="true">
      <i />
    </div>
  );
}
