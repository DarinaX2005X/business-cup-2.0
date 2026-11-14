import type { Subscriber } from './events';
import { pointsSubscriber } from './points';

/**
 * Subscribers of product events, run in this order by `emit`.
 * Stage 04: points for every useful action (rules in src/domain/points.ts).
 */
export const subscribers: Subscriber[] = [pointsSubscriber];
