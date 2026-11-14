'use client';

import { Check, Link2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/kit/Button';
import { Skeleton } from '@/components/kit/Skeleton';
import type { PointsAward } from '@/domain/types';
import { useT } from '@/i18n/client';
import { apiFetch } from '@/lib/client/api';
import { useProfile } from '@/lib/client/profile';
import { rememberOwnInvite } from './InviteCapture';
import st from './pivot.module.css';

interface InviteInfo {
  code: string;
  path: string;
  joined: number;
  mapped: number;
  rewarded: number;
  terms: { inviterPoints: number; inviteePoints: number; max: number };
  pointsAwarded: PointsAward[];
}

/**
 * «Bring a colleague»: the person's invite link with a copy button and how it went. Opening the panel also
 * pays for colleagues who mapped their week since the last look (GET /api/invite).
 * Used on /pivot; the profile page and the end of the X-ray can mount it too.
 */
export function InvitePanel({ className }: { className?: string }) {
  const { t, f } = useT();
  const profile = useProfile();
  const { applyAwards } = profile;
  const ready = profile.status === 'ready';
  const [info, setInfo] = useState<InviteInfo | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Results arrive through callbacks, so a slow answer never sets state on a panel that has gone.
  const load = useCallback(
    () =>
      apiFetch<InviteInfo>('/api/invite').then(
        (res) => {
          rememberOwnInvite(res.code);
          setInfo(res);
          setFailed(false);
          applyAwards(res.pointsAwarded);
        },
        () => setFailed(true),
      ),
    [applyAwards],
  );

  useEffect(() => {
    if (!ready || info) return;
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  if (!ready) return null;

  const link = info ? `${window.location.origin}${info.path}` : '';
  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // clipboard blocked: the link stays visible and selectable in the field
    }
  };

  const terms = info?.terms ?? { inviterPoints: 300, inviteePoints: 100, max: 10 };
  return (
    <section className={`${st.invite} ${className ?? ''}`} aria-labelledby="invite-title">
      <div className={st.inviteArt} aria-hidden="true">
        <span className={st.inviteSheet} data-k="a" />
        <span className={st.inviteSheet} data-k="b" />
      </div>
      <div className={st.inviteText}>
        <h2 id="invite-title" className={st.h2}>
          {t('pivot.invite.title')}
        </h2>
        <p className={st.inviteLead}>{t('pivot.invite.lead', { inviter: f.integer(terms.inviterPoints), invitee: f.integer(terms.inviteePoints) })}</p>
        {failed ? (
          <p className={st.inviteError} role="alert">
            {t('pivot.invite.error')}{' '}
            <button type="button" className={st.textBtn} onClick={() => {
                setFailed(false);
                void load();
              }}>
              {t('pivot.invite.retry')}
            </button>
          </p>
        ) : (
          <div className={st.inviteRow}>
            <label className={st.inviteField}>
              <span className="sr-only">{t('pivot.invite.linkLabel')}</span>
              {info ? <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} /> : <Skeleton width="100%" height={18} />}
            </label>
            <Button variant="primary" onClick={copy} disabled={!info} icon={copied ? <Check size={18} strokeWidth={2} /> : <Link2 size={18} strokeWidth={1.75} />}>
              <span aria-live="polite">{copied ? t('pivot.invite.copied') : t('pivot.invite.copy')}</span>
            </Button>
          </div>
        )}
        {info ? (
          <p className={st.inviteStatus}>
            {info.rewarded >= terms.max
              ? t('pivot.invite.max', { max: terms.max })
              : info.joined === 0
                ? t('pivot.invite.none')
                : t('pivot.invite.status', { joined: info.joined, mapped: info.mapped })}
            {info.rewarded > 0 && info.rewarded < terms.max ? <> {t('pivot.invite.earned', { points: f.integer(info.rewarded * terms.inviterPoints) })}</> : null}
          </p>
        ) : null}
      </div>
    </section>
  );
}
