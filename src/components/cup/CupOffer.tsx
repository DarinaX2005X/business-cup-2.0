'use client';

import Link from 'next/link';
import { useState, type CSSProperties } from 'react';
import { Button } from '@/components/kit/Button';
import { KeystoneMark } from '@/components/kit/Mark';
import { Dialog } from '@/components/kit/Overlay';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { useCupUnlock } from './useCupUnlock';
import st from './cup.module.css';

/** The stamp's keystone is drawn in the stamp ink. */
const STAMP_INK = { '--m-edge': 'currentColor', '--m-line': 'currentColor', '--m-key': 'currentColor', '--m-key-hi': 'currentColor' } as CSSProperties;

/**
 * The Business Cup 2.0 pass: a paper ticket from the same shelf as the shop vouchers (violet top,
 * perforation, a stub whose «barcode» is a strip of Week Bar tiles). When Pro turns on, an apricot
 * stamp lands across the perforation with the date it runs until.
 */
export function CupPass({ on, runsUntil, layout = 'tall', className }: { on: boolean; runsUntil: string | null; layout?: 'tall' | 'wide'; className?: string }) {
  const { t } = useT();
  // Already on when first drawn (a return visit): show the stamp in place, the landing is for the unlock itself.
  const [onAtFirstPaint] = useState(on);
  return (
    <div className={`${st.pass} ${className ?? ''}`} data-layout={layout} data-on={on || undefined} data-instant={(on && onAtFirstPaint) || undefined} aria-hidden="true">
      <div className={`${st.passTop} field`}>
        <span className={st.passBrand}>
          <KeystoneMark size={layout === 'tall' ? 26 : 20} tone="violet" />
          {t('cup.pass.brand')}
        </span>
        <span className={st.passBig}>
          {t('cup.pass.days')}
          <small>{t('cup.pass.ofPro')}</small>
        </span>
      </div>
      <div className={st.passPerf} />
      <div className={st.passStub}>
        <b>{t('cup.pass.event')}</b>
        <span className={st.passCode}>
          {[5, 2, 7, 3, 4, 2, 6, 3, 5, 2, 4].map((w, i) => (
            <i key={i} data-k={i === 6 ? 'hu' : i % 3 === 1 ? 'sp' : 'ai'} style={{ flexGrow: w }} />
          ))}
        </span>
      </div>
      {on ? (
        <span className={st.stamp}>
          <KeystoneMark size={layout === 'tall' ? 30 : 22} tone="ink" style={STAMP_INK} />
          <b>{t('cup.pass.stamp')}</b>
          {runsUntil ? <small>{t('cup.pass.stampUntil', { date: runsUntil })}</small> : null}
        </span>
      ) : null}
    </div>
  );
}

/** Where to go once Pro is on: today's rep, or the week map first when there is none. */
export function CupNext({ hasMap, variant = 'primary', size = 'md' }: { hasMap: boolean; variant?: 'primary' | 'apricot'; size?: 'md' | 'lg' }) {
  const { t } = useT();
  return (
    <Link href={hasMap ? '/today' : '/start'} className={`${btn.btn} ${btn[`b_${variant}`]} ${size === 'lg' ? btn.s_lg : ''}`}>
      {hasMap ? t('cup.startRep') : t('cup.mapFirst')}
    </Link>
  );
}

export interface CupOfferProps {
  /**
   * `dialog` (default): a quiet second action for any «Pro from here» place, beside «Start your 7-day free
   * trial»; it opens the offer in a dialog and never leaves the page.
   * `inline`: the same offer laid out in place as a ticket band.
   */
  variant?: 'dialog' | 'inline';
  /** Surface the trigger sits on: `violet` for the violet field, `paper` elsewhere. */
  surface?: 'paper' | 'violet';
  /** Called after Pro turns on (the profile and server parts of the page are already refreshed). */
  onUnlocked?: () => void;
  className?: string;
}

/**
 * The Business Cup 2.0 offer for paywalls: `<CupOffer />` next to the trial button. It renders nothing
 * once the offer has ended or when this browser already has Pro.
 */
export function CupOffer({ variant = 'dialog', surface = 'paper', onUnlocked, className }: CupOfferProps) {
  const { t } = useT();
  const cup = useCupUnlock({ onUnlocked });
  const [open, setOpen] = useState(false);
  const on = cup.phase === 'done' || (cup.plan.kind === 'cup' && cup.plan.active);

  const body = (
    <div className={st.offerBody}>
      <CupPass layout="wide" on={on} runsUntil={cup.runsUntilShort} />
      {on ? (
        <p className={st.offerOn} role="status">
          {t('cup.on', { date: cup.runsUntil ?? '' })}
        </p>
      ) : (
        <>
          <p className={st.offerLead}>{t('cup.lead')}</p>
          <p className={st.offerUntil}>
            {t('cup.until', { date: cup.until })}. {t('cup.scope')}
          </p>
        </>
      )}
      {cup.errorText ? (
        <p className={st.offerError} role="alert">
          {cup.errorText}
        </p>
      ) : null}
    </div>
  );

  const actions = on ? (
    <CupNext hasMap={cup.hasMap} />
  ) : cup.code === 'already_pro' ? (
    <CupNext hasMap={cup.hasMap} />
  ) : cup.code === 'offer_ended' ? null : (
    <Button data-autofocus loading={cup.phase === 'busy'} loadingLabel={t('cup.unlocking')} onClick={cup.unlock}>
      {t('cup.unlock')}
    </Button>
  );

  if (variant === 'inline') {
    if (!cup.offerOpen && !on) return null;
    if (cup.plan.active && cup.plan.kind !== 'cup' && cup.phase !== 'done') return null;
    return (
      <section className={`${st.inline} ${className ?? ''}`} aria-labelledby="cup-inline-title">
        <h2 id="cup-inline-title" className={st.inlineTitle}>
          {t('cup.title')}
        </h2>
        {body}
        <div className={st.inlineActions}>{actions}</div>
      </section>
    );
  }

  // The trigger: hidden when there is nothing to offer, but the dialog stays while it shows its result.
  const nothingToOffer = !cup.offerOpen || (cup.plan.active && cup.phase !== 'done');
  if (nothingToOffer && !open) return null;

  return (
    <>
      <Button
        variant={surface === 'violet' ? 'ghost' : 'secondary'}
        className={className}
        onClick={() => {
          cup.reset();
          setOpen(true);
        }}
      >
        {t('cup.action')}
      </Button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t('cup.title')}
        footer={
          <>
            <Button variant="quiet" onClick={() => setOpen(false)}>
              {on ? t('cup.stay') : t('common.actions.cancel')}
            </Button>
            {actions}
          </>
        }
      >
        {body}
      </Dialog>
    </>
  );
}
