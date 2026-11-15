'use client';

import { apiFetch } from './api';
import type { Credentials } from './credentials';

/*
 * Email accounts (round 3). A guest profile works without one: mapping the week, the free rep and
 * AI or me. An account is needed to take a subscription. Signing up attaches the account to the current
 * profile, so the guest's map and progress stay; logging in swaps this device to the account's profile.
 */

export const PASSWORD_MIN = 8;

/** POST /api/auth/signup with the current (guest) profile headers → { email, id, secret } (the device's new secret). 409 account_exists / email_taken. */
export const signupRequest = (email: string, password: string) => apiFetch<{ email: string; id: string; secret: string }>('/api/auth/signup', { method: 'POST', body: { email, password } });

/** POST /api/auth/login → the account's profile credentials. 401 invalid_login. */
export const loginRequest = (email: string, password: string) =>
  apiFetch<Credentials & { email: string }>('/api/auth/login', { method: 'POST', profile: null, body: { email, password } });

/** The jury personas as the API names them. */
export type DemoPersona = 'nurse' | 'software' | 'accountant';

/** POST /api/auth/demo { persona } → credentials of the shared demo account (built on first use, about 20 s). */
export const demoRequest = (persona: DemoPersona) => apiFetch<Credentials>('/api/auth/demo', { method: 'POST', profile: null, body: { persona } });

export function validEmail(v: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}
