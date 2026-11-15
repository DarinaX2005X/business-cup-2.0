'use client';

import { Check, Copy, QrCode } from 'lucide-react';
import Link from 'next/link';
import { InvitePanel } from '@/components/pivot/InvitePanel';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useState } from 'react';
import { planOf } from '@/components/cup/plan';
import { tierOf } from '@/domain/points';
import { Button } from '@/components/kit/Button';
import { Field } from '@/components/kit/Field';
import { KeystoneMark } from '@/components/kit/Mark';
import { Dialog } from '@/components/kit/Overlay';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { ApiError, apiFetch } from '@/lib/client/api';
import { useProfile, type PublicProfile } from '@/lib/client/profile';
import { qrMatrix, qrPath } from './qr';
import st from './profile.module.css';

/**
 * /profile: a calm settings page in one 640 px column. Settings (pay, leaderboard name, sound), the
 * restore link that is the account, the subscription with its tier (Free, Pro or Max; internal id `coach`), and deleting everything.
 * Every field saves on its own and answers next to itself.
 */
export function ProfileScreen() {
  const { t } = useT();
  const { status, profile } = useProfile();
  const [deleted, setDeleted] = useState(false);

  if (deleted) return <Deleted />;
  if (status === 'loading') return <div className={st.page} aria-busy="true" />;
  if (status !== 'ready' || !profile) {
    return (
      <div className={st.page}>
        <h1 className={st.h1}>{t('profile.title')}</h1>
        <p className={st.lead}>{t('profile.noProfile')}</p>
        <Link href="/start" className={`${btn.btn} ${btn.b_primary}`}>
          {t('profile.noProfileAction')}
        </Link>
      </div>
    );
  }
  return (
    <div className={st.page}>
      <h1 className={st.h1}>{t('profile.title')}</h1>
      <section id="settings" className={st.group} aria-labelledby="settings-title">
        <h2 id="settings-title" className={st.h2}>
          {t('profile.settings.title')}
        </h2>
        <div className={st.card}>
          <PayField profile={profile} />
          <NicknameField profile={profile} />
          <SoundRow profile={profile} />
        </div>
      </section>
      <SaveAccount />
      <Subscription profile={profile} />
      <InvitePanel />
      <DeleteData onDeleted={() => setDeleted(true)} />
    </div>
  );
}

/* ---------- pay ---------- */

function PayField({ profile }: { profile: PublicProfile }) {
  const { t } = useT();
  const { update } = useProfile();
  const [value, setValue] = useState(profile.salary ? String(profile.salary) : '');
  const [state, setState] = useState<{ s: 'idle' | 'saving' | 'saved' | 'cleared' } | { s: 'error'; msg: string }>({ s: 'idle' });

  const save = async () => {
    const raw = value.replace(/[\s,$]/g, '');
    const next = raw === '' ? null : Number(raw);
    if (next !== null && (!Number.isInteger(next) || next < 1000 || next > 10_000_000)) return setState({ s: 'error', msg: t('profile.pay.invalid') });
    if (next === (profile.salary ?? null)) return;
    setState({ s: 'saving' });
    try {
      await update({ salary: next });
      setState({ s: next === null ? 'cleared' : 'saved' });
    } catch {
      setState({ s: 'error', msg: t('profile.pay.error') });
    }
  };

  const help =
    state.s === 'saving' ? t('profile.pay.saving') : state.s === 'saved' ? t('profile.pay.saved') : state.s === 'cleared' ? t('profile.pay.cleared') : t('profile.pay.help');
  return (
    <div className={st.row}>
      <h3 className={st.h3}>{t('profile.pay.title')}</h3>
      <Field
        label={t('profile.pay.label')}
        inputMode="numeric"
        autoComplete="off"
        placeholder={t('profile.pay.placeholder')}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (state.s === 'error') setState({ s: 'idle' });
        }}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        help={help}
        error={state.s === 'error' ? state.msg : undefined}
      />
    </div>
  );
}

/* ---------- leaderboard name ---------- */

function NicknameField({ profile }: { profile: PublicProfile }) {
  const { t } = useT();
  const { refresh } = useProfile();
  const stored = (profile as PublicProfile & { nickname?: string | null }).nickname ?? '';
  const [value, setValue] = useState(stored);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'cleared' | 'error'>('idle');
  const [reason, setReason] = useState<string | null>(null);

  const save = async () => {
    const next = value.trim();
    if (next === stored) return;
    setState('saving');
    try {
      await apiFetch('/api/profile', { method: 'PATCH', body: { nickname: next === '' ? null : next } });
      await refresh();
      setState(next === '' ? 'cleared' : 'saved');
    } catch (err) {
      // the name rules (length, characters, words) live on the server; what it refuses is said at the field
      const r = err instanceof ApiError && err.code === 'invalid_nickname' ? (err.body as { reason?: string } | null)?.reason : null;
      setReason(r && ['length', 'characters', 'not_allowed'].includes(r) ? r : null);
      setState('error');
    }
  };
  const help = state === 'saving' ? t('profile.pay.saving') : state === 'saved' ? t('profile.nickname.saved') : state === 'cleared' ? t('profile.nickname.cleared') : t('profile.nickname.help');
  return (
    <div className={st.row}>
      <h3 className={st.h3}>{t('profile.nickname.title')}</h3>
      <Field
        label={t('profile.nickname.label')}
        autoComplete="nickname"
        maxLength={24}
        placeholder={t('profile.nickname.placeholder')}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (state === 'error') setState('idle');
        }}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
        help={help}
        error={state === 'error' ? t(reason ? `profile.nickname.reason.${reason}` : 'profile.nickname.error') : undefined}
      />
    </div>
  );
}

/* ---------- sound ---------- */

function SoundRow({ profile }: { profile: PublicProfile }) {
  const { t } = useT();
  const { update } = useProfile();
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState(false);
  const id = useId();
  return (
    <div className={st.rowInline}>
      <div>
        <h3 className={st.h3} id={id}>
          {t('profile.sound.title')}
        </h3>
        <p className={st.small}>{t('profile.sound.label')}</p>
        {error ? (
          <p className={st.error} role="alert">
            {t('profile.sound.error')}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={profile.sound}
        aria-labelledby={id}
        aria-busy={busy || undefined}
        className={st.switch}
        onClick={async () => {
          setBusy(true);
          setError(false);
          try {
            await update({ sound: !profile.sound });
          } catch {
            setError(true);
          } finally {
            setBusy(false);
          }
        }}
      >
        <span className={st.switchKnob} />
      </button>
    </div>
  );
}

/* ---------- the restore link ---------- */

function SaveAccount() {
  const { t } = useT();
  const { restoreLink } = useProfile();
  // The link holds the secret: it is read from this browser only when the person asks for it.
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [qr, setQr] = useState(false);
  const matrix = useMemo(() => (qr && link ? qrMatrix(link) : null), [qr, link]);

  const copy = async () => {
    const link = restoreLink();
    setLink(link);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setCopyFailed(false);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyFailed(true);
    }
  };

  return (
    <section id="save-account" className={st.group} aria-labelledby="save-title">
      <h2 id="save-title" className={st.h2}>
        {t('profile.device.title')}
      </h2>
      <div className={st.key}>
        <div className={st.keyMain}>
          <p className={st.small}>{t('profile.device.body')}</p>
          <div className={st.keyActions}>
            <Button icon={copied ? <Check size={18} /> : <Copy size={18} strokeWidth={1.75} />} onClick={copy}>
              {copied ? t('profile.device.copied') : t('profile.device.copy')}
            </Button>
            <Button variant="quiet" icon={<QrCode size={18} strokeWidth={1.75} />} aria-expanded={qr} onClick={() => {
                setLink(restoreLink());
                setQr((v) => !v);
              }}
            >
              {qr ? t('profile.device.hideQr') : t('profile.device.showQr')}
            </Button>
          </div>
          <p className={st.warning}>{t('profile.device.warning')}</p>
          {copyFailed && link ? (
            <div className={st.manual}>
              <p className={st.error}>{t('profile.device.copyError')}</p>
              <input readOnly value={link} aria-label={t('profile.device.copy')} onFocus={(e) => e.currentTarget.select()} />
            </div>
          ) : null}
        </div>
        {matrix ? (
          <figure className={st.qr}>
            <svg viewBox={`0 0 ${matrix.length + 8} ${matrix.length + 8}`} role="img" aria-label={t('profile.device.qrLabel')}>
              <rect width="100%" height="100%" className={st.qrPaper} />
              <path d={qrPath(matrix)} className={st.qrInk} />
            </svg>
            <figcaption>{t('profile.device.qrHint')}</figcaption>
          </figure>
        ) : null}
      </div>
    </section>
  );
}

/* ---------- subscription ---------- */

function Subscription({ profile }: { profile: PublicProfile }) {
  const { t, f } = useT();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState(false);
  const plan = planOf(profile.plan);
  const tier: 'free' | 'pro' | 'coach' = plan.active ? tierOf(profile.plan) : 'free';
  const date = plan.periodEnd ? f.date(plan.periodEnd, 'long') : '';
  const line =
    plan.kind === 'free'
      ? t('profile.plan.free')
      : plan.kind === 'cup'
        ? t('profile.plan.cupEnds', { date })
        : plan.kind === 'trialing'
          ? t('profile.plan.trialEnds', { date })
          : profile.plan.cancelAtPeriodEnd
            ? t('profile.plan.ends', { date })
            : t('profile.plan.renews', { date });

  const manage = async () => {
    setOpening(true);
    setError(false);
    try {
      const { url } = await apiFetch<{ url: string }>('/api/billing/portal', { method: 'POST', body: { returnPath: '/profile' } });
      window.location.assign(url);
    } catch {
      setError(true);
      setOpening(false);
    }
  };

  return (
    <section id="subscription" className={st.group} aria-labelledby="sub-title">
      <h2 id="sub-title" className={st.h2}>
        {t('profile.plan.title')}
      </h2>
      <div className={st.card}>
        <div className={st.planHead}>
          <div className={st.planRow}>
            <span className={st.badge} data-tier={tier}>
              {tier !== 'free' ? <KeystoneMark size={18} tone={tier === 'pro' ? 'violet' : 'paper'} /> : null}
              {t(`profile.plan.badge.${tier}`)}
            </span>
            {plan.kind === 'trialing' ? <span className={st.trialTag}>{t('profile.plan.trial')}</span> : null}
          </div>
          <p className={st.planLine}>{line}</p>
        </div>
        {plan.stripe ? (
          <div className={st.planAction}>
            <Button variant="secondary" loading={opening} loadingLabel={t('profile.plan.opening')} onClick={manage}>
              {t('profile.plan.manage')}
            </Button>
            <p className={st.small}>{t('profile.plan.manageHint')}</p>
          </div>
        ) : (
          <div className={st.planAction}>
            <Link href="/pricing" className={`${btn.btn} ${tier === 'free' ? btn.b_primary : btn.b_secondary}`}>
              {t('profile.plan.seePlans')}
            </Link>
          </div>
        )}
        {error ? (
          <p className={st.error} role="alert">
            {t('profile.plan.manageError')}
          </p>
        ) : null}
      </div>
    </section>
  );
}

/* ---------- delete ---------- */

function DeleteData({ onDeleted }: { onDeleted: () => void }) {
  const { t } = useT();
  const { remove } = useProfile();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const word = t('profile.delete.confirmWord');
  const ok = [word.toLowerCase(), 'delete'].includes(typed.trim().toLowerCase());

  const confirm = async () => {
    if (!ok || busy) return;
    setBusy(true);
    setError(false);
    try {
      await remove();
      // Everything this browser kept for the product goes too (credentials, slots, local hints).
      try {
        for (const key of Object.keys(window.localStorage)) if (key.startsWith('irr_')) window.localStorage.removeItem(key);
        window.sessionStorage.setItem('irr_deleted', '1');
      } catch {
        // storage blocked: the credentials were already cleared by remove()
      }
      setOpen(false);
      onDeleted();
    } catch {
      setError(true);
      setBusy(false);
    }
  };

  return (
    <section id="delete" className={st.danger} aria-labelledby="delete-title">
      <h2 id="delete-title" className={st.h2}>
        {t('profile.delete.title')}
      </h2>
      <p className={st.small}>{t('profile.delete.body')}</p>
      <Button variant="destructive" onClick={() => setOpen(true)}>
        {t('profile.delete.action')}
      </Button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title={t('profile.delete.dialogTitle')}
        footer={
          <>
            <Button variant="quiet" onClick={() => setOpen(false)} disabled={busy}>
              {t('common.actions.cancel')}
            </Button>
            <Button variant="destructive" loading={busy} loadingLabel={t('profile.delete.deleting')} disabled={!ok} onClick={confirm}>
              {t('profile.delete.confirm')}
            </Button>
          </>
        }
      >
        <p className={st.dialogText}>{t('profile.delete.list')}</p>
        <Field
          label={t('profile.delete.confirmLabel', { word })}
          value={typed}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void confirm()}
          data-autofocus
        />
        {error ? (
          <p className={st.error} role="alert">
            {t('profile.delete.error')}
          </p>
        ) : null}
      </Dialog>
    </section>
  );
}

function Deleted() {
  const { t } = useT();
  const router = useRouter();
  useEffect(() => {
    const id = window.setTimeout(() => router.push('/'), 2500);
    return () => window.clearTimeout(id);
  }, [router]);
  return (
    <div className={st.page}>
      <div className={st.doneCard} role="status">
        <h1 className={st.h2}>{t('profile.delete.doneTitle')}</h1>
        <p className={st.small}>{t('profile.delete.doneBody')}</p>
        <Link href="/" className={`${btn.btn} ${btn.b_secondary}`}>
          {t('profile.delete.home')}
        </Link>
      </div>
    </div>
  );
}
