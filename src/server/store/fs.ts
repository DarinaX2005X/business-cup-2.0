import { promises as fsp } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ConflictError, type SetOptions, type Store, type Versioned } from './types';

/**
 * Local development store in `.data/kv/`. Safe across processes on one machine
 * (next dev workers and tsx scripts): every mutation takes a per-key lock file created
 * with O_EXCL, and writes go through a temp file + rename, so readers never see half a file.
 */

interface Envelope {
  version: number;
  value: unknown;
  expiresAt: number | null;
}

const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 8_000;
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);

/** Reversible, case-safe file name (Windows file systems ignore case; base62 ids do not). */
export function encodeKey(key: string): string {
  return encodeURIComponent(key)
    .replace(/[A-Z_]/g, (c) => (c === '_' ? '__' : `_${c.toLowerCase()}`))
    .replace(/\*/g, '%2A');
}

export function decodeKey(name: string): string {
  return decodeURIComponent(name.replace(/_(_|[a-z])/g, (_m, c: string) => (c === '_' ? '_' : c.toUpperCase())));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (!code || !RETRY_CODES.has(code) || i >= 20) throw err;
      await sleep(5 + i * 5);
    }
  }
}

export function createFsStore(rootDir = path.join(process.cwd(), '.data')): Store {
  const dir = path.join(rootDir, 'kv');
  let ready: Promise<unknown> | null = null;
  const ensureDir = () => (ready ??= fsp.mkdir(dir, { recursive: true }));
  const fileOf = (key: string) => path.join(dir, `${encodeKey(key)}.json`);

  async function read(key: string): Promise<Envelope | null> {
    let raw: string;
    try {
      raw = await withRetry(() => fsp.readFile(fileOf(key), 'utf8'));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
    const env = JSON.parse(raw) as Envelope;
    if (env.expiresAt !== null && env.expiresAt <= Date.now()) return null;
    return env;
  }

  async function write(key: string, env: Envelope): Promise<void> {
    await ensureDir();
    const file = fileOf(key);
    const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(env), 'utf8');
    await withRetry(() => fsp.rename(tmp, file));
  }

  async function remove(key: string): Promise<void> {
    await withRetry(() => fsp.rm(fileOf(key), { force: true }));
  }

  async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    await ensureDir();
    const lockFile = `${fileOf(key)}.lock`;
    const started = Date.now();
    for (let i = 0; ; i++) {
      try {
        const handle = await fsp.open(lockFile, 'wx');
        await handle.close();
        break;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code !== 'EEXIST' && !RETRY_CODES.has(code ?? '')) throw err;
        try {
          const st = await fsp.stat(lockFile);
          if (Date.now() - st.mtimeMs > LOCK_STALE_MS) await fsp.rm(lockFile, { force: true });
        } catch {
          // lock disappeared between attempts; try again
        }
        if (Date.now() - started > LOCK_WAIT_MS) throw new Error(`fs store: timed out waiting for lock on ${key}`);
        await sleep(Math.min(2 + i * 2, 25) + Math.random() * 5);
      }
    }
    try {
      return await fn();
    } finally {
      await withRetry(() => fsp.rm(lockFile, { force: true }));
    }
  }

  const expiry = (ttlSec?: number) => (ttlSec && ttlSec > 0 ? Date.now() + ttlSec * 1000 : null);

  return {
    driver: 'fs',
    prefix: '',

    async get<T>(key: string): Promise<Versioned<T> | null> {
      const env = await read(key);
      return env ? { value: env.value as T, version: env.version } : null;
    },

    async set<T>(key: string, value: T, opts: SetOptions = {}): Promise<number> {
      return withLock(key, async () => {
        const cur = await read(key);
        const curVersion = cur?.version ?? 0;
        if (opts.version !== undefined && opts.version !== curVersion) {
          throw new ConflictError(key, opts.version, curVersion);
        }
        const version = curVersion + 1;
        await write(key, { version, value, expiresAt: expiry(opts.ttlSec) });
        return version;
      });
    },

    async del(key: string): Promise<void> {
      await withLock(key, () => remove(key));
    },

    async incrFloat(key: string, by: number, ttlSec?: number): Promise<number> {
      return withLock(key, async () => {
        const cur = await read(key);
        const next = (typeof cur?.value === 'number' ? cur.value : 0) + by;
        const expiresAt = cur?.expiresAt ?? expiry(ttlSec);
        await write(key, { version: (cur?.version ?? 0) + 1, value: next, expiresAt });
        return next;
      });
    },

    async getNumber(key: string): Promise<number> {
      const env = await read(key);
      return typeof env?.value === 'number' ? env.value : 0;
    },

    async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
      return withLock(key, async () => {
        if (await read(key)) return false;
        await write(key, { version: 1, value, expiresAt: expiry(ttlSec) });
        return true;
      });
    },

    async delIfEquals(key: string, value: string): Promise<boolean> {
      return withLock(key, async () => {
        const cur = await read(key);
        if (!cur || cur.value !== value) return false;
        await remove(key);
        return true;
      });
    },

    async list(prefix: string): Promise<string[]> {
      let names: string[];
      try {
        names = await fsp.readdir(dir);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
        throw err;
      }
      const keys: string[] = [];
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        const key = decodeKey(name.slice(0, -5));
        if (!key.startsWith(prefix)) continue;
        if (await read(key)) keys.push(key);
      }
      return keys;
    },
  };
}
