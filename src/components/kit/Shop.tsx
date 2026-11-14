'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Button } from './Button';
import { KeystoneMark } from './Mark';
import { sound } from './sound';
import { useKit } from './strings';
import st from './rewards.module.css';

export interface ShopVoucherProps {
  /** Big words on the violet top, for example «10%» and «off yearly». */
  big: string;
  bigSub?: string;
  brand: string;
  /** Darker top for partner gifts. */
  tone?: 'violet' | 'deep';
  showMark?: boolean;
  name: string;
  cost: number;
  balance: number;
  onRedeem?: () => void;
  /** Pending redeem request. */
  redeeming?: boolean;
  /** When the code arrives, the voucher tears along its line and turns over to show it. */
  code?: string;
  /** Text on the back when there is no code (for example «Sent to your email»). */
  issuedNote?: string;
}

export function ShopVoucher({ big, bigSub, brand, tone = 'violet', showMark = true, name, cost, balance, onRedeem, redeeming, code, issuedNote }: ShopVoucherProps) {
  const { s, num } = useKit();
  const affordable = balance >= cost;
  const issued = !!code || !!issuedNote;
  // Issued on first render: already turned over. Issued later: tear first, then turn over.
  const [revealed, setRevealed] = useState(issued);
  const [prevIssued, setPrevIssued] = useState(issued);
  if (prevIssued !== issued) {
    setPrevIssued(issued);
    setRevealed(false);
  }
  const phase: 'idle' | 'tear' | 'flipped' = !issued ? 'idle' : revealed ? 'flipped' : 'tear';
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!issued || revealed) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!reduce) sound.play('redeem');
    const t = window.setTimeout(() => setRevealed(true), reduce ? 0 : 520);
    return () => window.clearTimeout(t);
  }, [issued, revealed]);

  const need = Math.max(0, cost - balance);
  return (
    <div className={st.voucher} data-phase={phase} data-tone={tone}>
      <div className={st.vInner}>
        <div className={st.vFront}>
          <div className={`${st.vTop} field`}>
            <div className={st.vBrand}>
              {showMark ? <KeystoneMark size={22} tone="violet" /> : null}
              {brand}
            </div>
            <div className={st.vBig}>
              {big}
              {bigSub ? <small>{bigSub}</small> : null}
            </div>
          </div>
          <div className={st.perf} aria-hidden="true" />
          <div className={st.vStub}>
            <div>
              <div className={st.vPrice}>
                <b>{num(cost)}</b> {s.points}
              </div>
              <div className={st.vName}>{name}</div>
            </div>
            {affordable ? (
              <Button block size="sm" loading={redeeming} loadingLabel={s.redeem} onClick={onRedeem}>
                {s.redeem}
              </Button>
            ) : (
              <div className={st.need}>
                <div className={st.needBar}>
                  <i style={{ width: `${Math.min(100, (balance / cost) * 100)}%` }} />
                </div>
                <span>{s.needMore(num(need))}</span>
              </div>
            )}
          </div>
        </div>
        <div className={st.vBack} aria-hidden={phase !== 'flipped'}>
          <div className={st.vBrand} style={{ color: 'var(--ink-2)' }}>
            {showMark ? <KeystoneMark size={22} tone="paper" /> : null}
            {brand}
          </div>
          <div className={st.vBackBig}>
            {big}
            {bigSub ? <small> {bigSub}</small> : null}
          </div>
          {code ? (
            <>
              <div className={st.codeK}>{s.yourCode}</div>
              <div className={st.code}>{code}</div>
              <Button
                variant="secondary"
                size="sm"
                block
                icon={copied ? <Check /> : <Copy />}
                onClick={() => {
                  void navigator.clipboard?.writeText(code).catch(() => undefined);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1600);
                }}
              >
                {copied ? s.copied : s.copy}
              </Button>
            </>
          ) : (
            <p className={st.vName}>{issuedNote}</p>
          )}
        </div>
      </div>
    </div>
  );
}

export function ShopSoon() {
  const { s } = useKit();
  return (
    <div className={st.soon}>
      <div className={st.ghost} aria-hidden="true" />
      <b>{s.comingSoon}</b>
    </div>
  );
}

/**
 * A Pro area as a sealed work file: a stack of sheets held by a violet band, placeholder
 * lines only (real content is never rendered underneath), the reason and the way in beside it.
 */
export function LockedPanel({ title, reason, action, shape = 'week', band }: { title: string; reason: string; action: ReactNode; shape?: 'week' | 'list'; band?: string }) {
  const { s } = useKit();
  return (
    <section className={st.locked} aria-label={title}>
      <div className={st.lockedIn}>
      <div className={st.sealArt} aria-hidden="true">
        <div className={st.sealBack} />
        <div className={st.sealSheet} data-shape={shape}>
          <i className={st.sealHead} />
          {shape === 'week' ? (
            <div className={st.sealTiles}>
              {[16, 9, 13, 21, 11, 6].map((w, i) => (
                <span key={i} style={{ flexGrow: w }} />
              ))}
            </div>
          ) : null}
          {[88, 72, 80, 56, 76].slice(0, shape === 'week' ? 3 : 5).map((w, i) => (
            <i key={i} className={st.sealLine} style={{ width: `${w}%` }} />
          ))}
          <div className={st.sealBand}>
            <KeystoneMark size={22} tone="violet" />
            <span>{band ?? s.lockedBand}</span>
          </div>
        </div>
      </div>
      <div className={st.lockedText}>
        <h3>{title}</h3>
        <p>{reason}</p>
        <div className={st.lockedAction}>{action}</div>
      </div>
      </div>
    </section>
  );
}

/** Where a number comes from, said in one line. */
export function SourceNote({ children, href, surface = 'paper' }: { children: ReactNode; href?: string; surface?: 'paper' | 'violet' }) {
  const icon = (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2.5" y="1.5" width="11" height="13" rx="2" stroke="currentColor" strokeWidth="1.4" />
      <path d="M5 5h6M5 8h6M5 11h3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
  return (
    <p className={st.source} data-surface={surface}>
      {icon}
      {href ? (
        <a href={href} target="_blank" rel="noreferrer">
          {children}
        </a>
      ) : (
        <span>{children}</span>
      )}
    </p>
  );
}
