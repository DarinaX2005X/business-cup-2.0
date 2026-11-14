import { randomBytes } from 'node:crypto';
import { loadEnv } from './load-env';

/**
 * Real round-trip against the configured store (Redis when KV_REST_API_* are set):
 * set/get, version conflict, incrFloat with TTL, setNx exclusivity, delIfEquals, list, del.
 * Runs in a unique `irr:check:<random>:` namespace and deletes only its own keys.
 *   npx tsx scripts/ai/store-roundtrip.ts
 */
loadEnv();
process.env.STORE_PREFIX = `irr:check:${randomBytes(4).toString('hex')}:`;

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`FAIL: ${msg}`);
}

async function main() {
  const { getStore, isConflictError } = await import('@/server/store');
  const store = getStore();
  console.log(`driver ${store.driver}, namespace ${store.prefix}`);
  const keys = ['rec', 'counter', 'lock'];
  try {
    const v1 = await store.set('rec', { a: 1 }, { version: 0 });
    assert(v1 === 1, `create returns version 1, got ${v1}`);
    const got = await store.get<{ a: number }>('rec');
    assert(got?.value.a === 1 && got.version === 1, 'get returns value and version');

    const v2 = await store.set('rec', { a: 2 }, { version: 1 });
    assert(v2 === 2, 'conditional write bumps version');
    let conflict = false;
    try {
      await store.set('rec', { a: 3 }, { version: 1 });
    } catch (err) {
      conflict = isConflictError(err);
    }
    assert(conflict, 'stale version throws ConflictError');
    let exists = false;
    try {
      await store.set('rec', { a: 4 }, { version: 0 });
    } catch (err) {
      exists = isConflictError(err);
    }
    assert(exists, 'create-only on an existing key throws ConflictError');
    assert((await store.get<{ a: number }>('rec'))?.value.a === 2, 'losing writes left the record unchanged');

    const parallel = await Promise.allSettled([1, 2, 3, 4, 5].map((n) => store.set('rec', { a: 10 + n }, { version: 2 })));
    const winners = parallel.filter((r) => r.status === 'fulfilled').length;
    assert(winners === 1, `exactly one of 5 parallel CAS writes wins (got ${winners})`);

    const incs = await Promise.all(Array.from({ length: 10 }, () => store.incrFloat('counter', 0.25, 60)));
    assert(Math.max(...incs) === 2.5, `10 parallel incrFloat(0.25) reach 2.5 (got ${Math.max(...incs)})`);
    assert((await store.getNumber('counter')) === 2.5, 'getNumber reads the counter');
    assert((await store.getNumber('missing')) === 0, 'missing counter reads 0');

    const locks = await Promise.all([store.setNx('lock', 'a', 30), store.setNx('lock', 'b', 30)]);
    assert(locks.filter(Boolean).length === 1, 'exactly one of two parallel setNx succeeds');
    const holder = locks[0] ? 'a' : 'b';
    assert(!(await store.delIfEquals('lock', holder === 'a' ? 'b' : 'a')), 'delIfEquals refuses a foreign token');
    assert(await store.delIfEquals('lock', holder), 'delIfEquals releases own token');

    const listed = await store.list('');
    assert(listed.includes('rec') && listed.includes('counter'), `list returns logical keys (got ${listed.join(',')})`);

    await store.del('rec');
    assert((await store.get('rec')) === null, 'del removes the record');
    console.log('OK: set/get, version conflict, parallel CAS, incrFloat, setNx, delIfEquals, list, del');
  } finally {
    await Promise.all(keys.map((k) => store.del(k)));
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
