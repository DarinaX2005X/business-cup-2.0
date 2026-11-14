'use client';

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as RKeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { mergeRanges, parseDoc, partsOf, wordsOf, type DocBlock, type TextPart } from './repDoc';
import { sound } from './sound';
import { useKit } from './strings';
import type { CharRange, ReviewMark, ReviewMarkKind, Surface } from './types';
import st from './rep.module.css';

export interface RepCardProps {
  /** Document source with light markup (`#`, `##`, `- `, `|` tables). */
  document: string;
  mode: 'answer' | 'review';
  /** The person's highlights as source character ranges; the screen owns them. */
  ranges: CharRange[];
  onRangesChange?: (ranges: CharRange[]) => void;
  /** Editor's marks after checking. */
  marks?: ReviewMark[];
  /** Small «Drafted by AI» plate in the corner. */
  aiTag?: boolean;
  /** Totals and actions under the sheet, drawn by the screen. */
  footer?: ReactNode;
  surface?: Surface;
  /** Paper sheets under the card. */
  stack?: boolean;
  ariaLabel?: string;
}

const PRIORITY: ReviewMarkKind[] = ['found', 'missed', 'first_false', 'false'];
const markClass: Record<ReviewMarkKind, string> = { found: st.mFound, missed: st.mMissed, false: st.mFalse, first_false: st.mFalseFree };

type Hit = { s: number; e: number };

function wordFromPoint(root: HTMLElement, x: number, y: number): Hit | null {
  const el = document.elementFromPoint(x, y);
  const w = el instanceof Element ? el.closest<HTMLElement>('[data-s]') : null;
  if (!w || !root.contains(w)) return null;
  return { s: Number(w.dataset.s), e: Number(w.dataset.e) };
}

export function RepCard({ document: src, mode, ranges, onRangesChange, marks = [], aiTag = true, footer, surface = 'paper', stack = true, ariaLabel }: RepCardProps) {
  const { s } = useKit();
  const hintId = useId();
  const blocks = useMemo(() => parseDoc(src), [src]);
  const parts = useMemo(() => partsOf(blocks), [blocks]);
  const words = useMemo(() => wordsOf(parts), [parts]);
  const title = blocks.find((b): b is Extract<DocBlock, { part: TextPart }> => b.kind === 'h1');
  const sub = blocks.find((b): b is Extract<DocBlock, { part: TextPart }> => b.kind === 'sub');
  const bodyBlocks = blocks.filter((b) => b.kind !== 'h1' && b.kind !== 'sub');

  const [preview, setPreview] = useState<CharRange | null>(null);
  const [cursor, setCursor] = useState<number | null>(null); // keyboard word index
  const [anchor, setAnchor] = useState<number | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [hotId, setHotId] = useState<string | null>(null);

  const textRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{ id: number; type: string; x: number; y: number; a: Hit | null; b: Hit | null; drag: boolean; moved: boolean; timer: number } | null>(null);

  const review = mode === 'review';
  const sortedMarks = useMemo(() => [...marks].sort((a, b) => a.start - b.start), [marks]);

  /* ---------- committing highlights ---------- */

  const commit = useCallback(
    (r: CharRange) => {
      onRangesChange?.(mergeRanges([...ranges, r]));
      sound.play('tap');
    },
    [ranges, onRangesChange],
  );

  // A second press on the word just marked (a double-click or double-tap) keeps it marked.
  const lastMark = useRef<{ s: number; t: number } | null>(null);
  const toggleAt = useCallback(
    (hit: Hit) => {
      const inside = ranges.find((r) => hit.s < r[1] && hit.e > r[0]);
      const now = performance.now();
      const repeat = lastMark.current && lastMark.current.s === hit.s && now - lastMark.current.t < 450;
      if (inside) {
        if (repeat) return;
        lastMark.current = null;
        onRangesChange?.(ranges.filter((r) => r !== inside));
      } else {
        lastMark.current = { s: hit.s, t: now };
        commit([hit.s, hit.e]);
      }
    },
    [ranges, onRangesChange, commit],
  );

  /* ---------- pointer and touch highlighting (answer mode) ---------- */

  useEffect(() => {
    const el = textRef.current;
    if (!el || review) return;
    // While a touch is in highlight mode, the page must not scroll under the finger.
    const onTouchMove = (e: TouchEvent) => {
      if (gesture.current?.drag) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, [review]);

  const startDrag = (g: NonNullable<typeof gesture.current>) => {
    g.drag = true;
    if (g.a) setPreview([g.a.s, g.a.e]);
    if (g.type === 'touch' && 'vibrate' in navigator) navigator.vibrate?.(8);
  };

  const onPointerDown = (e: RPointerEvent) => {
    if (review || e.button > 0 || !textRef.current) return;
    const a = wordFromPoint(textRef.current, e.clientX, e.clientY);
    const g = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, a, b: a, drag: false, moved: false, timer: 0 };
    gesture.current = g;
    if (e.pointerType === 'mouse' || e.pointerType === 'pen') {
      e.preventDefault();
      startDrag(g);
    } else {
      // a short hold turns a touch into highlighting; moving first means the person scrolls
      g.timer = window.setTimeout(() => gesture.current === g && !g.moved && startDrag(g), 220);
    }
  };

  const onPointerMove = (e: RPointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId || !textRef.current) return;
    const far = Math.hypot(e.clientX - g.x, e.clientY - g.y) > 8;
    if (!g.drag) {
      if (far) {
        g.moved = true;
        window.clearTimeout(g.timer);
      }
      return;
    }
    if (far) g.moved = true;
    const b = wordFromPoint(textRef.current, e.clientX, e.clientY);
    if (b) g.b = b;
    if (!g.a && b) g.a = b;
    if (g.a && g.b) setPreview([Math.min(g.a.s, g.b.s), Math.max(g.a.e, g.b.e)]);
  };

  const onPointerUp = (e: RPointerEvent) => {
    const g = gesture.current;
    if (!g || g.id !== e.pointerId) return;
    window.clearTimeout(g.timer);
    gesture.current = null;
    setPreview(null);
    if (!g.a) return;
    const span = g.b && (g.b.s !== g.a.s || g.b.e !== g.a.e);
    if (g.drag && span && g.b) commit([Math.min(g.a.s, g.b.s), Math.max(g.a.e, g.b.e)]);
    else if (!g.moved || g.drag) toggleAt(g.a);
  };

  const onPointerCancel = () => {
    const g = gesture.current;
    if (g) window.clearTimeout(g.timer);
    gesture.current = null;
    setPreview(null);
  };

  /* ---------- keyboard highlighting ---------- */

  const kbdRange: CharRange | null =
    cursor == null ? null : anchor == null ? [words[cursor][0], words[cursor][1]] : [words[Math.min(anchor, cursor)][0], words[Math.max(anchor, cursor)][1]];

  const onKeyDown = (e: RKeyboardEvent) => {
    if (review || !words.length) return;
    const k = e.key;
    if (k === 'ArrowRight' || k === 'ArrowLeft' || k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
      e.preventDefault();
      const d = k === 'ArrowRight' ? 1 : k === 'ArrowLeft' ? -1 : k === 'ArrowDown' ? 8 : k === 'ArrowUp' ? -8 : 0;
      const cur = cursor ?? -1;
      const next = k === 'Home' ? 0 : k === 'End' ? words.length - 1 : Math.min(words.length - 1, Math.max(0, cur + d));
      if (e.shiftKey) setAnchor((a) => (a == null ? Math.max(0, cur) : a));
      else setAnchor(null);
      setCursor(next);
    } else if ((k === 'Enter' || k === ' ') && kbdRange) {
      e.preventDefault();
      if (anchor == null) toggleAt({ s: kbdRange[0], e: kbdRange[1] });
      else commit(kbdRange);
      setAnchor(null);
    } else if (k === 'Escape') {
      setAnchor(null);
    }
  };

  /* ---------- review: margin notes aligned with their lines ---------- */

  const bodyRef = useRef<HTMLDivElement>(null);
  const [tops, setTops] = useState<Record<string, number>>({});
  const noteRefs = useRef<Record<string, HTMLElement | null>>({});
  const [minH, setMinH] = useState(0);

  const layoutNotes = useCallback(() => {
    const body = bodyRef.current;
    if (!body || !review) return;
    const want = sortedMarks.map((m) => {
      const el = body.querySelector<HTMLElement>(`[data-mark-start="${m.id}"]`);
      return { id: m.id, top: el ? el.offsetTop - 2 : 0 };
    });
    want.sort((a, b) => a.top - b.top);
    const next: Record<string, number> = {};
    let floor = 0;
    for (const w of want) {
      const t = Math.max(w.top, floor);
      next[w.id] = t;
      floor = t + (noteRefs.current[w.id]?.offsetHeight ?? 64) + 14;
    }
    setTops(next);
    setMinH(floor);
  }, [review, sortedMarks]);

  useLayoutEffect(() => {
    layoutNotes();
    if (!bodyRef.current) return;
    const ro = new ResizeObserver(() => layoutNotes());
    ro.observe(bodyRef.current);
    return () => ro.disconnect();
  }, [layoutNotes]);

  useEffect(() => {
    if (review && marks.some((m) => m.kind === 'found')) {
      const t = window.setTimeout(() => sound.play('found'), 260);
      return () => window.clearTimeout(t);
    }
  }, [review, marks]);

  const order = useMemo(() => new Map(sortedMarks.map((m, i) => [m.id, i])), [sortedMarks]);

  /* ---------- text rendering ---------- */

  /*
   * Answer mode renders one span per word and per gap with stable keys (their source offsets),
   * so a highlight in progress only changes classes. Re-creating nodes under a finger would
   * detach the touch target and hand the gesture to page scrolling.
   */
  const renderAnswerPart = (p: TextPart) => {
    const end = p.start + p.text.length;
    const re = /[\p{L}\p{N}]+(?:['’.,:/%\-][\p{L}\p{N}]+)*%?/gu;
    const toks: { a: number; b: number; word: boolean }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(p.text))) {
      if (m.index > last) toks.push({ a: p.start + last, b: p.start + m.index, word: false });
      toks.push({ a: p.start + m.index, b: p.start + m.index + m[0].length, word: true });
      last = m.index + m[0].length;
    }
    if (last < p.text.length) toks.push({ a: p.start + last, b: end, word: false });
    return toks.map(({ a, b, word }) => {
      const user = ranges.find((r) => r[0] <= a && b <= r[1]);
      const inPrev = preview && preview[0] <= a && b <= preview[1];
      const inKbd = kbdRange && kbdRange[0] <= a && b <= kbdRange[1];
      const cls = [word ? st.w : '', user ? st.uMark : '', inPrev ? st.uPreview : '', inKbd ? st.uKbd : ''].filter(Boolean).join(' ');
      const edgeRange = user ?? (inPrev ? preview : null);
      return (
        <span
          key={a}
          data-o={a}
          data-s={word ? a : undefined}
          data-e={word ? b : undefined}
          className={cls || undefined}
          data-first={edgeRange && a === Math.max(edgeRange[0], p.start) ? true : undefined}
          data-last={edgeRange && b === Math.min(edgeRange[1], end) ? true : undefined}
        >
          {src.slice(a, b)}
        </span>
      );
    });
  };

  const renderPart = (p: TextPart): ReactNode => {
    if (!review) return renderAnswerPart(p);
    const end = p.start + p.text.length;
    const cuts = new Set<number>([p.start, end]);
    const add = (r: CharRange | null) => {
      if (!r) return;
      for (const x of r) if (x > p.start && x < end) cuts.add(x);
    };
    if (review) sortedMarks.forEach((m) => add([m.start, m.end]));
    else {
      ranges.forEach(add);
      add(preview);
      add(kbdRange);
    }
    const pts = [...cuts].sort((a, b) => a - b);
    const out: ReactNode[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const text = src.slice(a, b);
      const inner = tokens(text, a);
      if (review) {
        const m = PRIORITY.map((k) => sortedMarks.find((x) => x.kind === k && x.start <= a && b <= x.end)).find(Boolean);
        if (m) {
          const first = a === Math.max(m.start, p.start);
          const last = b === Math.min(m.end, end);
          out.push(
            <span
              key={a}
              data-o={a}
              data-mark={m.id}
              data-mark-start={first && a === m.start ? m.id : undefined}
              data-first={first || undefined}
              data-last={last || undefined}
              data-hot={hotId === m.id || openId === m.id || undefined}
              className={`${st.mark} ${markClass[m.kind]}`}
              style={{ '--i': order.get(m.id) ?? 0 } as CSSProperties}
              role={first ? 'button' : undefined}
              tabIndex={first ? 0 : undefined}
              aria-expanded={first ? openId === m.id : undefined}
              aria-label={first ? `${m.title}${m.n ? ` ${m.n}` : ''}: ${src.slice(m.start, m.end)}` : undefined}
              onClick={() => setOpenId((o) => (o === m.id ? null : m.id))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setOpenId((o) => (o === m.id ? null : m.id));
                }
              }}
              onMouseEnter={() => setHotId(m.id)}
              onMouseLeave={() => setHotId(null)}
            >
              {inner}
            </span>,
          );
          if (b === m.end && m.n) out.push(<sup key={`n${a}`} className={st.ref} aria-hidden="true">{m.n}</sup>);
          continue;
        }
        out.push(
          <span key={a} data-o={a}>
            {inner}
          </span>,
        );
        continue;
      }
      const user = ranges.find((r) => r[0] <= a && b <= r[1]);
      const inPrev = preview && preview[0] <= a && b <= preview[1];
      const inKbd = kbdRange && kbdRange[0] <= a && b <= kbdRange[1];
      const cls = [user ? st.uMark : '', inPrev ? st.uPreview : '', inKbd ? st.uKbd : ''].filter(Boolean).join(' ');
      out.push(
        <span
          key={a}
          data-o={a}
          className={cls || undefined}
          data-first={user ? a === Math.max(user[0], p.start) || undefined : undefined}
          data-last={user ? b === Math.min(user[1], end) || undefined : undefined}
        >
          {inner}
        </span>,
      );
    }
    return out;
  };

  const tokens = (text: string, base: number) => {
    const re = /[\p{L}\p{N}]+(?:['’.,:/%\-][\p{L}\p{N}]+)*%?/gu;
    const out: ReactNode[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      out.push(
        <span key={m.index} className={st.w} data-s={base + m.index} data-e={base + m.index + m[0].length}>
          {m[0]}
        </span>,
      );
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return out;
  };

  const marksIn = (b: DocBlock) => {
    const ps = b.kind === 'table' ? [...b.head, ...b.rows.flat()] : [b.part];
    return sortedMarks.filter((m) => ps.some((p) => m.start >= p.start && m.start < p.start + p.text.length));
  };

  const note = (m: ReviewMark, inline: boolean) => (
    <aside
      key={m.id}
      ref={
        inline
          ? undefined
          : (el) => {
              noteRefs.current[m.id] = el;
            }
      }
      className={st.note}
      data-kind={m.kind}
      data-open={openId === m.id || undefined}
      data-hot={hotId === m.id || undefined}
      style={inline ? ({ '--i': order.get(m.id) ?? 0 } as CSSProperties) : ({ top: tops[m.id] ?? 0, '--i': order.get(m.id) ?? 0 } as CSSProperties)}
      onMouseEnter={() => setHotId(m.id)}
      onMouseLeave={() => setHotId(null)}
      onClick={() => inline && setOpenId((o) => (o === m.id ? null : m.id))}
    >
      <span className={st.cn} data-kind={m.kind} aria-hidden="true">
        {m.kind === 'false' ? (
          // a false flag that costs points: a struck mark
          <svg viewBox="0 0 16 16" width="12" height="12">
            <path d="M4 8h8" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        ) : m.kind === 'first_false' ? (
          // the first false flag is free: an open ring with a zero
          <svg viewBox="0 0 16 16" width="13" height="13">
            <text x="8" y="12" textAnchor="middle" fontSize="11" fontWeight="700" fill="currentColor">0</text>
          </svg>
        ) : (
          m.n ?? ''
        )}
      </span>
      <div>
        <b>{m.kind === 'first_false' ? s.notOnOurList : m.title}</b>
        {m.body ? <p>{m.body}</p> : null}
      </div>
    </aside>
  );

  const renderBlock = (b: DocBlock, i: number) => {
    const inline = review ? marksIn(b) : [];
    let el: ReactNode;
    if (b.kind === 'table') {
      el = (
        <div className={st.tableWrap}>
          <table className={st.table}>
            {b.head.length ? (
              <thead>
                <tr>
                  {b.head.map((c) => (
                    <th key={c.start} scope="col">
                      {renderPart(c)}
                    </th>
                  ))}
                </tr>
              </thead>
            ) : null}
            <tbody>
              {b.rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c) => (
                    <td key={c.start}>{renderPart(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (b.kind === 'h2') el = <h3 className={st.h2}>{renderPart(b.part)}</h3>;
    else if (b.kind === 'li')
      el = (
        <p className={st.li}>
          <span className={st.bullet} aria-hidden="true" />
          <span>{renderPart(b.part)}</span>
        </p>
      );
    else el = <p className={st.p}>{renderPart(b.part)}</p>;
    return (
      <div key={i} className={st.block}>
        {el}
        {inline.length ? <div className={st.inlineNotes}>{inline.map((m) => note(m, true))}</div> : null}
      </div>
    );
  };

  return (
    <div className={st.wrap} data-surface={surface} data-mode={mode}>
      <div className={st.stack} data-stack={stack || undefined}>
        <article className={st.sheet} aria-label={ariaLabel ?? title?.part.text}>
          <header className={st.head}>
            <div>
              {title ? <h2 className={st.title}>{renderPart(title.part)}</h2> : null}
              {sub ? <p className={st.sub}>{renderPart(sub.part)}</p> : null}
            </div>
            {aiTag ? (
              <span className={st.aiTag}>
                <i aria-hidden="true" />
                {s.draftedByAi}
              </span>
            ) : null}
          </header>
          <div className={st.cols} data-review={review || undefined}>
            <div
              ref={(el) => {
                textRef.current = el;
                bodyRef.current = el;
              }}
              className={st.text}
              tabIndex={review ? undefined : 0}
              role={review ? undefined : 'group'}
              aria-describedby={review ? undefined : hintId}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onContextMenu={(e) => !review && e.preventDefault()}
              onKeyDown={onKeyDown}
              onBlur={() => {
                setCursor(null);
                setAnchor(null);
              }}
            >
              {bodyBlocks.map(renderBlock)}
            </div>
            {review ? (
              <div className={st.margin} style={{ minHeight: minH }}>
                {sortedMarks.map((m) => note(m, false))}
              </div>
            ) : null}
          </div>
          {!review ? (
            <p id={hintId} className="sr-only">
              {s.highlightHint}. {s.highlightKeys}
            </p>
          ) : null}
          {footer ? <div className={st.foot}>{footer}</div> : null}
        </article>
      </div>
    </div>
  );
}
