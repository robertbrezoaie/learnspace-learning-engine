// Ported from learnspace-sim v1.0 (commit 05f70f7), tests/signals.test.ts. Only import paths changed.
// Test 4 (SIMULATION_SPEC.md section 14): signals.
import { describe, expect, it } from 'vitest';
import { SignalTracker, ewmaRate } from '../../src/core/signals.ts';
import { clip, type Observation } from '../../src/core/types.ts';
import { loadAlgorithmConfig } from '../support/simConfig.ts';
import { stream } from '../support/simRng.ts';
import { obs } from '../support/helpers.ts';

const cfg = loadAlgorithmConfig().signals;

/** Brute-force recomputation of b from the full list of observations (no prefix sums). */
function referenceB(history: Observation[]): number {
  const xs = history.filter((o) => !o.dontKnow).map((o) => Math.log(o.rtSeconds));
  const nRecent = Math.min(cfg.N_b, xs.length);
  const base = xs.slice(0, xs.length - nRecent);
  const recent = xs.slice(xs.length - nRecent);
  if (base.length < cfg.B_min) return 0;
  const mean = base.reduce((s, x) => s + x, 0) / base.length;
  const sd = Math.max(Math.sqrt(base.reduce((s, x) => s + (x - mean) ** 2, 0) / (base.length - 1)), cfg.rt_sd_floor);
  const z = recent.map((x) => (x - mean) / sd);
  return clip(-z.reduce((s, v) => s + v, 0) / z.length / 2, -1, 1);
}

/** Brute-force recomputation of e from the activity series. */
function referenceE(activity: number[]): number {
  let S = 1;
  let L = 1;
  for (const a of activity) {
    S += (1 - Math.pow(2, -1 / cfg.H_s)) * (a - S);
    L += (1 - Math.pow(2, -1 / cfg.H_l)) * (a - L);
  }
  if (activity.length < cfg.E_min) return 0;
  return clip((S - L) / Math.max(L, cfg.e_denominator_floor), -1, 1);
}

describe('signals', () => {
  it('starts cold at u = b = e = 0', () => {
    expect(new SignalTracker(cfg).signals()).toEqual({ u: 0, b: 0, e: 0 });
  });

  it('computes u from the Laplace-smoothed accuracy over the last N_u first attempts', () => {
    const t = new SignalTracker(cfg);
    t.recordTask(obs(true, 30));
    expect(t.mastery()).toBeCloseTo(2 * (2 / 3) - 1, 12);
    t.recordTask(obs(false, 30, true)); // "don't know" counts as incorrect
    expect(t.mastery()).toBeCloseTo(0, 12);
    for (let i = 0; i < 20; i++) t.recordTask(obs(true, 30));
    expect(t.mastery()).toBeCloseTo(2 * (11 / 12) - 1, 12); // window of 10, all correct
  });

  it('keeps b = 0 until the baseline has B_min attempts, ignoring "don\'t know" answers', () => {
    const t = new SignalTracker(cfg);
    for (let i = 0; i < cfg.N_b + cfg.B_min - 1; i++) t.recordTask(obs(true, 40 + i));
    t.recordTask(obs(false, 5, true));
    expect(t.behaviour()).toBe(0);
    t.recordTask(obs(true, 20));
    expect(t.behaviour()).toBeGreaterThan(0); // faster than baseline
  });

  it('keeps e = 0 below E_min slots and makes it negative after absent slots', () => {
    const t = new SignalTracker(cfg);
    for (let i = 0; i < cfg.E_min - 1; i++) t.recordTask(obs(true, 40));
    expect(t.engagementChange()).toBe(0);
    t.recordTask(obs(true, 40));
    expect(t.engagementChange()).toBeCloseTo(0, 12); // all-active history: S = L = 1
    t.recordSlots(10, cfg.activity_values.absent_slot);
    expect(t.engagementChange()).toBeLessThan(0);
    expect(ewmaRate(1)).toBeCloseTo(0.5, 12);
  });

  it('matches a brute-force recomputation from past data only and stays in [-1, 1]', () => {
    const rng = stream(1, 'signals-test');
    const t = new SignalTracker(cfg);
    const history: Observation[] = [];
    const activity: number[] = [];
    for (let i = 0; i < 400; i++) {
      if (rng.next() < 0.05) {
        const n = 1 + Math.floor(rng.next() * 10);
        t.recordSlots(n, 0);
        for (let k = 0; k < n; k++) activity.push(0);
      } else {
        const o = obs(rng.next() < 0.6, Math.exp(3.7 + 0.5 * rng.normal()), rng.next() < 0.08);
        t.recordTask(o);
        history.push(o);
        activity.push(o.dontKnow ? 0.5 : 1);
      }
      const s = t.signals();
      for (const v of [s.u, s.b, s.e]) {
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(s.b).toBeCloseTo(referenceB(history), 9);
      expect(s.e).toBeCloseTo(referenceE(activity), 9);
    }
    // Appending later data does not change earlier values: recomputing on each prefix reproduces them.
    for (let i = 0; i < history.length; i += 37) {
      const prefix = history.slice(0, i);
      const tt = new SignalTracker(cfg);
      for (const o of prefix) tt.recordTask(o);
      expect(tt.behaviour()).toBeCloseTo(referenceB(prefix), 9);
    }
  });
});
