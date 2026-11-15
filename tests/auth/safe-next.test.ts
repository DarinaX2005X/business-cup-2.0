import { describe, expect, it } from 'vitest';
import { safeNext } from '@/components/auth/safeNext';

const ORIGIN = 'https://irreplaceable.example';
const BS = String.fromCharCode(92); // a backslash

describe('safeNext (where /login goes after signing in)', () => {
  it('keeps paths on this site, with their query and hash', () => {
    expect(safeNext('/today', ORIGIN)).toBe('/today');
    expect(safeNext('/x/abc123def456?tab=plan#top', ORIGIN)).toBe('/x/abc123def456?tab=plan#top');
  });

  it('refuses other sites in every disguise', () => {
    const tricks = [
      'https://evil.com',
      '//evil.com',
      `/${BS}evil.com`,
      '/%5Cevil.com',
      '/%5cevil.com',
      '/%2F/evil.com',
      `${BS}${BS}evil.com`,
      '/\t/evil.com',
      'javascript:alert(1)',
      '',
      '/.//evil.com',
      '/%2e//evil.com',
      '/..//evil.com',
      '/./%2F/evil.com',
    ];
    for (const v of tricks) expect(safeNext(v, ORIGIN), v).toBe('/home');
    expect(safeNext(null, ORIGIN)).toBe('/home');
  });
});
