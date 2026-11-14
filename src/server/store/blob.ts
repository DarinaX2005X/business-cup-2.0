import { BlobPreconditionFailedError, del, get, list, put } from '@vercel/blob';
import { encodeKey, decodeKey } from './fs';
import { ConflictError, type SetOptions, type Store, type Versioned } from './types';

/**
 * Private Vercel Blob, the fallback when Redis is not provisioned. Reads bypass the CDN cache
 * (`useCache: false`) and every write is conditional on the ETag that was read, so the
 * compare-and-set has the same meaning as in Redis. Counters use a short CAS loop:
 * correct but slower, acceptable for a fallback.
 */

interface Envelope {
  version: number;
  value: unknown;
  expiresAt: number | null;
}

async function readRawAt(pathname: string, token: string): Promise<{ env: Envelope; etag: string } | null> {
  const res = await get(pathname, { access: 'private', useCache: false, token });
  if (!res || res.statusCode !== 200) return null;
  const text = await new Response(res.stream).text();
  return { env: JSON.parse(text) as Envelope, etag: res.blob.etag };
}

async function readAt(pathname: string, token: string) {
  const raw = await readRawAt(pathname, token);
  if (!raw) return null;
  const expired = raw.env.expiresAt !== null && raw.env.expiresAt <= Date.now();
  return { ...raw, live: !expired };
}

const expiry = (ttlSec?: number) => (ttlSec && ttlSec > 0 ? Date.now() + ttlSec * 1000 : null);

export function createBlobStore(token: string, prefix: string): Store {
  // Physical layout: kv/<encoded prefix + key>.json
  const ROOT = 'kv/';
  const pathOf = (key: string) => `${ROOT}${encodeKey(prefix + key)}.json`;
  const readRaw = (key: string, t: string) => readRawAt(pathOf(key), t);
  const read = (key: string, t: string) => readAt(pathOf(key), t);
  /** Writes `env` only if the blob still has `etag` (or does not exist when etag is null). Returns false on a lost race. */
  async function cas(key: string, env: Envelope, etag: string | null): Promise<boolean> {
    try {
      await put(pathOf(key), JSON.stringify(env), {
        access: 'private',
        token,
        contentType: 'application/json',
        addRandomSuffix: false,
        cacheControlMaxAge: 60,
        ...(etag ? { ifMatch: etag } : { allowOverwrite: false }),
      });
      return true;
    } catch (err) {
      if (err instanceof BlobPreconditionFailedError) return false;
      // create-only put on an existing pathname: treat as a lost race only if the blob now exists
      if (!etag && (await readRaw(key, token))) return false;
      throw err;
    }
  }

  async function update(key: string, fn: (cur: Envelope | null) => Envelope | null): Promise<Envelope | null> {
    for (let i = 0; i < 12; i++) {
      const cur = await read(key, token);
      const next = fn(cur?.live ? cur.env : null);
      if (!next) return null;
      if (await cas(key, next, cur?.etag ?? null)) return next;
      await new Promise((r) => setTimeout(r, 20 + Math.random() * 40 * (i + 1)));
    }
    throw new Error(`blob store: too much contention on ${key}`);
  }

  return {
    driver: 'blob',
    prefix,

    async get<T>(key: string): Promise<Versioned<T> | null> {
      const cur = await read(key, token);
      return cur?.live ? { value: cur.env.value as T, version: cur.env.version } : null;
    },

    async set<T>(key: string, value: T, opts: SetOptions = {}): Promise<number> {
      for (;;) {
        const cur = await read(key, token);
        const curVersion = cur?.live ? cur.env.version : 0;
        if (opts.version !== undefined && opts.version !== curVersion) {
          throw new ConflictError(key, opts.version, curVersion);
        }
        const env: Envelope = { version: curVersion + 1, value, expiresAt: expiry(opts.ttlSec) };
        if (await cas(key, env, cur?.etag ?? null)) return env.version;
        if (opts.version !== undefined) {
          const now = await read(key, token);
          throw new ConflictError(key, opts.version, now?.live ? now.env.version : 0);
        }
      }
    },

    async del(key: string): Promise<void> {
      await del(pathOf(key), { token });
    },

    async incrFloat(key: string, by: number, ttlSec?: number): Promise<number> {
      const env = await update(key, (cur) => ({
        version: (cur?.version ?? 0) + 1,
        value: (typeof cur?.value === 'number' ? cur.value : 0) + by,
        expiresAt: cur?.expiresAt ?? expiry(ttlSec),
      }));
      return env!.value as number;
    },

    async getNumber(key: string): Promise<number> {
      const cur = await read(key, token);
      return cur?.live && typeof cur.env.value === 'number' ? cur.env.value : 0;
    },

    async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
      const cur = await read(key, token);
      if (cur?.live) return false;
      return cas(key, { version: 1, value, expiresAt: expiry(ttlSec) }, cur?.etag ?? null);
    },

    async delIfEquals(key: string, value: string): Promise<boolean> {
      const cur = await read(key, token);
      if (!cur?.live || cur.env.value !== value) return false;
      try {
        await del(pathOf(key), { token, ifMatch: cur.etag });
        return true;
      } catch (err) {
        if (err instanceof BlobPreconditionFailedError) return false;
        throw err;
      }
    },

    async list(listPrefix: string): Promise<string[]> {
      const keys: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await list({ prefix: `${ROOT}${encodeKey(prefix + listPrefix)}`, cursor, limit: 1000, token });
        for (const b of page.blobs) {
          if (b.pathname.endsWith('.json')) keys.push(decodeKey(b.pathname.slice(ROOT.length, -5)).slice(prefix.length));
        }
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
      return keys;
    },
  };
}
