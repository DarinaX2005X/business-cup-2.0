'use client';

import { Check, Clock3, Copy, Mail, TicketPercent } from 'lucide-react';
import { useState } from 'react';
import { useT } from '@/i18n/client';
import { rewardFromId, rewardName } from './names';
import type { Redemption, Reward } from './types';
import st from './shop.module.css';

const STATUS_ICON = { issued: TicketPercent, applied: Check, requested: Clock3, sent: Mail } as const;

/** «Your rewards»: every redemption with its code (one-click copy) and where it stands. */
export function History({ items, catalogue }: { items: Redemption[]; catalogue: Map<string, Reward> }) {
  const { t, f } = useT();
  const [copied, setCopied] = useState<string | null>(null);
  const rows = [...items].sort((a, b) => b.at.localeCompare(a.at));
  return (
    <section className={st.history} aria-labelledby="history-title">
      <h2 id="history-title" className={st.h2}>
        {t('shop.history.title')}
      </h2>
      {rows.length ? (
        <ul className={st.rows}>
          {rows.map((r) => {
            const reward = catalogue.get(r.rewardId) ?? rewardFromId(r.rewardId);
            const Icon = STATUS_ICON[r.status] ?? Check;
            return (
              <li key={r.id} className={st.row} data-kind={reward.kind}>
                <span className={st.rowMark} aria-hidden="true" />
                <span className={st.rowName}>
                  <b>{rewardName(t, reward)}</b>
                  <span>{t('shop.history.when', { date: f.date(r.at), cost: f.number(r.cost) })}</span>
                </span>
                {r.code ? (
                  <button
                    type="button"
                    className={st.rowCode}
                    onClick={() => {
                      void navigator.clipboard?.writeText(r.code!).catch(() => undefined);
                      setCopied(r.id);
                      window.setTimeout(() => setCopied((c) => (c === r.id ? null : c)), 1600);
                    }}
                    aria-label={t('shop.history.copyCode', { code: r.code })}
                  >
                    <code>{r.code}</code>
                    {copied === r.id ? <Check strokeWidth={2} aria-hidden="true" /> : <Copy strokeWidth={1.75} aria-hidden="true" />}
                    <span className="sr-only" aria-live="polite">
                      {copied === r.id ? t('shop.copied') : ''}
                    </span>
                  </button>
                ) : (
                  <span className={st.rowCodeNone} />
                )}
                <span className={st.rowStatus} data-status={r.status}>
                  <Icon strokeWidth={1.9} aria-hidden="true" />
                  {r.status === 'sent' && r.email ? t('shop.history.status.sentTo', { email: r.email }) : t(`shop.history.status.${r.status}`)}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className={st.empty}>
          <span className={st.emptyArt} aria-hidden="true" />
          <p>{t('shop.history.empty')}</p>
        </div>
      )}
    </section>
  );
}
