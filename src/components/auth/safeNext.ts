const BACKSLASH = String.fromCharCode(92);
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

/**
 * Where to go after logging in: only a path on this same site. Rejects other origins, protocol-relative
 * `//host`, backslashes (browsers read `/\host` as `//host`), also when percent-encoded, and control
 * characters. Anything else falls back to Home.
 */
export function safeNext(v: string | null | undefined, origin: string, fallback = '/home'): string {
  if (!v || !v.startsWith('/') || v.startsWith('//') || v.includes(BACKSLASH) || CONTROL.test(v)) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(v);
  } catch {
    return fallback;
  }
  if (decoded.includes(BACKSLASH) || decoded.startsWith('//') || CONTROL.test(decoded)) return fallback;
  try {
    const url = new URL(v, origin);
    if (url.origin !== new URL(origin).origin) return fallback;
    // check what is actually returned: `/.//evil.com` normalises to the pathname `//evil.com`
    const out = `${url.pathname}${url.search}${url.hash}`;
    if (!out.startsWith('/') || out.startsWith('//') || out.startsWith(`/${BACKSLASH}`)) return fallback;
    // and its decoded form, so an encoded slash cannot turn it into `//host` later
    const plain = decodeURIComponent(url.pathname);
    if (plain.startsWith('//') || plain.startsWith(`/${BACKSLASH}`)) return fallback;
    return out;
  } catch {
    return fallback;
  }
}
