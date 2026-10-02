import { normalizedPower } from '../domain/metrics';
import type { StreamSample } from './streams';

/**
 * Deterministic synthetic power traces for demo/seed rides.
 *
 * Why this exists: NP/IF/TSS must be *computed from a power trace* (ARCHITECTURE.md §5.1).
 * Before this module the seeder invented `np` and back-derived IF/TSS from it, which made
 * every training-load number on the dashboard fictional.
 *
 * Every value derives from a seeded LCG keyed on the activity id, so regenerating a ride
 * always yields the identical trace — no flakiness, no drift between sessions.
 */

/** Sampling period of synthetic traces, in seconds (5 s ≈ 12k samples for a 16 h ride). */
export const SYNTH_SAMPLE_SEC = 5;

/**
 * Version of the generator that produced a stored synthetic trace.
 * Bump whenever the shape model changes (e.g. v2 moved from flat power to W′ dynamics),
 * so demo rides are regenerated instead of keeping stale physiology. Only rows written by
 * this generator carry it, so genuine rider streams are never touched.
 */
export const SYNTH_VERSION = 3;

function lcg(seedText: string): () => number {
  let seed = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    seed ^= seedText.charCodeAt(i);
    seed = Math.imul(seed, 16777619);
  }
  return () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
}

export interface SynthInput {
  id: string;
  name: string;
  /** moving seconds */
  movingSec: number;
  /** target Normalized Power in watts */
  targetNp: number;
}

/** Reference physiology for the generator: critical power and the finite W′ pool. */
const SYNTH_CP = 275; // W
const SYNTH_W_PRIME = 20000; // J
const SYNTH_BOOST = 2.8; // how far above CP a fresh rider can spike

/**
 * Build a plausible power trace whose NP lands on `targetNp`.
 *
 * Two passes, because guessing the mean power is unreliable: the shape is generated
 * first, then the whole trace is scaled so its NP matches the target. NP is homogeneous
 * of degree 1, so scaling the trace scales NP by the same factor exactly.
 *
 * The shape follows critical-power dynamics rather than a flat rectangle: power above
 * CP is drawn from the finite W′ pool and drains it, power below CP refills it. That is
 * what makes a synthetic ride produce a *hyperbolic* mean-max curve, so the CP/W′ fit
 * recovers a physiologically sensible answer instead of fitting a step function.
 * Interval sessions add work/rest blocks on top, which keeps their NP above their mean.
 */
export function synthPowerTrace(input: SynthInput): StreamSample[] {
  const rand = lcg(input.id);
  const samples = Math.max(1, Math.round(input.movingSec / SYNTH_SAMPLE_SEC));
  const isIntervals = /interval|threshold|vo2/i.test(input.name);
  const isCommute = /commute/i.test(input.name);
  const noiseAmp = isIntervals ? 0.05 : isCommute ? 0.14 : 0.1;
  const dt = SYNTH_SAMPLE_SEC;

  const shape: number[] = [];
  // start nearly fresh so the opening spike is the rider's true ceiling; rides differ in
  // how much of the pool they actually spend
  let wPrime = SYNTH_W_PRIME * (0.85 + 0.15 * rand());

  for (let i = 0; i < samples; i++) {
    const p = i / (samples - 1 || 1);

    // short roll-out 3%, long cool-down 6% taper
    let envelope = 1;
    if (p < 0.03) envelope = 0.82 + (p / 0.03) * 0.18;
    else if (p > 0.94) envelope = 1 - ((p - 0.94) / 0.06) * 0.35;

    let factor: number;
    if (isIntervals) {
      // ~4 min on / 2 min off — high contrast on purpose
      const block = Math.floor(i / (240 / SYNTH_SAMPLE_SEC)) % 2;
      factor = block === 0 ? 1.45 : 0.5;
    } else {
      // correlated drift + light noise: looks like an effort, not white noise
      factor = 1 + noiseAmp * Math.sin((i / samples) * Math.PI * 6) + (rand() - 0.5) * noiseAmp;
    }

    // aerobic decoupling: the longer the effort, the more the ceiling creeps down
    const fatigue = 1 - 0.05 * p;

    // W′-limited ceiling: how far above CP this athlete can go right now
    const ceiling = SYNTH_CP * (1 + SYNTH_BOOST * (wPrime / SYNTH_W_PRIME));
    const watts = Math.max(0, ceiling * envelope * factor * fatigue);
    shape.push(watts);

    // W′ dynamics: work above CP drains the pool, easy riding refills it at ~35%
    const net = (watts - SYNTH_CP) * dt;
    wPrime = net > 0 ? Math.max(0, wPrime - net) : Math.min(SYNTH_W_PRIME, wPrime - net * 0.35);
  }

  // Scale so NP === targetNp (a zero/flat shape has no NP to scale against).
  // The interval must match the emitted trace, or the 30 s window covers a
  // different span than the one readers will score.
  const unitNp = normalizedPower(shape, SYNTH_SAMPLE_SEC);
  const scale = unitNp > 0 && input.targetNp > 0 ? input.targetNp / unitNp : 0;

  const out: StreamSample[] = [];
  let t = 0;
  for (let i = 0; i < samples; i++) {
    const watts = Math.round(shape[i] * scale);
    out.push({
      t,
      watts,
      hr: Math.round(118 + watts * 0.19 + (rand() - 0.5) * 4),
      cad: 88 + Math.round(watts * 0.05)
    });
    t += SYNTH_SAMPLE_SEC * 1000;
  }

  return out;
}