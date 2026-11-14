'use client';

/*
 * A small synthesized sound family (felt, paper, glockenspiel). No audio files.
 * Silent until the first user gesture and while the tab is hidden, master gain 0.25,
 * at most two voices, ±3 % pitch per play, fast repeats rate-limited.
 * Every sound is paired with a visual beat by its caller; the product works muted.
 */

export type SoundName = 'place' | 'found' | 'points' | 'redeem' | 'tap';

const STORAGE_KEY = 'irr:sound';
const MASTER = 0.25;
const MAX_VOICES = 2;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let unlocked = false;
let enabled = true;
let voices = 0;
const lastPlay = new Map<SoundName, number>();
const listeners = new Set<(on: boolean) => void>();

function readPref() {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === '0') enabled = false;
  } catch {
    /* storage blocked: keep default */
  }
}

function ensureCtx() {
  if (ctx || typeof window === 'undefined') return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = MASTER;
  master.connect(ctx.destination);
  return ctx;
}

function unlock() {
  if (unlocked) return;
  unlocked = true;
  const c = ensureCtx();
  if (c && c.state === 'suspended') void c.resume();
}

if (typeof window !== 'undefined') {
  readPref();
  const once = () => {
    unlock();
    window.removeEventListener('pointerdown', once, true);
    window.removeEventListener('keydown', once, true);
  };
  window.addEventListener('pointerdown', once, true);
  window.addEventListener('keydown', once, true);
}

const jitter = () => 1 + (Math.random() * 2 - 1) * 0.03;

function env(g: GainNode, t: number, peak: number, attack: number, decay: number) {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(c: AudioContext, out: AudioNode, t: number, freq: number, type: OscillatorType, peak: number, attack: number, decay: number) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  env(g, t, peak, attack, decay);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + attack + decay + 0.05);
}

function noise(c: AudioContext, out: AudioNode, t: number, dur: number, filter: BiquadFilterType, f0: number, f1: number, peak: number, q = 1) {
  const len = Math.ceil(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = c.createBufferSource();
  src.buffer = buf;
  const bq = c.createBiquadFilter();
  bq.type = filter;
  bq.Q.value = q;
  bq.frequency.setValueAtTime(f0, t);
  bq.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = c.createGain();
  env(g, t, peak, 0.004, dur);
  src.connect(bq).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur + 0.05);
}

const recipes: Record<SoundName, (c: AudioContext, out: AudioNode, t: number, p: number) => number> = {
  // a tile settling on felt: soft low thump with a paper brush
  place: (c, out, t, p) => {
    tone(c, out, t, 180 * p, 'sine', 0.5, 0.004, 0.12);
    noise(c, out, t, 0.06, 'lowpass', 1800, 500, 0.18);
    return 0.2;
  },
  // a caught mistake: one soft glockenspiel tick
  found: (c, out, t, p) => {
    tone(c, out, t, 1318 * p, 'sine', 0.32, 0.003, 0.35);
    tone(c, out, t, 2636 * p, 'sine', 0.06, 0.003, 0.18);
    return 0.4;
  },
  // quiet coins: three small rising bells
  points: (c, out, t, p) => {
    [1568, 1976, 2349].forEach((f, i) => tone(c, out, t + i * 0.07, f * p, 'triangle', 0.16, 0.003, 0.22));
    return 0.45;
  },
  // a voucher tearing along its line, then a chime
  redeem: (c, out, t, p) => {
    noise(c, out, t, 0.22, 'bandpass', 2500, 5200, 0.35, 2.5);
    tone(c, out, t + 0.22, 1046 * p, 'sine', 0.22, 0.004, 0.5);
    tone(c, out, t + 0.3, 1568 * p, 'sine', 0.14, 0.004, 0.5);
    return 0.85;
  },
  tap: (c, out, t, p) => {
    tone(c, out, t, 660 * p, 'sine', 0.12, 0.002, 0.05);
    return 0.08;
  },
};

export const sound = {
  play(name: SoundName) {
    if (!enabled || !unlocked || typeof document === 'undefined' || document.hidden) return;
    const now = performance.now();
    if (now - (lastPlay.get(name) ?? 0) < 34) return; // ~30 per second at most
    lastPlay.set(name, now);
    if (voices >= MAX_VOICES) return;
    const c = ensureCtx();
    if (!c || !master) return;
    voices++;
    const dur = recipes[name](c, master, c.currentTime + 0.005, jitter());
    window.setTimeout(() => {
      voices = Math.max(0, voices - 1);
    }, dur * 1000);
  },
  isEnabled: () => enabled,
  setEnabled(on: boolean) {
    enabled = on;
    try {
      window.localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
    } catch {
      /* ignore */
    }
    if (on) unlock();
    listeners.forEach((l) => l(on));
  },
  subscribe(fn: (on: boolean) => void) {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
};
