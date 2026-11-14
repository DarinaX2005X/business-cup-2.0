'use client';

import { Check, Copy, ExternalLink } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/kit/Button';
import { Dialog } from '@/components/kit/Overlay';
import btn from '@/components/kit/controls.module.css';
import { useT } from '@/i18n/client';
import { useProfile } from '@/lib/client/profile';
import { shareProofPage } from './api';
import st from './progress.module.css';

/**
 * «Share my proof page»: asks the server for the link (which records proof_shared), copies it, and opens a
 * small dialog with the link, Open and LinkedIn. On a phone with a share sheet, the sheet opens instead.
 * Without a public rep the button says why it is unavailable.
 */
export function ShareProof({ publicCount }: { publicCount: number }) {
  const { t } = useT();
  const { applyAwards } = useProfile();
  const ref = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const share = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await shareProofPage();
      setUrl(r.url);
      applyAwards(r.pointsAwarded, ref.current);
      const phone = typeof navigator.share === 'function' && window.matchMedia('(pointer: coarse)').matches;
      if (phone) {
        await navigator.share({ url: r.url, title: t('progress.share.title') }).catch(() => undefined);
      } else {
        await copy(r.url);
        setOpen(true);
      }
    } catch {
      setError(t('progress.share.error'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={st.shareWrap}>
      <Button
        ref={ref}
        variant="secondary"
        size="sm"
        loading={busy}
        onClick={share}
        disabledReason={publicCount === 0 ? t('progress.share.needPublic') : undefined}
      >
        {t('progress.share.button')}
      </Button>
      {error ? (
        <p className={st.inlineError} role="alert">
          {error}
        </p>
      ) : null}
      <Dialog open={open && !!url} onClose={() => setOpen(false)} title={t('progress.share.title')}>
        <p className={st.shareBody}>{t('progress.share.body')}</p>
        <div className={st.shareLink}>
          <input readOnly value={url ?? ''} aria-label={t('progress.share.title')} onFocus={(e) => e.currentTarget.select()} />
          <Button size="sm" variant="secondary" icon={copied ? <Check size={18} /> : <Copy size={18} strokeWidth={1.75} />} onClick={() => url && copy(url)}>
            {copied ? t('progress.share.copied') : t('progress.share.copy')}
          </Button>
        </div>
        <div className={st.shareActions}>
          <a href={url ?? '#'} target="_blank" rel="noreferrer" className={`${btn.btn} ${btn.b_primary} ${btn.s_sm}`}>
            <ExternalLink size={18} strokeWidth={1.75} aria-hidden="true" />
            <span>{t('progress.share.open')}</span>
          </a>
          <a
            href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url ?? '')}`}
            target="_blank"
            rel="noreferrer"
            className={`${btn.btn} ${btn.b_secondary} ${btn.s_sm}`}
          >
            {t('progress.share.linkedin')}
          </a>
        </div>
      </Dialog>
    </div>
  );
}
