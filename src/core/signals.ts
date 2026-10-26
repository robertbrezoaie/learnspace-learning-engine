// Copied unchanged from learnspace-sim (https://github.com/robertbrezoaie/learnspace-sim),
// tag v1.0, commit 05f70f7, file src/core/signals.ts. Do not edit: the paper's results describe this code.
// Integrity: tests/core/provenance.test.ts checks the body below against core/PROVENANCE.json.
// --- end provenance header ---
// Input signals u, b and e (SIMULATION_SPEC.md section 6.2).
// The tracker is updated after every task (including its retry) and after every empty activity slot.
// Each update is O(1) amortised: b uses prefix sums, e uses two EWMAs.

import { clip, type AlgorithmConfig, type Observation, type Signals } from './types.ts';

type SignalConfig = AlgorithmConfig['signals'];

/** EWMA step size for a half-life of H slots: lambda(H) = 1 - 2^(-1/H). */
export function ewmaRate(halfLife: number): number {
  return 1 - Math.pow(2, -1 / halfLife);
}

export class SignalTracker {
  // u: first-attempt outcomes ("don't know" counts as incorrect)
  private firstAttempts: boolean[] = [];
  // b: prefix sums of ln(rt) and ln(rt)^2 over first attempts that were not "don't know"
  private rtSum: number[] = [0];
  private rtSumSq: number[] = [0];
  // e: activity EWMAs
  private shortEwma = 1;
  private longEwma = 1;
  private slots = 0;
  private readonly rateShort: number;
  private readonly rateLong: number;
  private readonly cfg: SignalConfig;

  constructor(cfg: SignalConfig) {
    this.cfg = cfg;
    this.rateShort = ewmaRate(cfg.H_s);
    this.rateLong = ewmaRate(cfg.H_l);
  }

  /** Records a completed task and appends its activity slot (1 if attempted, 0.5 if "don't know"). */
  recordTask(obs: Observation): void {
    this.firstAttempts.push(obs.firstCorrect && !obs.dontKnow);
    if (!obs.dontKnow) {
      const x = Math.log(obs.rtSeconds);
      const n = this.rtSum.length - 1;
      this.rtSum.push(this.rtSum[n] + x);
      this.rtSumSq.push(this.rtSumSq[n] + x * x);
    }
    const a = obs.dontKnow ? this.cfg.activity_values.dont_know : this.cfg.activity_values.attempted;
    this.recordSlot(a);
  }

  /** Appends one activity slot with value a (used for quit slots and absent-session slots). */
  recordSlot(a: number): void {
    this.shortEwma += this.rateShort * (a - this.shortEwma);
    this.longEwma += this.rateLong * (a - this.longEwma);
    this.slots++;
  }

  recordSlots(count: number, a: number): void {
    for (let i = 0; i < count; i++) this.recordSlot(a);
  }

  /** u = 2 * m_hat - 1, with m_hat = (k + 1) / (n + 2) over the last N_u first attempts. */
  mastery(): number {
    const n = Math.min(this.cfg.N_u, this.firstAttempts.length);
    let k = 0;
    for (let i = this.firstAttempts.length - n; i < this.firstAttempts.length; i++) if (this.firstAttempts[i]) k++;
    return 2 * ((k + 1) / (n + 2)) - 1;
  }

  /** b = clip(-mean(z) / 2, -1, 1): positive when recent answers are faster than the learner's own baseline. */
  behaviour(): number {
    const total = this.rtSum.length - 1;
    const nRecent = Math.min(this.cfg.N_b, total);
    const nBase = total - nRecent;
    if (nBase < this.cfg.B_min) return 0;
    const baseMean = this.rtSum[nBase] / nBase;
    // sample standard deviation (n - 1) of the baseline, floored
    const baseVar = Math.max(0, (this.rtSumSq[nBase] - nBase * baseMean * baseMean) / (nBase - 1));
    const sd = Math.max(Math.sqrt(baseVar), this.cfg.rt_sd_floor);
    const recentMean = (this.rtSum[total] - this.rtSum[nBase]) / nRecent;
    const meanZ = (recentMean - baseMean) / sd;
    return clip(-meanZ / 2, -1, 1);
  }

  /** e = clip((S - L) / max(L, floor), -1, 1); 0 before E_min slots. */
  engagementChange(): number {
    if (this.slots < this.cfg.E_min) return 0;
    const denom = Math.max(this.longEwma, this.cfg.e_denominator_floor);
    return clip((this.shortEwma - this.longEwma) / denom, -1, 1);
  }

  signals(): Signals {
    return { u: this.mastery(), b: this.behaviour(), e: this.engagementChange() };
  }

  get slotCount(): number {
    return this.slots;
  }
}
