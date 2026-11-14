import { z } from 'zod';
import { readJson, requireProfile, withApi } from '@/server/profile/http';
import { OCC_CODE_RE } from '@/server/xray/data';
import { createXray } from '@/server/xray/records';

const shareSchema = z.object({ taskId: z.string().min(1).max(16), share: z.number().positive().max(100) });

const bodySchema = z.object({
  occupationCode: z.string().regex(OCC_CODE_RE, 'occupationCode: expected an O*NET-SOC code like 29-1141.00'),
  shares: z.array(shareSchema).min(1).max(40),
  jobTitle: z.string().trim().min(1).max(120),
  inputSource: z.enum(['title', 'resume', 'description']),
  salary: z.number().int().min(1_000).max(10_000_000).nullable().optional(),
  requestId: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/).nullish(),
});

/**
 * POST /api/xray (profile required) { occupationCode, shares, jobTitle, inputSource, salary?, requestId? }
 * → 201 XrayResult & { pointsAwarded }. A repeated `requestId` returns the same map (200, no new points).
 */
export const POST = withApi(async (req: Request) => {
  const profile = await requireProfile(req);
  const body = await readJson(req, bodySchema);
  const { xray, awards, created } = await createXray({ profile, ...body });
  return Response.json({ ...xray, pointsAwarded: awards }, { status: created ? 201 : 200 });
});
