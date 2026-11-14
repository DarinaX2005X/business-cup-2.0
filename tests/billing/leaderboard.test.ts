import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Capture after() callbacks so the test can run "after the response" work itself.
const scheduled: (() => Promise<void> | void)[] = [];
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: (fn: () => Promise<void> | void) => void scheduled.push(fn) }));

import { GET as boardGET } from '@/app/api/leaderboard/route';
import { GET as pointsGET } from '@/app/api/points/route';
import { spend } from '@/domain/points';
import type { Profile } from '@/domain/types';
import { emit } from '@/server/events';
import { boardWeek, readBoard, removeFromBoards, syncBoard, weekXpOf } from '@/server/leaderboard';
import { createProfile, getProfile, updateProfile } from '@/server/profile';
import { useTempStore } from '../platform/helpers';

let cleanup: () => void;
beforeEach(() => {
  ({ cleanup } = useTempStore());
  scheduled.length = 0;
});
afterEach(() => cleanup());

async function person(jobTitle: string, nickname?: string) {
  const { profile, secret } = await createProfile({ locale: 'en' });
  await updateProfile(profile.id, (p) => {
    p.jobTitle = jobTitle;
    if (nickname) p.nickname = nickname;
  });
  return { id: profile.id, headers: { 'x-profile-id': profile.id, 'x-profile-secret': secret } };
}

/** Awards points the way product routes do: emit inside updateProfile. */
async function earn(id: string, events: { type: 'xray_completed' | 'used_at_work' | 'plan_item_done'; ref: string }[]): Promise<Profile> {
  const { profile } = await updateProfile(id, (p) => {
    let cur = p;
    for (const e of events) cur = emit(cur, e).profile;
    return cur;
  });
  return profile;
}

const runScheduled = async () => {
  const jobs = scheduled.splice(0);
  for (const job of jobs) await job();
};

describe('weekly leaderboard', () => {
  it('an award schedules the board update after the response; the board ranks this week’s XP', async () => {
    const a = await person('Registered Nurse');
    const b = await person('Senior Software Engineer', 'Night Owl');
    const c = await person('Staff Accountant');
    const day = new Date().toISOString().slice(0, 10);
    await earn(a.id, [{ type: 'xray_completed', ref: 'A' }]);
    await earn(b.id, [{ type: 'xray_completed', ref: 'B' }, { type: 'used_at_work', ref: `${day}:w1` }]);
    expect(scheduled.length).toBe(2);
    await runScheduled();

    const board = await readBoard(null);
    expect(board.week).toBe(boardWeek());
    expect(board.players).toBe(2);
    expect(board.top.map((r) => [r.rank, r.xp])).toEqual([
      [1, 115],
      [2, 100],
    ]);
    expect(board.top[0].handle).toBe('Night Owl');
    expect(board.top[1].handle).toMatch(/^Nurse · \d{4}$/);
    expect(board.you).toBeNull();

    // the third person has no XP this week: not on the board, no rank
    const cView = await readBoard((await getProfile(c.id))!);
    expect(cView.you).toBeNull();
    expect(cView.players).toBe(2);
  });

  it('spending points does not lower the board, and a stale sync cannot lower it either', async () => {
    const a = await person('Registered Nurse');
    const before = await earn(a.id, [{ type: 'xray_completed', ref: 'A' }]);
    await syncBoard(before);
    const after = await earn(a.id, [{ type: 'plan_item_done', ref: 'w1-1' }]);
    await syncBoard(after);
    const { profile: spent } = await updateProfile(a.id, (p) => spend(p, 100, 'rd1', new Date().toISOString())!);
    expect(weekXpOf(spent, boardWeek())).toBe(115);
    await syncBoard(before); // late and stale
    const board = await readBoard(spent);
    expect(board.you).toMatchObject({ rank: 1, xp: 115 });
    expect(board.top[0]).toMatchObject({ you: true, xp: 115 });
  });

  it('GET /api/leaderboard works with and without a profile; /api/points has XP and level', async () => {
    const a = await person('Registered Nurse');
    await earn(a.id, [{ type: 'xray_completed', ref: 'A' }, { type: 'plan_item_done', ref: 'w1-1' }]);

    const pts = await (await pointsGET(new Request('http://localhost/api/points', { headers: a.headers }))).json();
    expect(pts).toMatchObject({ balance: 115, xp: 115, level: 1, levelName: 'Getting started', levelLabel: 'Level 1 · Getting started', nextAt: 150, weekXp: 115 });
    expect(pts.handle).toMatch(/^Nurse · \d{4}$/);

    const mine = await (await boardGET(new Request('http://localhost/api/leaderboard', { headers: a.headers }))).json();
    expect(mine).toMatchObject({ players: 1, you: { rank: 1, xp: 115 }, top: [{ rank: 1, xp: 115, you: true }] });
    const anon = await (await boardGET(new Request('http://localhost/api/leaderboard'))).json();
    expect(anon).toMatchObject({ you: null, top: [{ rank: 1, you: false }] });

    await removeFromBoards(a.id);
    expect((await readBoard(null)).players).toBe(0);
  });
});
