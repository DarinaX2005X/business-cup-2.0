import { loadEnv } from '../ai/load-env';

/**
 * Pilot partner rewards (Claude Pro, ChatGPT Plus) are fulfilled by hand: this lists the requests
 * waiting for a code, oldest first, from the configured store (namespace by environment, see
 * src/server/store). Read-only.
 *   npx tsx scripts/stripe/partner-requests.ts
 */
loadEnv();

async function main() {
  const { getStore } = await import('@/server/store');
  const { rewardById } = await import('@/domain/points');
  const store = getStore();
  const rows: { at: string; profileId: string; redemptionId: string; reward: string; email: string }[] = [];
  for (const key of await store.list('profile:')) {
    const hit = await store.get<{ id: string; redemptions?: { id: string; rewardId: string; status: string; email?: string; at: string }[] }>(key);
    for (const r of hit?.value.redemptions ?? []) {
      if (r.status === 'requested' && rewardById(r.rewardId)?.kind === 'partner_gift') {
        rows.push({ at: r.at, profileId: hit!.value.id, redemptionId: r.id, reward: r.rewardId, email: r.email ?? '' });
      }
    }
  }
  rows.sort((a, b) => a.at.localeCompare(b.at));
  console.log(`${store.driver} ${store.prefix}: ${rows.length} partner request(s) waiting`);
  for (const r of rows) console.log(`${r.at}  ${r.reward.padEnd(16)} ${r.email}  profile ${r.profileId} ${r.redemptionId}`);
}

main().catch((err) => {
  console.error((err as Error).message);
  process.exit(1);
});
