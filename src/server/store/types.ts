/**
 * One key-value contract for every backend (Upstash Redis, private Vercel Blob, local files).
 *
 * Versioned records: every successful `set` bumps the record version by one (a new record gets 1).
 * `set(key, value, { version })` writes only when the stored version equals `version`
 * (0 means "the key must not exist"), otherwise it throws `ConflictError`.
 * Counters (`incrFloat`) and locks (`setNx`) live under their own keys and are not versioned records.
 */
export interface Versioned<T> {
  value: T;
  version: number;
}

export interface SetOptions {
  /** Expected current version; 0 = must not exist; omitted = unconditional write. */
  version?: number;
  /** Expire the key after this many seconds. Omitted = keep forever. */
  ttlSec?: number;
}

export interface Store {
  readonly driver: 'redis' | 'blob' | 'fs';
  /** Environment namespace applied to every physical key (e.g. `irr:dev:`); callers use logical keys. */
  readonly prefix: string;
  get<T = unknown>(key: string): Promise<Versioned<T> | null>;
  /** Returns the new version. */
  set<T = unknown>(key: string, value: T, opts?: SetOptions): Promise<number>;
  del(key: string): Promise<void>;
  /** Atomic increment; returns the new value. `ttlSec` is applied only when the key has no expiry yet. */
  incrFloat(key: string, by: number, ttlSec?: number): Promise<number>;
  /** Reads a counter written by `incrFloat`; missing key = 0. */
  getNumber(key: string): Promise<number>;
  /** Set only if absent; true when this caller created the key. */
  setNx(key: string, value: string, ttlSec: number): Promise<boolean>;
  /** Deletes the key only if it still holds `value` (used to release a lock). */
  delIfEquals(key: string, value: string): Promise<boolean>;
  /** Keys starting with `prefix`, in no particular order. */
  list(prefix: string): Promise<string[]>;
}

export class ConflictError extends Error {
  readonly code = 'conflict';
  constructor(
    readonly key: string,
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Version conflict on ${key}: expected ${expected}, found ${actual}`);
    this.name = 'ConflictError';
  }
}

/** Storage is misconfigured (for example a Redis URL without a token). Fails loudly instead of splitting data. */
export class StoreConfigError extends Error {
  readonly code = 'store_config';
  constructor(message: string) {
    super(message);
    this.name = 'StoreConfigError';
  }
}

export function isConflictError(err: unknown): err is ConflictError {
  return err instanceof ConflictError || (err instanceof Error && err.name === 'ConflictError');
}
