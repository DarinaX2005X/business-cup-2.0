/**
 * Destinations the landing links to. A link that is `null` is not rendered at all, so the page
 * never shows a dead link: MAIN sets it when the destination ships.
 */
export const LANDING_LINKS = {
  /** The pricing page (stage 04.2). */
  pricing: '/#pricing' as string | null,
  /** The Business Cup 2.0 offer: Pro free until CUP_OFFER_UNTIL. */
  cup: '/cup' as string | null,
  /** Public repository; opened after the submission. */
  github: null as string | null,
};
