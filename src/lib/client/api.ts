import { loadCredentials, type Credentials } from './credentials';

/**
 * fetch for our API: JSON in and out, profile headers, `x-tz`, and one error type.
 * `ApiError.code` matches the server's `{ error: { code } }` (or `network`), so screens show
 * `t('common.errors.' + code)` in the user's language.
 */

export class ApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly body: unknown = null,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiFetchInit extends Omit<RequestInit, 'body'> {
  /** Plain objects are sent as JSON. */
  body?: unknown;
  /** Override the stored credentials (restore links). `null` sends none. */
  profile?: Credentials | null;
}

function timeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

export function profileHeaders(creds: Credentials | null = loadCredentials()): Record<string, string> {
  const h: Record<string, string> = {};
  if (creds) {
    h['x-profile-id'] = creds.id;
    h['x-profile-secret'] = creds.secret;
  }
  const tz = timeZone();
  if (tz) h['x-tz'] = tz;
  return h;
}

export async function apiFetch<T = unknown>(path: string, init: ApiFetchInit = {}): Promise<T> {
  const { body, profile, headers, ...rest } = init;
  const creds = profile === undefined ? loadCredentials() : profile;
  const h = new Headers(headers);
  for (const [k, v] of Object.entries(profileHeaders(creds))) h.set(k, v);
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (typeof body === 'string' || body instanceof FormData || body instanceof Blob) payload = body;
    else {
      payload = JSON.stringify(body);
      h.set('Content-Type', 'application/json');
    }
  }

  let res: Response;
  try {
    res = await fetch(path, { ...rest, headers: h, body: payload, cache: 'no-store' });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('network', 0, 'Network request failed');
  }

  const text = await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(err?.code ?? (res.status >= 500 ? 'server_error' : 'invalid_input'), res.status, err?.message ?? `HTTP ${res.status}`, data);
  }
  return data as T;
}
