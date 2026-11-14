'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useKit } from './strings';
import type { Surface } from './types';
import st from './controls.module.css';

export interface ComboItem {
  value: string;
  label: string;
  /** Second line, for example the O*NET occupation a job title belongs to. */
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
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => setActive(0), [query, items.length]);

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

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
            aria-activedescendant={showList && items[active] ? `${id}-o${active}` : undefined}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            value={query}
            placeholder={placeholder}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setOpen(true);
                setActive((a) => Math.min(items.length - 1, a + 1));
              } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setActive((a) => Math.max(0, a - 1));
              } else if (e.key === 'Enter' && showList && items[active]) {
                e.preventDefault();
                pick(items[active]);
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
                    aria-selected={i === active}
                    className={st.opt}
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(it)}
                  >
                    <span className={st.optL}>
                      <Highlight text={it.label} query={query} />
                    </span>
                    {it.hint ? <span className={st.optH}>{it.hint}</span> : null}
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
