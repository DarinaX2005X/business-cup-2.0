import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Profile } from '@/domain/types';
import { isAiError } from '@/server/ai/client';
import { isConflictError, StoreConfigError } from '@/server/store';
import { authenticate, ProfileNotFoundError } from './index';

/**
 * Small helpers shared by API routes: JSON error shape `{ error: { code, message } }` (PLAN «API»),
 * profile authentication from `x-profile-id` / `x-profile-secret`, and one place that maps
 * failures to status codes. `message` is English for developers; the client shows
 * `common.errors.<code>` from the dictionaries in the user's language.
 */

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function jsonError(status: number, code: string, message: string, extra?: Record<string, unknown>): Response {
  return Response.json({ error: { code, message }, ...extra }, { status });
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    throw new HttpError(400, 'invalid_input', 'Request body is not valid JSON.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, 'invalid_input', where);
  }
  return parsed.data;
}

/** The authenticated profile, or 401. Writes and private reads require both headers. */
export async function requireProfile(req: Request): Promise<Profile> {
  const profile = await authenticate(req.headers.get('x-profile-id'), req.headers.get('x-profile-secret'));
  if (!profile) throw new HttpError(401, 'unauthorized', 'Missing or invalid profile credentials.');
  return profile;
}

/** Same as requireProfile but returns null when no credentials were sent (wrong credentials still 401). */
export async function optionalProfile(req: Request): Promise<Profile | null> {
  if (!req.headers.get('x-profile-id')) return null;
  return requireProfile(req);
}

export function clientIp(req: Request): string | null {
  const fwd = req.headers.get('x-forwarded-for');
  if (fwd) return fwd.split(',')[0]!.trim() || null;
  return req.headers.get('x-real-ip');
}

/** IANA zone from the `x-tz` header if it is a real zone, else null. */
export function clientTz(req: Request): string | null {
  const tz = req.headers.get('x-tz');
  if (!tz || tz.length > 64) return null;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return null;
  }
}

/** Wraps a route handler: maps known failures to the JSON error shape; unknown ones are logged with a reference id. */
export function withApi<A extends unknown[]>(handler: (req: Request, ...rest: A) => Promise<Response>) {
  return async (req: Request, ...rest: A): Promise<Response> => {
    try {
      return await handler(req, ...rest);
    } catch (err) {
      if (err instanceof HttpError) return jsonError(err.status, err.code, err.message, err.extra);
      if (err instanceof ProfileNotFoundError) return jsonError(401, 'unauthorized', 'Profile no longer exists.');
      if (isConflictError(err)) return jsonError(409, 'conflict', 'The record changed at the same time; reload and retry.');
      if (isAiError(err)) {
        return err.code === 'rate_limited'
          ? jsonError(429, 'rate_limited', err.message)
          : jsonError(503, 'ai_unavailable', `AI unavailable (${err.code}).`);
      }
      const ref = randomBytes(4).toString('hex');
      if (err instanceof StoreConfigError) {
        console.error(`[api] ref=${ref} storage not configured: ${err.message}`);
        return jsonError(503, 'storage_unavailable', `Storage is not configured (ref ${ref}).`);
      }
      console.error(`[api] ref=${ref} ${req.method} ${new URL(req.url).pathname}`, err);
      return jsonError(500, 'server_error', `Unexpected error (ref ${ref}).`);
    }
  };
}
