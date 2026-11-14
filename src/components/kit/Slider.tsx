'use client';

import { useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import st from './controls.module.css';

export interface SliderProps {
  value: number;
  onChange: (v: number) => void;
  /** Fired once when a drag or key press settles. */
  onCommit?: (v: number) => void;
  onDragChange?: (dragging: boolean) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  /** Text for the bubble and aria-valuetext, for example «18% · 7.2 h». */
  format?: (v: number) => string;
  disabled?: boolean;
  className?: string;
}

export function Slider({ value, onChange, onCommit, onDragChange, min = 0, max = 100, step = 1, label, format, disabled, className }: SliderProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);
  const clamp = (v: number) => Math.min(max, Math.max(min, Math.round(v / step) * step));
  const pct = ((value - min) / (max - min)) * 100;
  const text = format ? format(value) : String(value);

  const fromPointer = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return clamp(min + ((clientX - r.left) / r.width) * (max - min));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ref.current?.focus();
    setDragging(true);
    onDragChange?.(true);
    onChange(fromPointer(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return;
    const v = fromPointer(e.clientX);
    if (v !== value) onChange(v);
  };
  const end = () => {
    if (!dragging) return;
    setDragging(false);
    onDragChange?.(false);
    onCommit?.(value);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = Math.max(step, (max - min) / 10);
    const map: Record<string, number> = {
      ArrowRight: value + step,
      ArrowUp: value + step,
      ArrowLeft: value - step,
      ArrowDown: value - step,
      PageUp: value + big,
      PageDown: value - big,
      Home: min,
      End: max,
    };
    if (!(e.key in map)) return;
    e.preventDefault();
    const v = clamp(map[e.key]);
    if (v !== value) {
      onChange(v);
      onCommit?.(v);
    }
  };

  return (
    <div
      ref={ref}
      className={`${st.slider} ${className ?? ''}`}
      style={{ '--pct': `${pct}%` } as CSSProperties}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={text}
      aria-disabled={disabled || undefined}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={onKeyDown}
    >
      <div className={st.track}>
        <div className={st.range} />
      </div>
      <div className={st.thumb} />
      <div className={st.bubble} aria-hidden="true">
        {text}
      </div>
    </div>
  );
}
