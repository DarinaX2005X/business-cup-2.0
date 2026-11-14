import type { z } from 'zod';
import type { Profile } from '@/domain/types';
import { HttpError } from '@/server/profile/http';

/**
 * Paying and the Cup offer need an email account (so the plan can be opened from any device).
 * 401 account_required for a guest profile; the shared demo accounts already have Max and cannot check
 * out (409 demo_account), so one judge cannot change the plan everyone else sees.
 */
export function requireAccount(profile: Profile, opts: { allowDemo?: boolean } = {}): void {
  if (!profile.account) throw new HttpError(401, 'account_required', 'Create a free account first. Your map and points stay with it.');
  if (profile.demo && !opts.allowDemo) throw new HttpError(409, 'demo_account', 'This demo account already has Max. Create your own account to try the checkout.');
}

/** Like readJson, but an empty body counts as `{}` (billing calls whose fields all have defaults). */
export async function readOptionalJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  const text = await req.text();
  let raw: unknown = {};
  if (text.trim()) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, 'invalid_input', 'Request body is not valid JSON.');
    }
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    throw new HttpError(400, 'invalid_input', parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '));
  }
  return parsed.data;
}
