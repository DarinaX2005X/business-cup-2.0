import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * The time a request may still spend on model calls. Every API route that calls a model declares
 * `maxDuration = 300` (Vercel Fluid compute allows up to 300 s); `withApi` runs each request with a
 * deadline a little before that, and the model client never starts an attempt or a failover it could not
 * finish in time. Work handed to `after()` keeps the request's deadline, since it shares the invocation.
 */
export const ROUTE_MAX_DURATION_SEC = 300;
/** Kept free at the end of a request: saving the result and answering. */
const MARGIN_MS = 10_000;

const deadlines = new AsyncLocalStorage<{ endsAt: number }>();

export function withRequestDeadline<T>(fn: () => Promise<T>, maxDurationSec: number = ROUTE_MAX_DURATION_SEC): Promise<T> {
  return deadlines.run({ endsAt: Date.now() + maxDurationSec * 1000 - MARGIN_MS }, fn);
}

/** Epoch ms by which model work in this request must be done, or null outside a request. */
export function requestDeadline(): number | null {
  return deadlines.getStore()?.endsAt ?? null;
}
