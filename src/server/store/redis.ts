import { Redis } from '@upstash/redis';
import { ConflictError, type SetOptions, type Store, type Versioned } from './types';

/**
 * Upstash Redis. Versioned records are hashes { v, d }; the compare-and-set runs in one Lua
 * script, so two writers based on the same version cannot both succeed.
 */

// KEYS[1]; ARGV: json, expectedVersion (-1 = unconditional), ttlSec (0 = persist)
// Returns the new version, or -(currentVersion + 1) on conflict.
const SET_SCRIPT = `
local cur = tonumber(redis.call('HGET', KEYS[1], 'v') or '0')
local expected = tonumber(ARGV[2])
if expected >= 0 and cur ~= expected then return -(cur + 1) end
local nextv = cur + 1
redis.call('HSET', KEYS[1], 'v', nextv, 'd', ARGV[1])
local ttl = tonumber(ARGV[3])
if ttl > 0 then redis.call('EXPIRE', KEYS[1], ttl) else redis.call('PERSIST', KEYS[1]) end
return nextv
`;

// KEYS[1]; ARGV: by, ttlSec
const INCR_SCRIPT = `
local r = redis.call('INCRBYFLOAT', KEYS[1], ARGV[1])
local ttl = tonumber(ARGV[2])
if ttl > 0 and redis.call('TTL', KEYS[1]) < 0 then redis.call('EXPIRE', KEYS[1], ttl) end
return r
`;

const GET_SCRIPT = `return redis.call('HMGET', KEYS[1], 'v', 'd')`;

const DEL_IF_EQUALS_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

const escapeGlob = (s: string) => s.replace(/[*?[\]\\]/g, (c) => `\\${c}`);

export function createRedisStore(url: string, token: string, prefix: string): Store {
  const redis = new Redis({ url, token, automaticDeserialization: false });
  const k = (key: string) => `${prefix}${key}`;

  return {
    driver: 'redis',
    prefix,

    async get<T>(key: string): Promise<Versioned<T> | null> {
      const res = await redis.eval<[], [string | null, string | null] | null>(GET_SCRIPT, [k(key)], []);
      const [v, d] = res ?? [null, null];
      if (v == null || d == null) return null;
      return { value: JSON.parse(d) as T, version: Number(v) };
    },

    async set<T>(key: string, value: T, opts: SetOptions = {}): Promise<number> {
      const expected = opts.version ?? -1;
      const res = Number(
        await redis.eval(SET_SCRIPT, [k(key)], [JSON.stringify(value), String(expected), String(opts.ttlSec ?? 0)]),
      );
      if (res < 0) throw new ConflictError(key, expected, -res - 1);
      return res;
    },

    async del(key: string): Promise<void> {
      await redis.del(k(key));
    },

    async incrFloat(key: string, by: number, ttlSec?: number): Promise<number> {
      return Number(await redis.eval(INCR_SCRIPT, [k(key)], [String(by), String(ttlSec ?? 0)]));
    },

    async getNumber(key: string): Promise<number> {
      const v = await redis.get<string>(k(key));
      return v === null ? 0 : Number(v);
    },

    async setNx(key: string, value: string, ttlSec: number): Promise<boolean> {
      const res = await redis.set(k(key), value, { nx: true, ex: Math.max(1, Math.round(ttlSec)) });
      return res === 'OK';
    },

    async delIfEquals(key: string, value: string): Promise<boolean> {
      return Number(await redis.eval(DEL_IF_EQUALS_SCRIPT, [k(key)], [value])) === 1;
    },

    async list(listPrefix: string): Promise<string[]> {
      const keys: string[] = [];
      let cursor: string | number = 0;
      do {
        const [next, batch]: [string | number, string[]] = await redis.scan(cursor, {
          match: `${escapeGlob(k(listPrefix))}*`,
          count: 500,
        });
        keys.push(...batch.map((key) => key.slice(prefix.length)));
        cursor = next;
      } while (String(cursor) !== '0');
      return [...new Set(keys)];
    },
  };
}
