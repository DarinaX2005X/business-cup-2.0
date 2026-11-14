'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { Dialog } from '@/components/kit/Overlay';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { useOptionalProfile } from '@/lib/client/profile';
import { AuthForm, type AuthMode } from './AuthForm';

interface AuthApi {
  /** Opens the sign-up / log-in dialog; `then` runs after a successful sign up or log in. */
  openAuth(mode?: AuthMode, then?: () => unknown, gate?: boolean, onCancel?: () => void): void;
}

const AuthContext = createContext<AuthApi | null>(null);

/** The account dialog, available everywhere (mounted once in AppProviders). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useT();
  const [state, setState] = useState<{ mode: AuthMode; gate: boolean } | null>(null);
  const then = useRef<(() => unknown) | null>(null);
  const cancel = useRef<(() => void) | null>(null);

  const openAuth = useCallback((mode: AuthMode = 'signup', next?: () => unknown, gate = false, onCancel?: () => void) => {
    cancel.current?.();
    then.current = next ?? null;
    cancel.current = onCancel ?? null;
    setState({ mode, gate });
  }, []);
  const close = useCallback(() => {
    const c = cancel.current;
    then.current = null;
    cancel.current = null;
    setState(null);
    c?.();
  }, []);
  const api = useMemo(() => ({ openAuth }), [openAuth]);

  return (
    <AuthContext.Provider value={api}>
      {children}
      <Dialog open={!!state} onClose={close} title={state ? t(`auth.meta.${state.mode}`) : ''}>
        {state ? (
          <AuthForm
            key={state.mode}
            mode={state.mode}
            gate={state.gate}
            onMode={(mode) => setState((s) => (s ? { ...s, mode } : s))}
            onDone={() => {
              const next = then.current;
              then.current = null;
              cancel.current = null;
              setState(null);
              void next?.();
            }}
          />
        ) : null}
      </Dialog>
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth() needs <AuthProvider> (AppProviders).');
  return ctx;
}

/**
 * Wraps an action that needs an account (a subscription, the Business Cup offer). A guest gets the
 * sign-up dialog first; the server's 401 `account_required` also opens it. After a successful sign up
 * or log in the same action runs again.
 */
export function useRequireAccount() {
  const { openAuth } = useAuth();
  const prof = useOptionalProfile();
  const hasAccount = !!prof?.account;
  return useCallback(
    async <R,>(action: () => Promise<R>): Promise<R | undefined> => {
      const ask = () => new Promise<R | undefined>((resolve, reject) => openAuth('signup', () => action().then(resolve, reject), true, () => resolve(undefined)));
      if (!hasAccount && prof?.status !== 'loading') return ask();
      try {
        return await action();
      } catch (err) {
        if (err instanceof ApiError && err.code === 'account_required') return ask();
        throw err;
      }
    },
    [hasAccount, openAuth, prof?.status],
  );
}

/** True when the error means «sign in first» (for screens that handle the call themselves). */
export const isAccountRequired = (err: unknown) => err instanceof ApiError && err.code === 'account_required';
