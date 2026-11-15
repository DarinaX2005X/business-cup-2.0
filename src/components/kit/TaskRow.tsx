'use client';

import type { ReactNode } from 'react';
import { CategoryChip, CategorySwatch, EvidenceBadge, EvidenceMeter } from './Evidence';
import { Slider } from './Slider';
import { useKit } from './strings';
import type { Category, Surface, TaskEvidence } from './types';
import { hoursOf } from './week';
import st from './taskrow.module.css';

export interface TaskRowProps {
  id: string;
  /** Full O*NET text, clamped to three lines. */
  text: string;
  /** Short label; when `useShort` the row shows it and the full text goes to the inspector. */
  short?: string;
  useShort?: boolean;
  share: number;
  category: Category;
  evidence: Pick<TaskEvidence, 'observed' | 'aeiShare' | 'aeiAutomation' | 'theoryLabel' | 'evidenceLevel'>;
  selected?: boolean;
  editing?: boolean;
  disabled?: boolean;
  /** Why the share cannot be changed right now. */
  disabledReason?: string;
  showMeter?: boolean;
  /** The «Research estimate» / «Seen in AI use» badge under the task (the map keeps it in its inspector). */
  showEvidence?: boolean;
  onSelect?: (id: string) => void;
  onShareChange?: (id: string, share: number) => void;
  onShareCommit?: (id: string, share: number) => void;
  onDragChange?: (dragging: boolean) => void;
  surface?: Surface;
  totalHours?: number;
  /**
   * Hide the category swatch, chip and evidence badge (the week editor in /start: people set their
   * hours before they see which part of the week AI touches).
   */
  hideCategory?: boolean;
  /** Extra lines under the text, for example the full task and a quote from the résumé. */
  details?: ReactNode;
  /** Controls after the hours, for example «Remove». */
  actions?: ReactNode;
  /** Top of the share slider (default 80). */
  sliderMax?: number;
  /** The slider got or lost focus (keyboard or pointer): lets the screen fix the week a gesture starts from. */
  onEditFocus?: (id: string, focused: boolean) => void;
}

export function TaskRow({
  id,
  text,
  short,
  useShort,
  share,
  category,
  evidence,
  selected,
  editing,
  disabled,
  disabledReason,
  showMeter = true,
  showEvidence = true,
  onSelect,
  onShareChange,
  onShareCommit,
  onDragChange,
  surface = 'paper',
  totalHours = 40,
  hideCategory,
  details,
  actions,
  sliderMax = 80,
  onEditFocus,
}: TaskRowProps) {
  const { s, hours, num } = useKit();
  const h = hoursOf(share, totalHours);
  const title = useShort && short ? short : text;
  return (
    <div
      className={st.row}
      data-selected={selected || undefined}
      data-editing={editing || undefined}
      data-disabled={disabled || undefined}
      data-surface={surface}
      data-plain={hideCategory || undefined}
      data-actions={actions ? true : undefined}
    >
      {onSelect && !disabled ? (
        <button type="button" className={st.hit} aria-pressed={!!selected} aria-label={text} onClick={() => onSelect(id)} />
      ) : null}
      {hideCategory ? null : <CategorySwatch category={category} />}
      <div className={st.main}>
        <p className={st.text} title={useShort ? text : undefined}>
          {title}
        </p>
        {hideCategory ? null : (
          <div className={st.meta}>
            <CategoryChip category={category} surface={surface} />
            {showEvidence ? <EvidenceBadge level={evidence.evidenceLevel} surface={surface} size="sm" /> : null}
          </div>
        )}
        {details ? <div className={st.details}>{details}</div> : null}
      </div>
      <div className={st.amount}>
        <b>{s.hoursShort(hours(h))}</b>
        <span>{num(share)}%</span>
      </div>
      {actions ? <div className={st.actions}>{actions}</div> : null}
      {editing ? (
        <div
          className={st.edit}
          onFocusCapture={onEditFocus ? () => onEditFocus(id, true) : undefined}
          onBlurCapture={onEditFocus ? () => onEditFocus(id, false) : undefined}
        >
          <Slider
            label={`${s.share}: ${title}`}
            value={share}
            min={1}
            max={sliderMax}
            disabled={disabled}
            format={(v) => `${num(v)}% · ${s.hoursShort(hours(hoursOf(v, totalHours)))}`}
            onChange={(v) => onShareChange?.(id, v)}
            onCommit={(v) => onShareCommit?.(id, v)}
            onDragChange={onDragChange}
          />
          {disabled && disabledReason ? <p className={st.reason}>{disabledReason}</p> : null}
        </div>
      ) : null}
      {showMeter && selected ? (
        <div className={st.meterRow}>
          <EvidenceMeter evidence={evidence} surface={surface} compact />
        </div>
      ) : null}
    </div>
  );
}
