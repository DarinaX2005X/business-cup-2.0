import { createBlobStore } from './blob';
import { createFsStore } from './fs';
import { createRedisStore } from './redis';
import { StoreConfigError, type Store } from './types';

export * from './types';

/**
 * Environment namespace for shared backends, so local runs never touch production data:
 * `irr:prod:` on the Vercel production deployment, `irr:preview:` on preview deployments,
 * `irr:dev:` everywhere else. `STORE_PREFIX` overrides it (e.g. a one-off test namespace).
 */
export function storePrefix(env: NodeJS.ProcessEnv = process.env): string {
  if (env.STORE_PREFIX !== undefined) return env.STORE_PREFIX;
  const stage = env.VERCEL_ENV ?? (env.NODE_ENV === 'production' && env.VERCEL ? 'production' : 'development');
  if (stage === 'production') return 'irr:prod:';
  if (stage === 'preview') return 'irr:preview:';
  return 'irr:dev:';
}

/**
 * Picks one backend explicitly and never falls back silently (a split store would lose data):
 * - Redis when KV_REST_API_URL/TOKEN (Vercel Marketplace names) or UPSTASH_REDIS_REST_URL/TOKEN are set;
 * - otherwise private Vercel Blob when BLOB_READ_WRITE_TOKEN is set;
 * - otherwise local files in `.data/` — never on Vercel, where the file system does not survive.
 * `STORE_DRIVER=redis|blob|fs` forces a choice (tests use fs) and fails if its configuration is missing.
 */
export function resolveStore(env: NodeJS.ProcessEnv = process.env, opts: { prefix?: string } = {}): Store {
  const prefix = opts.prefix ?? storePrefix(env);
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL;
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN;
  const blobToken = env.BLOB_READ_WRITE_TOKEN;
  const forced = env.STORE_DRIVER as Store['driver'] | undefined;

  if (forced !== 'fs' && Boolean(url) !== Boolean(token)) {
    throw new StoreConfigError('Redis is half-configured: set both KV_REST_API_URL and KV_REST_API_TOKEN.');
  }
  const driver: Store['driver'] = forced ?? (url ? 'redis' : blobToken ? 'blob' : 'fs');

  switch (driver) {
    case 'redis':
      if (!url || !token) throw new StoreConfigError('STORE_DRIVER=redis but the Redis URL/token are missing.');
      return createRedisStore(url, token, prefix);
    case 'blob':
      if (!blobToken) throw new StoreConfigError('STORE_DRIVER=blob but BLOB_READ_WRITE_TOKEN is missing.');
      return createBlobStore(blobToken, prefix);
    case 'fs':
      if (env.VERCEL) {
        throw new StoreConfigError(
          'No durable storage configured: connect Upstash Redis (KV_REST_API_URL/TOKEN) or Vercel Blob (BLOB_READ_WRITE_TOKEN).',
        );
      }
      return createFsStore(env.DATA_DIR || undefined);
    default:
      throw new StoreConfigError(`Unknown STORE_DRIVER "${String(forced)}".`);
  }
}

/**
 * Namespace shared by every environment (local scripts, preview, production) on the same backend.
 * Only for things that are really global, such as the spend of the single OpenRouter key.
 */
export const GLOBAL_PREFIX = 'irr:global:';

let current: Store | null = null;
let global: Store | null = null;

/** Per-environment store (profiles, maps, reps, caches, rate limits). */
export function getStore(): Store {
  return (current ??= resolveStore());
}

/**
 * Cross-environment store (`irr:global:`), same backend as getStore(). With the local fs driver it is
 * simply the local store: there is nothing to share it with.
 */
export function getGlobalStore(): Store {
  return (global ??= resolveStore(process.env, { prefix: GLOBAL_PREFIX }));
}

/** Tests only: swap the stores (for example an fs store in a temp dir). The global one defaults to the same store. */
export function setStoreForTests(store: Store | null, globalStore: Store | null = store): void {
  current = store;
  global = globalStore;
}
