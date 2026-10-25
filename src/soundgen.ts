/**
 * Procedural sound waveforms (no audio files). Every generator returns mono samples at RATE;
 * Sounds (src/sound.ts) turns them into Web Audio buffers. Loops are built to join seamlessly.
 */
import { Rng } from './rng';

export const RATE = 22050;
const TAU = 2 * Math.PI;

/** One second of a 1 Hz sine, so whole-Hz tones can be looked up by integer index. */
const SIN = new Float32Array(RATE).map((_, j) => Math.sin((TAU * j) / RATE));
const sin1 = (hz: number, i: number): number => SIN[(hz * i) % RATE];

const noise = (rng: Rng): number => rng.uniform(-1, 1);

/** Scale a waveform so its loudest sample is exactly 1. */
export function normalize(samples: Float32Array): Float32Array {
  let peak = 1e-9;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return samples.map((s) => Math.max(-1, Math.min(1, s / peak)));
}

/** Cross-fade the last `tail` samples into the first so the loop has no click. */
function loopJoin(out: Float32Array, n: number, tail: number): Float32Array {
  for (let i = 0; i < tail; i++) {
    const k = i / tail;
    out[i] = out[i] * k + out[n + i] * (1 - k);
  }
  return out.slice(0, n);
}

export function makeBoom(rng: Rng, seconds = 3.0): Float32Array {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  let low = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    low += (noise(rng) - low) * (0.02 + 0.10 * Math.exp(-t * 2.0)); // darkening noise
    const rumble = low * Math.exp(-t / 0.9) * 5.0;
    const thump = Math.sin(TAU * (28 * t + (38 * (1 - Math.exp(-t * 3))) / 3)) * Math.exp(-t / 0.7);
    const crack = noise(rng) * Math.exp(-t / 0.035) * 1.4;
    out[i] = rumble + thump * 1.2 + crack;
  }
  const fade = Math.floor(RATE * 0.25);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}

export function makeFire(rng: Rng, seconds = 3.0): Float32Array {
  const n = Math.floor(RATE * seconds), tail = Math.floor(RATE * 0.2);
  const out = new Float32Array(n + tail);
  const pops: [number, number, number][] = []; // start sample, length, amplitude
  for (let i = 0; i < n + tail; i++) {
    if (rng.random() < 0.0009) pops.push([i, rng.randint(80, 500), rng.uniform(0.3, 1.0)]);
  }
  let low = 0, rumble = 0;
  for (let i = 0; i < n + tail; i++) {
    low += (noise(rng) - low) * 0.25;
    rumble += (noise(rng) - rumble) * 0.015;
    out[i] = low * 0.18 + rumble * 4.0 * (0.8 + 0.2 * Math.sin((i / RATE) * 7.0));
  }
  for (const [start, length, amp] of pops) {
    for (let k = 0; k < Math.min(length, n + tail - start); k++) out[start + k] += noise(rng) * amp * (1 - k / length) ** 2;
  }
  return loopJoin(out, n, tail);
}

/** Afterburner roar: broadband rushing noise with a deep rumble and a slight flutter. */
export function makeJet(rng: Rng, seconds = 2.0): Float32Array {
  const n = Math.floor(RATE * seconds), tail = Math.floor(RATE * 0.2);
  const out = new Float32Array(n + tail);
  let hiss = 0, mid = 0, rumble = 0;
  for (let i = 0; i < n + tail; i++) {
    const t = i / RATE;
    const white = noise(rng);
    hiss += (white - hiss) * 0.55;
    mid += (white - mid) * 0.12;
    rumble += (white - rumble) * 0.02;
    const flutter = 1 + 0.18 * Math.sin(TAU * 37 * t) + 0.12 * Math.sin(TAU * 11 * t + 1.3);
    out[i] = (hiss * 0.45 + mid * 1.3 + rumble * 5.5) * flutter;
  }
  return loopJoin(out, n, tail);
}

/** Heavy mechanical clunk: a falling low thump plus a short metallic click. */
export function makeThunk(rng: Rng, seconds = 0.45): Float32Array {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const thump = Math.sin(TAU * (95 * t - 90 * t * t)) * Math.exp(-t / 0.09);
    const click = noise(rng) * Math.exp(-t / 0.008) * 0.9;
    const ring = Math.sin(TAU * 420 * t) * Math.exp(-t / 0.05) * 0.25;
    out[i] = thump + click + ring;
  }
  return out;
}

/** A wing tearing off: a sharp crack and a rattle of falling parts. */
export function makeSnap(rng: Rng, seconds = 0.8): Float32Array {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  let hiss = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    hiss += (noise(rng) - hiss) * 0.4;
    const crack = noise(rng) * Math.exp(-t / 0.02) * 1.5;
    const rattle = hiss * Math.exp(-t / 0.3) * (Math.floor(i / 400) % 3 ? 0.6 : 0.2);
    out[i] = crack + rattle;
  }
  return out;
}

/** A plane hitting water: a heavy slap, a rush of spray and bubbling. */
export function makeSplash(rng: Rng, seconds = 1.8): Float32Array {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  let a = 0, b = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    const w = noise(rng);
    a += (w - a) * 0.25;
    b += (w - b) * 0.04;
    const slap = Math.sin(TAU * (60 * t - 35 * t * t)) * Math.exp(-t / 0.1) * 1.4;
    const rush = (a * 0.6 + b * 3.0) * Math.exp(-t / 0.55) * Math.min(1, t / 0.02);
    const bubble = b * 2.0 * (Math.floor(i / 700) % 2 ? 1.0 : 0.3) * Math.exp(-t / 0.9);
    out[i] = slap + rush + bubble;
  }
  const fade = Math.floor(RATE * 0.2);
  for (let i = 0; i < fade; i++) out[n - 1 - i] *= i / fade;
  return out;
}

/** Gear in motion: a low mechanical grind with pump pulses, no tonal whine (loops seamlessly). */
export function makeGearMotor(rng: Rng, seconds = 1.0): Float32Array {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  let low = 0, mid = 0;
  for (let i = 0; i < n; i++) {
    const w = noise(rng);
    low += (w - low) * 0.03;
    mid += (w - mid) * 0.15;
    const pulse = 1 + 0.5 * sin1(14, i);
    out[i] = (low * 4.0 + mid * 0.6) * pulse;
  }
  const tail = 200; // tiny fade so the loop joins without a click
  for (let i = 0; i < tail; i++) {
    out[i] *= i / tail;
    out[n - 1 - i] *= i / tail;
  }
  return out;
}

/** Tyres rumbling along tarmac: low noise with regular bumps (runway joints). */
export function makeRoll(rng: Rng, seconds = 1.0): Float32Array {
  const n = Math.floor(RATE * seconds), tail = Math.floor(RATE * 0.1);
  const out = new Float32Array(n + tail);
  let a = 0, b = 0;
  for (let i = 0; i < n + tail; i++) {
    const w = noise(rng);
    a += (w - a) * 0.08;
    b += (w - b) * 0.6;
    out[i] = a * 3.0 + b * 0.4;
  }
  const joined = loopJoin(out, n, tail);
  for (let i = 0; i < n; i++) joined[i] += 0.5 * Math.max(0, sin1(9, i)) ** 6;
  return joined;
}

/** Wheels meeting the runway: a thump and a short burst of tyre noise. */
export function makeTouchdown(rng: Rng, seconds = 0.9): Float32Array {
  const n = Math.floor(RATE * seconds);
  const out = new Float32Array(n);
  let hiss = 0;
  for (let i = 0; i < n; i++) {
    const t = i / RATE;
    hiss += (noise(rng) - hiss) * 0.3;
    const thump = Math.sin(TAU * (70 * t - 60 * t * t)) * Math.exp(-t / 0.12) * 1.3;
    const chirp = hiss * 0.8 * Math.exp(-t / 0.22) * Math.min(1, t / 0.01);
    out[i] = thump + chirp * 0.7;
  }
  return out;
}

export type EngineKind = 'piston' | 'turbine';

export interface PistonLayer {
  f: number;
  harm: number[];
  noise: number;
  trem: [number, number];
}

export interface TurbineLayer {
  whine: number;
  hiss: number;
  rumble: number;
}

export interface EngineProfile {
  kind: EngineKind;
  gain: number;
  layers: (PistonLayer | TurbineLayer)[];
}

/**
 * Engine sound profiles: three looped layers (idle / cruise / full power) are cross-faded by
 * throttle. "piston": harmonics of a firing frequency (Hz); "turbine": rushing noise (a whine
 * tone can be added with `whine` in Hz, but every profile currently has it off).
 */
export const ENGINES: Record<string, EngineProfile> = {
  prop: {
    kind: 'piston', gain: 0.30, layers: [
      { f: 30, harm: [1.0, 0.7, 0.5, 0.35, 0.2], noise: 0.10, trem: [7, 0.15] },
      { f: 52, harm: [1.0, 0.75, 0.55, 0.4, 0.25], noise: 0.14, trem: [7, 0.10] },
      { f: 84, harm: [1.0, 0.8, 0.6, 0.45, 0.3], noise: 0.20, trem: [11, 0.08] }],
  },
  radial: {
    kind: 'piston', gain: 0.32, layers: [
      { f: 20, harm: [0.6, 1.0, 0.8, 0.5, 0.3], noise: 0.18, trem: [5, 0.35] },
      { f: 36, harm: [0.6, 1.0, 0.85, 0.55, 0.3], noise: 0.22, trem: [6, 0.25] },
      { f: 58, harm: [0.6, 1.0, 0.9, 0.6, 0.35], noise: 0.28, trem: [9, 0.18] }],
  },
  jet: {
    kind: 'turbine', gain: 0.26, layers: [
      { whine: 0, hiss: 0.15, rumble: 0.9 },
      { whine: 0, hiss: 0.35, rumble: 0.9 },
      { whine: 0, hiss: 0.7, rumble: 1.0 }],
  },
  airliner: {
    kind: 'turbine', gain: 0.24, layers: [
      { whine: 0, hiss: 0.10, rumble: 1.0 }, // no whine: just a deep rumble and rushing air
      { whine: 0, hiss: 0.22, rumble: 1.0 },
      { whine: 0, hiss: 0.38, rumble: 1.0 }],
  },
};
export const LAYER_GAIN = [0.6, 0.8, 1.0] as const;

/**
 * One seamless engine loop. Tones use whole-Hz frequencies over a whole-second loop, so they
 * join perfectly; the noise part is cross-faded at the seam.
 */
export function makeEngineLayer(rng: Rng, kind: EngineKind, params: PistonLayer | TurbineLayer, seconds = 1.0): Float32Array {
  const n = Math.floor(RATE * seconds), tail = Math.floor(RATE * 0.1);
  const hissy = new Float32Array(n + tail), rumbly = new Float32Array(n + tail);
  const [lp1, lp2] = kind === 'piston' ? [0.35, 0.02] : [0.5, 0.03];
  let a = 0, b = 0;
  for (let i = 0; i < n + tail; i++) {
    const w = noise(rng);
    a += (w - a) * lp1; // hissy part
    b += (w - b) * lp2; // rumbly part
    hissy[i] = a;
    rumbly[i] = b;
  }
  const hs = loopJoin(hissy, n, tail), rs = loopJoin(rumbly, n, tail);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    if (kind === 'piston') {
      const p = params as PistonLayer;
      const [tf, td] = p.trem;
      let tone = 0;
      p.harm.forEach((h, k) => { tone += h * sin1(p.f * (k + 1), i); });
      tone *= 1 + td * sin1(tf, i);
      out[i] = tone * 0.5 + hs[i] * p.noise * 1.5 + rs[i] * p.noise * 3;
    } else {
      const p = params as TurbineLayer;
      const tone = p.whine ? 0.22 * sin1(p.whine, i) + 0.09 * sin1(2 * p.whine, i) : 0;
      out[i] = tone + hs[i] * p.hiss + rs[i] * p.rumble * 4.0;
    }
  }
  return out;
}
