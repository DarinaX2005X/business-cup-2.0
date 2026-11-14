import { after } from 'next/server';
import { Redis } from '@upstash/redis';
import { boardHandle } from '@/domain/points';
import type { Profile } from '@/domain/types';
import { getProfile } from '@/server/profile';
import { getStore, isConflictError } from '@/server/store';
import { isoWeek } from '@/server/xray/records';

/**
 * Weekly leaderboard by XP (round 3). One board per ISO week (UTC): a Redis sorted set
 * `lb:xp:<week>` (score = XP earned that week, member = profile id) plus a hash `lb:names:<week>`
 * with each entry's handle. Only real profiles that earned XP that week are on it; nothing is seeded.
 *
 * The score is the absolute weekly XP read from the saved profile and written with ZADD GT, so a
 * repeated or late sync can never lower it or count anything twice. Syncs run after an award is saved
 * (`scheduleBoardSync`, called from the points subscriber) and when a person reads their points or the board.
 * Without Redis (local files, tests) the same contract is kept in one versioned store record.
 */

export const BOARD_SIZE = 50;
const KEEP_SEC = 35 * 86_400;

export interface BoardRow {
  rank: number;
  handle: string;
  xp: number;
  you: boolean;
}

export interface Board {
  week: string;
  top: BoardRow[];
  /** The viewer's place, also when outside the top 50; null when they earned no XP this week. */
  you: { rank: number; xp: number; handle: string } | null;
  /** How many people are on this week's board. */
  players: number;
}

interface Backend {
  setMax(week: string, id: string, xp: number, handle: string): Promise<void>;
  remove(week: string, id: string): Promise<void>;
  top(week: string, n: number): Promise<{ id: string; xp: number; handle: string }[]>;
  place(week: string, id: string): Promise<{ rank: number; xp: number; handle: string } | null>;
  size(week: string): Promise<number>;
}

export const boardWeek = (now: Date = new Date()) => isoWeek(now, null);

/** XP a profile earned in the given ISO week (UTC): positive journal entries only, spending never counts. */
export function weekXpOf(profile: Pick<Profile, 'points'>, week: string): number {
  return profile.points.events.filter((e) => e.points > 0 && isoWeek(new Date(e.at), null) === week).reduce((n, e) => n + e.points, 0);
}

// ---------------------------------------------------------------------------------------------
// Backends

function redisBackend(redis: Redis, prefix: string): Backend {
  const xpKey = (w: string) => `${prefix}lb:xp:${w}`;
  const nameKey = (w: string) => `${prefix}lb:names:${w}`;
  return {
    async setMax(week, id, xp, handle) {
      const p = redis.pipeline();
      p.zadd(xpKey(week), { gt: true }, { score: xp, member: id });
      p.hset(nameKey(week), { [id]: handle });
      p.expire(xpKey(week), KEEP_SEC);
      p.expire(nameKey(week), KEEP_SEC);
      await p.exec();
    },
    async remove(week, id) {
      const p = redis.pipeline();
      p.zrem(xpKey(week), id);
      p.hdel(nameKey(week), id);
      await p.exec();
    },
    async top(week, n) {
      const flat = await redis.zrange<(string | number)[]>(xpKey(week), 0, n - 1, { rev: true, withScores: true });
      const rows: { id: string; xp: number }[] = [];
      for (let i = 0; i + 1 < flat.length; i += 2) rows.push({ id: String(flat[i]), xp: Number(flat[i + 1]) });
      if (!rows.length) return [];
      const names = (await redis.hmget<Record<string, string>>(nameKey(week), ...rows.map((r) => r.id))) ?? {};
      return rows.map((r) => ({ ...r, handle: names[r.id] ?? 'Member' }));
    },
    async place(week, id) {
      const p = redis.pipeline();
      p.zrevrank(xpKey(week), id);
      p.zscore(xpKey(week), id);
      p.hget(nameKey(week), id);
      const [rank, score, handle] = (await p.exec()) as [number | null, number | string | null, string | null];
      if (rank === null || score === null) return null;
      return { rank: rank + 1, xp: Number(score), handle: handle ?? 'Member' };
    },
    size: (week) => redis.zcard(xpKey(week)),
  };
}

interface BoardRecord {
  scores: Record<string, number>;
  names: Record<string, string>;
}

/** Local files / Blob: one versioned record per week, compare-and-set with retries. */
function recordBackend(): Backend {
  const key = (w: string) => `lb:${w}`;
  const read = async (w: string) => (await getStore().get<BoardRecord>(key(w)))?.value ?? { scores: {}, names: {} };
  const ranked = (r: BoardRecord) => Object.entries(r.scores).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1));
  return {
    async setMax(week, id, xp, handle) {
      const store = getStore();
      for (let i = 0; i < 5; i++) {
        const hit = await store.get<BoardRecord>(key(week));
        const rec = hit?.value ?? { scores: {}, names: {} };
        if ((rec.scores[id] ?? -1) >= xp && rec.names[id] === handle) return;
        rec.scores[id] = Math.max(rec.scores[id] ?? 0, xp);
        rec.names[id] = handle;
        try {
          await store.set(key(week), rec, { version: hit?.version ?? 0, ttlSec: KEEP_SEC });
          return;
        } catch (err) {
          if (!isConflictError(err)) throw err;
        }
      }
    },
    async remove(week, id) {
      const store = getStore();
      for (let i = 0; i < 5; i++) {
        const hit = await store.get<BoardRecord>(key(week));
        if (!hit || !(id in hit.value.scores)) return;
        delete hit.value.scores[id];
        delete hit.value.names[id];
        try {
          await store.set(key(week), hit.value, { version: hit.version, ttlSec: KEEP_SEC });
          return;
        } catch (err) {
          if (!isConflictError(err)) throw err;
        }
      }
    },
    async top(week, n) {
      const rec = await read(week);
      return ranked(rec)
        .slice(0, n)
        .map(([id, xp]) => ({ id, xp, handle: rec.names[id] ?? 'Member' }));
    },
    async place(week, id) {
      const rec = await read(week);
      const i = ranked(rec).findIndex(([x]) => x === id);
      return i < 0 ? null : { rank: i + 1, xp: rec.scores[id], handle: rec.names[id] ?? 'Member' };
    },
    size: async (week) => Object.keys((await read(week)).scores).length,
  };
}

let override: Backend | null = null;
let redisClient: { prefix: string; backend: Backend } | null = null;

function backend(): Backend {
  if (override) return override;
  const store = getStore();
  if (store.driver !== 'redis') return recordBackend();
  if (!redisClient || redisClient.prefix !== store.prefix) {
    const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
    redisClient = { prefix: store.prefix, backend: redisBackend(new Redis({ url: url!, token: token! }), store.prefix) };
  }
  return redisClient.backend;
}

/** Tests: the record backend on the test store even when Redis is configured. */
export function useRecordBoardForTests(on: boolean): void {
  override = on ? recordBackend() : null;
}

// ---------------------------------------------------------------------------------------------
// Sync and read

/** Writes this profile's weekly XP and handle onto the board. Idempotent; zero XP this week is not listed. */
export async function syncBoard(profile: Profile, now: Date = new Date()): Promise<void> {
  const week = boardWeek(now);
  const xp = weekXpOf(profile, week);
  if (xp <= 0) return;
  await backend().setMax(week, profile.id, xp, boardHandle(profile));
}

/** Profiles with a sync already scheduled (and since when), so several awards in one request sync once. */
const pending = new Map<string, number>();
const PENDING_MS = 60_000;

/**
 * After an award is saved: re-read the profile and sync it. Called from inside `updateProfile`
 * (the points subscriber), so it only schedules; the work runs after the response with `after()`.
 * Outside a request (scripts, tests) nothing is scheduled: reading the board syncs the reader.
 */
export function scheduleBoardSync(profileId: string): void {
  const since = pending.get(profileId);
  if (since !== undefined && Date.now() - since < PENDING_MS) return;
  try {
    after(async () => {
      pending.delete(profileId);
      try {
        const profile = await getProfile(profileId);
        if (profile) await syncBoard(profile);
      } catch (err) {
        console.error(`[leaderboard] sync failed: ${(err as Error).message}`);
      }
    });
    pending.set(profileId, Date.now());
  } catch {
    // not inside a request
  }
}

/** Takes a deleted profile off this week's and last week's boards (called when a profile is deleted). */
export async function removeFromBoards(profileId: string, now: Date = new Date()): Promise<void> {
  const b = backend();
  const weeks = [boardWeek(now), boardWeek(new Date(now.getTime() - 7 * 86_400_000))];
  await Promise.all(weeks.map((w) => b.remove(w, profileId)));
}

export async function readBoard(viewer: Profile | null, now: Date = new Date()): Promise<Board> {
  const week = boardWeek(now);
  const b = backend();
  if (viewer) await syncBoard(viewer, now);
  const [rows, you, players] = await Promise.all([b.top(week, BOARD_SIZE), viewer ? b.place(week, viewer.id) : Promise.resolve(null), b.size(week)]);
  return {
    week,
    top: rows.map((r, i) => ({ rank: i + 1, handle: r.handle, xp: r.xp, you: r.id === viewer?.id })),
    you,
    players,
  };
}
