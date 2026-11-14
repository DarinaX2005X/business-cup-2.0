import type { Subscriber } from './events';

/**
 * Subscribers of product events, run in this order by `emit`.
 * Empty for now; stage 04 adds points (and streak) subscribers here.
 */
export const subscribers: Subscriber[] = [];
