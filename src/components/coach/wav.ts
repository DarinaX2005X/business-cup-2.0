/**
 * Voice messages leave the browser as 16 kHz mono 16-bit PCM WAV: every speech model on OpenRouter reads
 * WAV, while what MediaRecorder writes differs by browser (WebM/Opus, Ogg, MP4/AAC). The recording is
 * decoded with Web Audio, mixed to mono, resampled and packed here. Pure functions, unit-tested.
 */

export const VOICE_RATE = 16_000;
export const VOICE_MAX_SECONDS = 60;

/** Mixes channels to one by averaging. */
export function mixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i] / channels.length;
  return out;
}

/** Box-filter resampling: averages the source samples that fall into each target sample. */
export function resample(input: Float32Array, fromRate: number, toRate = VOICE_RATE): Float32Array {
  if (fromRate === toRate) return input;
  const ratio = fromRate / toRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = sum / (end - start);
  }
  return out;
}

/** PCM WAV (format 1), one channel, 16 bits. */
export function encodeWav(samples: Float32Array, rate = VOICE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const write = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i);
  };
  write(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  write(8, 'WAVE');
  write(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}

export function toBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin);
}

/** Loudness of `n` equal slices (0..1), for the small waveform on a sent voice message. */
export function peaks(samples: Float32Array, n = 28): number[] {
  if (!samples.length) return new Array(n).fill(0);
  const size = Math.max(1, Math.floor(samples.length / n));
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const end = Math.min(samples.length, (i + 1) * size);
    for (let j = i * size; j < end; j++) sum += samples[j] * samples[j];
    out.push(Math.sqrt(sum / Math.max(1, end - i * size)));
  }
  const max = Math.max(...out, 0.02);
  return out.map((v) => Math.round((v / max) * 100) / 100);
}

export interface PreparedVoice {
  base64: string;
  seconds: number;
  peaks: number[];
}

/** Recorded audio of any browser format → WAV ready to send, cut at VOICE_MAX_SECONDS. */
export async function prepareVoice(blob: Blob): Promise<PreparedVoice> {
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i));
    let mono = resample(mixToMono(channels), decoded.sampleRate, VOICE_RATE);
    if (mono.length > VOICE_MAX_SECONDS * VOICE_RATE) mono = mono.subarray(0, VOICE_MAX_SECONDS * VOICE_RATE);
    return { base64: toBase64(encodeWav(mono, VOICE_RATE)), seconds: mono.length / VOICE_RATE, peaks: peaks(mono) };
  } finally {
    void ctx.close().catch(() => undefined);
  }
}
