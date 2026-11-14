'use client';

import { FileCheck2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { useKit } from './strings';
import st from './controls.module.css';

export type DropState = 'idle' | 'active' | 'reading' | 'error' | 'done';

export interface DropzoneProps {
  onFile: (file: File) => void;
  /** Screen-owned phase after a file is chosen; `active` is handled here while dragging. */
  state?: Exclude<DropState, 'active'>;
  fileName?: string;
  /** Error text from the failed step; defaults to a generic read failure. */
  error?: string;
  accept?: string;
  /** Force the drag-over look (gallery). */
  forceActive?: boolean;
}

export function Dropzone({ onFile, state = 'idle', fileName = '', error, accept = '.pdf,.docx,.txt', forceActive }: DropzoneProps) {
  const { s } = useKit();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const depth = useRef(0);
  const shown: DropState = (over || forceActive) && (state === 'idle' || state === 'error') ? 'active' : state;
  const canPick = shown === 'idle' || shown === 'active' || shown === 'error';

  return (
    <div
      className={st.drop}
      data-state={shown}
      role={canPick ? 'button' : undefined}
      tabIndex={canPick ? 0 : undefined}
      aria-label={canPick ? `${s.dropTitle}. ${s.dropHint}` : undefined}
      aria-live="polite"
      onClick={() => canPick && input.current?.click()}
      onKeyDown={(e) => {
        if (canPick && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          input.current?.click();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const f = e.dataTransfer.files?.[0];
        if (f) onFile(f);
      }}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.target.value = '';
        }}
      />
      {shown === 'done' ? (
        <FileCheck2 size={40} strokeWidth={1.5} color="var(--violet)" aria-hidden="true" />
      ) : (
        <div className={st.dropArt} aria-hidden="true">
          <span className={st.dropSheet} />
          <span className={st.dropSheet}>
            <i style={{ top: 16, background: 'var(--violet-tint)', right: 30 }} />
            <i style={{ top: 30 }} />
            <i style={{ top: 42 }} />
            <i style={{ top: 54, right: 26 }} />
            <i style={{ top: 66 }} />
          </span>
        </div>
      )}
      {shown === 'idle' ? (
        <>
          <div className={st.dropTitle}>{s.dropTitle}</div>
          <div className={st.dropHint}>{s.dropHint}</div>
        </>
      ) : null}
      {shown === 'active' ? <div className={st.dropTitle}>{s.dropActive}</div> : null}
      {shown === 'reading' ? (
        <>
          <div className={st.dropTitle}>{s.dropReading(fileName)}</div>
          <div className={st.dropBar} aria-hidden="true" />
        </>
      ) : null}
      {shown === 'done' ? <div className={st.dropTitle}>{s.dropDone(fileName)}</div> : null}
      {shown === 'error' ? (
        <>
          <div className={st.dropTitle} style={{ color: 'var(--error)' }}>
            {error ?? s.dropError}
          </div>
          <span className={st.dropRetry}>{s.dropRetry}</span>
        </>
      ) : null}
    </div>
  );
}
