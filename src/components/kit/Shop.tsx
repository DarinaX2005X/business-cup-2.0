'use client';

import { Check, Copy, Lock } from 'lucide-react';
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

/** A Pro area: a blurred stand-in drawing (never real data), the reason and the way in. */
export function LockedPanel({ title, reason, action, shape = 'week' }: { title: string; reason: string; action: ReactNode; shape?: 'week' | 'list' }) {
  return (
    <section className={st.locked} aria-label={title}>
      <div className={st.lockedArt} aria-hidden="true" data-shape={shape}>
        {shape === 'week'
          ? [18, 10, 14, 22, 12, 8].map((w, i) => <i key={i} style={{ flexGrow: w }} data-k={i % 3} />)
          : [86, 64, 78, 52].map((w, i) => <i key={i} style={{ width: `${w}%` }} />)}
      </div>
      <div className={st.lockedCard}>
        <span className={st.lockIcon} aria-hidden="true">
          <Lock size={20} strokeWidth={1.75} />
        </span>
        <h3>{title}</h3>
        <p>{reason}</p>
        {action}
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
