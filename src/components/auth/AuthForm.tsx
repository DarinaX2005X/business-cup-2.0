'use client';

import { Eye, EyeOff } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/kit/Button';
import { Field } from '@/components/kit/Field';
import { useT } from '@/i18n/client';
import { ApiError } from '@/lib/client/api';
import { loginRequest, PASSWORD_MIN, signupRequest, validEmail } from '@/lib/client/auth';
import { useProfile } from '@/lib/client/profile';
import st from './auth.module.css';

export type AuthMode = 'signup' | 'login';

const KNOWN = ['invalid_login', 'email_taken', 'account_exists', 'rate_limited', 'network'];

/**
 * Email and password, for signing up or logging in. Sign up attaches the account to the current
 * profile (a guest one is made first if there is none), so the week map and progress stay. Log in
 * swaps this device to the account's profile. Errors sit at the field or under the form; what the
 * person typed is kept.
 */
export function AuthForm({ mode, onMode, onDone, gate = false }: { mode: AuthMode; onMode: (m: AuthMode) => void; onDone: (mode: AuthMode) => void; gate?: boolean }) {
  const { t } = useT();
  const prof = useProfile();
  const id = useId();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState<{ email?: boolean; password?: boolean }>({});
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passRef = useRef<HTMLInputElement>(null);

  const emailErr = touched.email && !validEmail(email) ? t('auth.email.invalid') : undefined;
  const passErr = touched.password && password.length < PASSWORD_MIN ? t('auth.password.short') : undefined;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setTouched({ email: true, password: true });
    if (!validEmail(email)) return emailRef.current?.focus();
    if (password.length < PASSWORD_MIN) return passRef.current?.focus();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'signup') {
        await prof.ensure();
        await signupRequest(email.trim(), password);
        await prof.refresh();
      } else {
        const creds = await loginRequest(email.trim(), password);
        const ok = await prof.signIn({ id: creds.id, secret: creds.secret });
        if (!ok) throw new ApiError('network', 0, 'login profile did not load');
      }
      onDone(mode);
    } catch (err) {
      const code = err instanceof ApiError ? err.code : 'network';
      setError(KNOWN.includes(code) ? code : 'generic');
      setBusy(false);
    }
  };

  const title = gate && mode === 'signup' ? t('auth.gate.title') : t(`auth.${mode}.title`);
  const lead = gate && mode === 'signup' ? t('auth.gate.lead') : t(`auth.${mode}.lead`);

  return (
    <form className={st.form} onSubmit={submit} noValidate aria-labelledby={`${id}-t`}>
      <div className={st.head}>
        <h2 id={`${id}-t`} className={st.title}>
          {title}
        </h2>
        <p className={st.lead}>{lead}</p>
      </div>
      <Field
        ref={emailRef}
        label={t('auth.email.label')}
        type="email"
        name="email"
        autoComplete="email"
        inputMode="email"
        placeholder={t('auth.email.placeholder')}
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => email && setTouched((s) => ({ ...s, email: true }))}
        error={emailErr}
        size="lg"
        required
      />
      <Field
        ref={passRef}
        label={t('auth.password.label')}
        type={show ? 'text' : 'password'}
        name="password"
        autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        onBlur={() => password && setTouched((s) => ({ ...s, password: true }))}
        help={t('auth.password.help')}
        error={passErr}
        size="lg"
        required
        minLength={PASSWORD_MIN}
        trailing={
          <button type="button" className={st.eye} aria-label={show ? t('auth.password.hide') : t('auth.password.show')} aria-pressed={show} onClick={() => setShow((v) => !v)}>
            {show ? <EyeOff size={20} strokeWidth={1.75} aria-hidden="true" /> : <Eye size={20} strokeWidth={1.75} aria-hidden="true" />}
          </button>
        }
      />
      {error ? (
        <p className={st.error} role="alert">
          {t(`auth.errors.${error}`)}
          {error === 'email_taken' || error === 'account_exists' ? (
            <>
              {' '}
              <button type="button" className={st.inline} onClick={() => onMode('login')}>
                {t('auth.signup.switchCta')}
              </button>
            </>
          ) : null}
        </p>
      ) : null}
      <Button type="submit" size="lg" block loading={busy} loadingLabel={t(`auth.${mode}.busy`)}>
        {t(`auth.${mode}.submit`)}
      </Button>
      <p className={st.switch}>
        {t(`auth.${mode}.switch`)}{' '}
        <button
          type="button"
          className={st.inline}
          onClick={() => {
            setError(null);
            onMode(mode === 'signup' ? 'login' : 'signup');
          }}
        >
          {t(`auth.${mode}.switchCta`)}
        </button>
      </p>
    </form>
  );
}
