// Acceptance tests from LEARNSPACE_RESEARCH_UPDATE.md section 11: invariants, golden cases (paper Table 4), cold start.
import { describe, expect, it } from 'vitest';
import { config } from '../../src/config/config.ts';
import { difficultyStep, rewardStep } from '../../src/explain/adaptive.ts';
import { SignalTracker } from '../../src/core/signals.ts';
import { explainV2 } from '../../src/core/explain.ts';
import { allocate, type Posterior } from '../../src/core/bandit/allocator.ts';
import { initialPosterior, updatePosterior } from '../../src/core/bandit/thompson.ts';
import { ARMS, type Signals } from '../../src/core/types.ts';
import { secureRng } from '../../src/rng.ts';
import { stream } from '../support/simRng.ts';
import { obs } from '../support/helpers.ts';

const cfg = config.algorithm;
const inRange = (x: number, lo: number, hi: number) => x >= lo && x <= hi;

describe('config', () => {
  it('uses probs mode, the paper weights and DDA-E by default', () => {
    expect(cfg.bandit.ts_mode).toBe('probs');
    expect(cfg.bandit.random_share).toBe(0.5);
    expect(cfg.bandit.draws).toBe(5000);
    expect([cfg.reward.alpha, cfg.reward.beta, cfg.reward.gamma]).toEqual([0.4, 0.4, 0.2]);
    expect(config.app.difficulty_rule).toBe('DDA-E');
    expect(config.app.correct_min_score).toBe(2);
    expect(config.app.planned_tasks).toBe(12);
  });

  it('drops documentation keys', () => {
    expect(Object.keys(cfg).some((k) => k.startsWith('_'))).toBe(false);
    expect(Object.keys(cfg.bandit).some((k) => k.startsWith('_'))).toBe(false);
  });
});

describe('golden cases (paper Table 4)', () => {
  it('C: u = 0.9, b = -0.8, e = -1.0 names b only', () => {
    const { decision, multiplier, explanation } = rewardStep({ u: 0.9, b: -0.8, e: -1.0 }, cfg, true);
    expect(decision.contributions.u).toBeCloseTo(0.36, 12);
    expect(decision.contributions.b).toBeCloseTo(-0.32, 12);
    expect(decision.contributions.e).toBeCloseTo(-0.2, 12);
    expect(decision.aiReward).toBeCloseTo(-0.16, 12);
    expect(multiplier).toBeCloseTo(0.92, 12);
    expect(explanation?.factors).toEqual(['b']);
    expect(explanation?.text).toBe('Your XP bonus is smaller this time because the last questions took you longer than usual.');
  });

  it('B: u = 0.5, b = 0.41, e = 0 is a near tie and names u and b', () => {
    const { decision, explanation } = rewardStep({ u: 0.5, b: 0.41, e: 0 }, cfg, true);
    expect(decision.aiReward).toBeCloseTo(0.364, 12);
    expect(explanation?.factors).toEqual(['u', 'b']);
    expect(explanation?.text).toBe(
      'You earned extra XP because your mastery of the topic keeps growing and you are working more fluently than usual.',
    );
  });

  it('A: a difficulty step with contribution -0.10 names e', () => {
    const ex = explainV2('difficulty', { e: -0.1 }, -0.1, cfg.difficulty.eps_D, cfg.explanation.delta_tie);
    expect(ex?.factors).toEqual(['e']);
    expect(ex?.text).toBe('The next tasks are a little easier because you have been less active lately.');
  });
});

describe('invariants (property tests)', () => {
  const rng = stream(11, 'app:acceptance');
  const randomSignals = (): Signals => ({ u: 2 * rng.next() - 1, b: 2 * rng.next() - 1, e: 2 * rng.next() - 1 });

  it('keeps u, b, e in [-1, 1] over random histories with quits and absences', () => {
    for (let learner = 0; learner < 200; learner++) {
      const t = new SignalTracker(cfg.signals);
      for (let k = 0; k < 120; k++) {
        const r = rng.next();
        if (r < 0.05) t.recordSlots(8, cfg.signals.activity_values.absent_slot);
        else if (r < 0.1) t.recordSlot(cfg.signals.activity_values.quit_slot);
        else t.recordTask(obs(rng.next() < 0.6, Math.exp(1 + 2 * rng.next()), rng.next() < 0.1));
        const s = t.signals();
        expect(inRange(s.u, -1, 1) && inRange(s.b, -1, 1) && inRange(s.e, -1, 1)).toBe(true);
      }
    }
  });

  it('keeps aiReward in [-1, 1] and m in [0.75, 1.5]; reward explanations are sign-consistent', () => {
    for (let i = 0; i < 20000; i++) {
      const { decision, multiplier, explanation } = rewardStep(randomSignals(), cfg, true);
      expect(inRange(decision.aiReward, -1, 1)).toBe(true);
      expect(inRange(multiplier, 0.75, 1.5)).toBe(true);
      if (Math.abs(decision.aiReward) < cfg.reward.eps_r) expect(explanation).toBeNull();
      if (explanation) {
        const dir = Math.sign(decision.aiReward);
        for (const f of explanation.factors) expect(Math.sign(decision.contributions[f] as number)).toBe(dir);
      }
    }
  });

  it('keeps D_t in [1, 5]; difficulty explanations name only e and follow the display rules', () => {
    for (let i = 0; i < 20000; i++) {
      const first = rng.next() < 0.2;
      const { decision, explanation } = difficultyStep(
        {
          rule: 'DDA-E',
          session: 1 + Math.floor(rng.next() * 8),
          sessions: 8,
          firstTaskOfSession: first,
          ePrev: 2 * rng.next() - 1,
          ePrevUsed: 2 * rng.next() - 1,
          prevDifficulty: 1 + 4 * rng.next(),
        },
        cfg,
        true,
      );
      expect(inRange(decision.difficulty, 1, 5)).toBe(true);
      if (first || decision.suppressedByClip) expect(explanation).toBeNull();
      if (decision.plannedStep !== null && Math.abs(decision.plannedStep) < cfg.difficulty.eps_D) expect(explanation).toBeNull();
      if (explanation) {
        expect(explanation.factors).toEqual(['e']);
        expect(Math.sign(decision.contributions!.e as number)).toBe(Math.sign(decision.plannedStep!));
      }
    }
  });

  it('never explains a step suppressed by the clip', () => {
    // D_base = 4 in the last session; e from 0.5 to 0.8 plans +1.2 but D stays clipped at 5
    const { decision, explanation } = difficultyStep(
      { rule: 'DDA-E', session: 8, sessions: 8, firstTaskOfSession: false, ePrev: 0.8, ePrevUsed: 0.5, prevDifficulty: 5 },
      cfg,
      true,
    );
    expect(decision.difficulty).toBe(5);
    expect(decision.suppressedByClip).toBe(true);
    expect(explanation).toBeNull();
  });

  it('gives every propensity >= 1/6, summing to 1, with the secure RNG', () => {
    for (let i = 0; i < 50; i++) {
      const p: Posterior = initialPosterior(cfg.bandit.prior);
      for (const arm of ARMS) {
        p[arm].a += Math.floor(rng.next() * 40);
        p[arm].b += Math.floor(rng.next() * 40);
      }
      const alloc = allocate(p, cfg.bandit.random_share, secureRng, 2000);
      const values = ARMS.map((a) => alloc.propensities[a]);
      for (const v of values) expect(v).toBeGreaterThanOrEqual(1 / 6 - 1e-12);
      expect(values.reduce((x, y) => x + y, 0)).toBeCloseTo(1, 12);
      expect(alloc.propensity).toBe(alloc.propensities[alloc.arm]);
    }
  });

  it('changes the bandit state by exactly (+r, +(1 - r)) on the chosen arm', () => {
    for (const r of [0, 1] as const) {
      const p = initialPosterior(cfg.bandit.prior);
      updatePosterior(p, 'hint', r);
      expect(p.hint).toEqual({ a: 1 + r, b: 1 + (1 - r) });
      expect(p.plain).toEqual({ a: 1, b: 1 });
      expect(p.example).toEqual({ a: 1, b: 1 });
    }
  });
});

describe('opt-out of adaptation (section 10.8)', () => {
  it('uses m = 1, D = D_base(s) and shows no explanations', () => {
    const r = rewardStep({ u: 0.9, b: 0.9, e: 0.9 }, cfg, false);
    expect(r.multiplier).toBe(1);
    expect(r.explanation).toBeNull();
    const d = difficultyStep(
      { rule: 'DDA-E', session: 1, sessions: 5, firstTaskOfSession: false, ePrev: 0.9, ePrevUsed: 0, prevDifficulty: 2 },
      cfg,
      false,
    );
    expect(d.decision.difficulty).toBe(2);
    expect(d.explanation).toBeNull();
  });
});

describe('cold start', () => {
  it('gives u = 0, b = 0 and e = 0 to a new learner', () => {
    expect(new SignalTracker(cfg.signals).signals()).toEqual({ u: 0, b: 0, e: 0 });
  });

  it('keeps b = 0 until 5 earlier answers exist and e = 0 for the first 10 slots', () => {
    const t = new SignalTracker(cfg.signals);
    for (let k = 1; k <= 10; k++) {
      t.recordTask(obs(true, k === 10 ? 1 : 60)); // the 10th answer is much faster
      if (k < 10) expect(t.engagementChange()).toBe(0);
      if (k < cfg.signals.N_b + cfg.signals.B_min) expect(t.behaviour()).toBe(0);
    }
    expect(t.behaviour()).toBeGreaterThan(0);
  });

  it('shows no reward explanation before u moves away from 0', () => {
    expect(rewardStep(new SignalTracker(cfg.signals).signals(), cfg, true).explanation).toBeNull();
  });
});
