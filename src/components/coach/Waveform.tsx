'use client';

import { useEffect, useRef } from 'react';
import st from './coach.module.css';

const BARS = 56;

/**
 * The live waveform while the person holds the mic: one bar per ~80 ms of loudness from the microphone's
 * AnalyserNode, newest on the right, drawn in the apricot of the human part.
 */
export function LiveWaveform({ analyser }: { analyser: AnalyserNode | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !analyser) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const data = new Uint8Array(analyser.fftSize);
    const levels: number[] = new Array(BARS).fill(0);
    let raf = 0;
    let last = 0;
    const color = getComputedStyle(canvas).getPropertyValue('--wave') || '#f5a15e';
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      if (t - last > 80) {
        last = t;
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
          const v = (data[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        levels.push(Math.min(1, rms * 4.5));
        levels.shift();
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const gap = 3;
      const bw = Math.max(2, (w - gap * (BARS - 1)) / BARS);
      ctx.fillStyle = color.trim();
      levels.forEach((lv, i) => {
        const bh = Math.max(3, lv * (h - 4));
        const x = i * (bw + gap);
        const y = (h - bh) / 2;
        ctx.globalAlpha = 0.35 + 0.65 * (i / BARS);
        ctx.beginPath();
        ctx.roundRect(x, y, bw, bh, bw / 2);
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [analyser]);
  return <canvas ref={ref} className={st.liveWave} aria-hidden="true" />;
}

/** The small fixed waveform on a sent voice message, from the recording's own loudness. */
export function VoiceGlyph({ peaks, seconds }: { peaks?: number[]; seconds?: number }) {
  const bars = peaks?.length ? peaks : new Array(20).fill(0.35);
  return (
    <span className={st.voiceGlyph} aria-hidden="true">
      <span className={st.voiceBars}>
        {bars.map((p, i) => (
          <i key={i} style={{ height: `${Math.round(18 + p * 82)}%` }} />
        ))}
      </span>
      {typeof seconds === 'number' ? <span className={st.voiceTime}>{clock(seconds)}</span> : null}
    </span>
  );
}

export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
