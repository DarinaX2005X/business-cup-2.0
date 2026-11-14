'use client';

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
  onSelect?: (id: string) => void;
  onShareChange?: (id: string, share: number) => void;
  onShareCommit?: (id: string, share: number) => void;
  onDragChange?: (dragging: boolean) => void;
  surface?: Surface;
  totalHours?: number;
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
  onSelect,
  onShareChange,
  onShareCommit,
  onDragChange,
  surface = 'paper',
  totalHours = 40,
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
    >
      {onSelect && !disabled ? (
        <button type="button" className={st.hit} aria-pressed={!!selected} aria-label={text} onClick={() => onSelect(id)} />
      ) : null}
      <CategorySwatch category={category} />
      <div className={st.main}>
        <p className={st.text} title={useShort ? text : undefined}>
          {title}
        </p>
        <div className={st.meta}>
          <CategoryChip category={category} surface={surface} />
          <EvidenceBadge level={evidence.evidenceLevel} surface={surface} size="sm" />
        </div>
      </div>
      <div className={st.amount}>
        <b>{s.hoursShort(hours(h))}</b>
        <span>{num(share)}%</span>
      </div>
      {editing ? (
        <div className={st.edit}>
          <Slider
            label={`${s.share}: ${title}`}
            value={share}
            min={1}
            max={80}
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
