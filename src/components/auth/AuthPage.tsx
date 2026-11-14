'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { KeystoneMark } from '@/components/kit/Mark';
import { MarketingHeader } from '@/components/public/MarketingHeader';
import { AuthForm, type AuthMode } from './AuthForm';
import st from './auth.module.css';

/** Only same-site paths are followed after logging in. */
const safeNext = (v: string | null) => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/home');

/** /login and /signup: the account form on its own page, then on to `?next=` or Home. */
export function AuthPage({ mode }: { mode: AuthMode }) {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get('next'));
  return (
    <div className={st.page}>
      <MarketingHeader />
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
