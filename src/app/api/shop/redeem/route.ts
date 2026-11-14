import { z } from 'zod';
import { redeem } from '@/server/billing';
import { readJson, requireProfile, withApi } from '@/server/profile/http';

const bodySchema = z.object({
  rewardId: z.string().min(1).max(40),
  email: z.email().max(254).optional(),
  requestId: z
    .string()
    .regex(/^[A-Za-z0-9_-]{8,64}$/)
    .optional(),
});

/**
 * POST /api/shop/redeem { rewardId, email?, requestId? } → 201 { redemption, balance } (200 for a repeated requestId).
 * 400 unknown_reward / email_required / not_available, 402 not_enough_points { need }, 409 discount_pending
 * { redemption } / freeze_limit, 502 payment_provider_error (nothing spent), 503 billing_unavailable.
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const body = await readJson(req, bodySchema);
  const { redemption, balance, created } = await redeem(profile, body);
  return Response.json({ redemption, balance }, { status: created ? 201 : 200 });
});
