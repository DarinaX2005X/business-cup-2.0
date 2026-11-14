'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useKit } from './strings';
import type { Surface } from './types';
import st from './controls.module.css';

export interface ComboItem {
  value: string;
  label: string;
  /** The title or alias the query actually matched, shown as «matched: RN» under the label. */
  matched?: string;
  /** Free second line used when there is no `matched` (for example «closest match»). */
  hint?: string;
}

export interface ComboboxProps {
  label: string;
  labelHidden?: boolean;
  query: string;
  onQueryChange: (q: string) => void;
  items: ComboItem[];
  onPick: (item: ComboItem) => void;
  placeholder?: string;
  surface?: Surface;
  size?: 'md' | 'lg';
  /** Start with the list open (gallery, tests). */
  defaultOpen?: boolean;
  loading?: boolean;
  emptyText?: string;
  trailing?: ReactNode;
  help?: string;
  error?: string;
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Wraps the part of `text` that matches `query` (accent and case insensitive) in <mark>. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const q = fold(query.trim());
  if (!q) return <>{text}</>;
  const i = fold(text).indexOf(q);
  if (i < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, i)}
      <mark>{text.slice(i, i + q.length)}</mark>
      {text.slice(i + q.length)}
    </>
  );
}

export function Combobox({
  label,
  labelHidden,
  query,
  onQueryChange,
  items,
  onPick,
  placeholder,
  surface = 'paper',
  size = 'md',
  defaultOpen = false,
  loading,
  emptyText,
  trailing,
  help,
  error,
}: ComboboxProps) {
  const { s } = useKit();
  const id = useId();
  const listId = `${id}-list`;
  const [open, setOpen] = useState(defaultOpen);
  const [active, setActive] = useState(-1);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    // keep the active option visible inside the list without scrolling the page
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    if (!list || !el) return;
    if (el.offsetTop < list.scrollTop) list.scrollTop = el.offsetTop - 6;
    else if (el.offsetTop + el.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = el.offsetTop + el.offsetHeight - list.clientHeight + 6;
  }, [active]);

  // New items (an async search answering) can leave the highlight past the end of the list.
  const current = active < items.length ? active : -1;
  const showList = open && query.trim().length > 0;
  const pick = (item: ComboItem) => {
    onPick(item);
    setOpen(false);
  };

  return (
    <div className={st.field} data-surface={surface === 'violet' ? 'field' : undefined}>
      <label htmlFor={id} className={labelHidden ? 'sr-only' : st.fLabel}>
        {label}
      </label>
      <div className={st.fRow}>
        <div className={st.combo}>
          <input
            id={id}
            className={`${st.input} ${size === 'lg' ? st.inputLg : ''}`}
            role="combobox"
            aria-expanded={showList}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={showList && items[current] ? `${id}-o${current}` : undefined}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive((a) => (a < 0 || a >= items.length ? 0 : Math.min(items.length - 1, a + 1)));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => (a < 0 || a >= items.length ? items.length - 1 : Math.max(0, a - 1)));
              } else if (e.key === 'Enter' && showList && items.length) {
                // Enter with nothing highlighted takes the first option, as people expect from a search field.
                e.preventDefault();
                pick(items[current >= 0 ? current : 0]);
              } else if (e.key === 'Escape') {
                if (showList) {
                  e.preventDefault();
                  setOpen(false);
                } else onQueryChange('');
              }
            }}
          />
          {showList ? (
            <ul ref={listRef} id={listId} role="listbox" className={st.list} aria-label={label} aria-busy={loading || undefined}>
              {items.length === 0 ? (
                <li className={st.empty} role="presentation">
                  {loading ? '…' : (emptyText ?? s.noMatches)}
                </li>
              ) : (
                items.map((it, i) => (
                  <li
                    key={it.value}
                    id={`${id}-o${i}`}
                    data-index={i}
                    role="option"
                    aria-selected={i === current}
                    className={st.opt}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(it)}
                  >
                    <span className={st.optL}>
                      <Highlight text={it.label} query={query} />
                    </span>
                    {it.matched ? <span className={st.optH}>{s.matched(it.matched)}</span> : it.hint ? <span className={st.optH}>{it.hint}</span> : null}
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
        {trailing}
      </div>
      {error ? <p className={st.fError}>{error}</p> : help ? <p className={st.fHelp}>{help}</p> : null}
    </div>
  );
}
