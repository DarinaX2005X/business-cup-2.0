import { FREEZE_MAX, REWARDS } from '@/domain/points';
import { withApi } from '@/server/profile/http';

/** GET /api/shop → { rewards, freezeMax }: the catalog; balance and redemptions come with the profile. */
export const GET = withApi(async () => Response.json({ rewards: REWARDS, freezeMax: FREEZE_MAX }));
