import { createHash, randomBytes } from 'node:crypto';
import type { z } from 'zod';
import { getStore } from '@/server/store';

/**
 * Result cache for deterministic model operations (translations, tips, resume parsing by text hash,
 * search-query translation). Exercise generation must not be cached: callers simply omit `cacheKey`.
 * Keys: `cache:<op>:<sha256>`.
 */

export const DEFAULT_CACHE_TTL_SEC = 60 * 24 * 3600;

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function cacheStoreKey(op: string, material: unknown): string {
  return `cache:${op}:${sha256(typeof material === 'string' ? material : JSON.stringify(material))}`;
}

/** Returns the cached value only if it still matches the schema (a changed schema makes old entries misses). */
export async function cacheGet<S extends z.ZodType>(key: string, schema: S): Promise<z.infer<S> | null> {
  const hit = await getStore().get<unknown>(key);
  if (!hit) return null;
  const parsed = schema.safeParse(hit.value);
  return parsed.success ? parsed.data : null;
}

export async function cacheSet(key: string, value: unknown, ttlSec = DEFAULT_CACHE_TTL_SEC): Promise<void> {
  await getStore().set(key, value, { ttlSec });
}

export interface Lock {
  readonly key: string;
  release(): Promise<void>;
}

/**
 * Exclusive lock via SET NX EX. Returns null when someone else holds it.
 * The lock expires by itself after `ttlSec`, so a crashed holder cannot block forever;
 * `release()` removes it only if it is still ours.
 */
export async function lock(name: string, ttlSec: number): Promise<Lock | null> {
  const key = `lock:${name}`;
  const token = randomBytes(12).toString('base64url');
  const store = getStore();
  if (!(await store.setNx(key, token, ttlSec))) return null;
  return {
    key,
    async release() {
      await store.delIfEquals(key, token);
    },
  };
}
