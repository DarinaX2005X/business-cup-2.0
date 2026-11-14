import type { TFunction } from '@/i18n/core';
import { PRO_YEARLY_USD } from '@/components/pricing/billing';
import type { Reward } from './types';

/** A reward from its id when the catalogue is not at hand (history rows): pro_10, pro_3m, claude_pro_1m. */
export function rewardFromId(id: string): Reward {
  const pct = /^pro_(\d+)$/.exec(id);
  if (pct) return { id, kind: 'pro_discount', cost: null, percentOff: Number(pct[1]), titleKey: '' };
  const m = /^pro_(\d+)m$/.exec(id);
  if (m) return { id, kind: 'pro_months', cost: null, months: Number(m[1]), titleKey: '' };
  if (id.startsWith('claude')) return { id, kind: 'partner_gift', cost: null, partner: 'claude', months: 1, titleKey: '' };
  if (id.startsWith('chatgpt')) return { id, kind: 'partner_gift', cost: null, partner: 'chatgpt', months: 1, titleKey: '' };
  if (id === 'streak_freeze') return { id, kind: 'streak_freeze', cost: null, titleKey: '' };
  return { id, kind: 'coming_soon', cost: null, titleKey: '' };
}

export const partnerName = (r: Reward) => (r.partner === 'chatgpt' ? 'ChatGPT Plus' : 'Claude Pro');

/** Short name for lists: «10% off Pro», «3 months of Pro», «Claude Pro, 1 month», «Streak freeze». */
export function rewardName(t: TFunction, r: Reward): string {
  switch (r.kind) {
    case 'pro_discount':
      return t('shop.names.discount', { percent: r.percentOff ?? 0 });
    case 'pro_months':
      return t('shop.names.months', { count: r.months ?? 1 });
    case 'partner_gift':
      return t('shop.names.gift', { name: partnerName(r) });
    case 'streak_freeze':
      return t('shop.names.freeze');
    default:
      return t('shop.names.soon');
  }
}

/** The end of «Redeem 250 points for …?». A discount names the payment it lowers. */
export function redeemWhat(t: TFunction, r: Reward, subscribed: boolean): string {
  switch (r.kind) {
    case 'pro_discount':
      return subscribed ? t('shop.redeem.what.discountNext', { percent: r.percentOff ?? 0 }) : t('shop.redeem.what.discountFirst', { percent: r.percentOff ?? 0 });
    case 'pro_months':
      return t('shop.redeem.what.months', { count: r.months ?? 1 });
    case 'partner_gift':
      return t('shop.redeem.what.gift', { name: partnerName(r) });
    case 'streak_freeze':
      return t('shop.redeem.what.freeze');
    default:
      return '';
  }
}

/** What a discount is worth on the yearly plan, in dollars and cents: 10% of $119 is $11.90. */
export const discountOnYearly = (percent: number) => (PRO_YEARLY_USD * percent) / 100;
