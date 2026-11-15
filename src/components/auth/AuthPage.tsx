'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { KeystoneMark } from '@/components/kit/Mark';
import { SiteHeader } from '@/components/landing/SiteHeader';
import { AuthForm, type AuthMode } from './AuthForm';
import { safeNext } from './safeNext';
import st from './auth.module.css';

/** /login and /signup: the account form on its own page, then on to `?next=` or Home. */
export function AuthPage({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const search = useSearchParams();
  // only same-site paths are followed after logging in
  const next = safeNext(search.get('next'), typeof window === 'undefined' ? 'http://localhost' : window.location.origin);
  return (
    <div className={st.page}>
      <SiteHeader />
      <main className={st.main}>
        <div className={st.card}>
          <span className={st.mark} aria-hidden="true">
            <KeystoneMark size={36} />
          </span>
          <AuthForm
            mode={mode}
            onMode={(m) => router.replace(`/${m}${next !== '/home' ? `?next=${encodeURIComponent(next)}` : ''}`)}
            onDone={() => router.push(next)}
          />
        </div>
      </main>
    </div>
  );
}
