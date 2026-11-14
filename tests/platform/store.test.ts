import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decodeKey, encodeKey } from '@/server/store/fs';
import { ConflictError, resolveStore, StoreConfigError, storePrefix, type Store } from '@/server/store';
import { lock } from '@/server/ai/cache';
import { useTempStore } from './helpers';

let store: Store;
let cleanup: () => void;
beforeEach(() => ({ store, cleanup } = useTempStore()));
afterEach(() => cleanup());

describe('fs store', () => {
  it('keeps keys that differ only by case apart (case-insensitive file systems)', async () => {
    expect(decodeKey(encodeKey('profile:aB_c:*x'))).toBe('profile:aB_c:*x');
    await store.set('profile:Ab', 1);
    await store.set('profile:aB', 2);
    expect((await store.get('profile:Ab'))?.value).toBe(1);
    expect((await store.get('profile:aB'))?.value).toBe(2);
  });

  it('writes only with the current version and reports the conflict', async () => {
    expect(await store.set('k', { n: 1 }, { version: 0 })).toBe(1);
    await expect(store.set('k', { n: 9 }, { version: 0 })).rejects.toBeInstanceOf(ConflictError);
    expect(await store.set('k', { n: 2 }, { version: 1 })).toBe(2);
    await expect(store.set('k', { n: 3 }, { version: 1 })).rejects.toMatchObject({ expected: 1, actual: 2 });
    expect(await store.get('k')).toEqual({ value: { n: 2 }, version: 2 });
  });

  it('lets exactly one of several parallel writers on the same version win', async () => {
    await store.set('k', 0, { version: 0 });
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, i) => store.set('k', i, { version: 1 })));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('increments atomically under parallel calls', async () => {
    await Promise.all(Array.from({ length: 20 }, () => store.incrFloat('c', 0.5, 60)));
    expect(await store.getNumber('c')).toBe(10);
    expect(await store.getNumber('missing')).toBe(0);
  });

  it('expires keys after their TTL', async () => {
    await store.set('t', 'x', { ttlSec: 0.05 });
    expect(await store.get('t')).not.toBeNull();
    await new Promise((r) => setTimeout(r, 80));
    expect(await store.get('t')).toBeNull();
    expect(await store.setNx('t', 'again', 10)).toBe(true);
  });

  it('lists by prefix and deletes', async () => {
    await store.set('rl:profile:A:1', 1);
    await store.set('rl:profile:A:2', 1);
    await store.set('rl:profile:B:1', 1);
    expect((await store.list('rl:profile:A:')).sort()).toEqual(['rl:profile:A:1', 'rl:profile:A:2']);
    await store.del('rl:profile:A:1');
    expect(await store.list('rl:profile:A:')).toEqual(['rl:profile:A:2']);
  });
});

describe('lock', () => {
  it('two parallel locks on one name do not both succeed; release frees it', async () => {
    const [a, b] = await Promise.all([lock('tips:x', 30), lock('tips:x', 30)]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(await lock('tips:x', 30)).toBeNull();
    await (a ?? b)!.release();
    const again = await lock('tips:x', 30);
    expect(again).not.toBeNull();
  });
});

describe('store selection', () => {
  it('uses Redis when Vercel KV variables exist, fs when forced, and refuses fs on Vercel', () => {
    expect(resolveStore({ KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 't', NODE_ENV: 'test' }).driver).toBe('redis');
    expect(resolveStore({ KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 't', STORE_DRIVER: 'fs', NODE_ENV: 'test' }).driver).toBe('fs');
    expect(() => resolveStore({ KV_REST_API_URL: 'https://x.upstash.io', NODE_ENV: 'test' })).toThrow(StoreConfigError);
    expect(() => resolveStore({ VERCEL: '1', NODE_ENV: 'production' })).toThrow(StoreConfigError);
  });

  it('namespaces environments so local runs never touch production keys', () => {
    expect(storePrefix({ NODE_ENV: 'development' })).toBe('irr:dev:');
    expect(storePrefix({ NODE_ENV: 'production' })).toBe('irr:dev:'); // local `next start`
    expect(storePrefix({ NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'preview' })).toBe('irr:preview:');
    expect(storePrefix({ NODE_ENV: 'production', VERCEL: '1', VERCEL_ENV: 'production' })).toBe('irr:prod:');
  });
});
