// Ported from learnspace-sim v1.0 (commit 05f70f7), tests/explain.test.ts. Only import paths changed (explainMetrics is copied to tests/support).
// Test 6 (SIMULATION_SPEC.md section 14): explanations, hand-computed cases.
import { describe, expect, it } from 'vitest';
import { explainRandom, explainV1, explainV2 } from '../../src/core/explain.ts';
import { rewardDecision } from '../../src/core/reward.ts';
import { difficultyDecision } from '../../src/core/difficulty.ts';
import { loadAlgorithmConfig } from '../support/simConfig.ts';
import {
  category,
  deletionNecessity,
  jaccard,
  nonContributing,
  signInconsistent,
  sufficiency,
} from '../support/explainMetrics.ts';
import { stream } from '../support/simRng.ts';

const cfg = loadAlgorithmConfig();
const EPS = 0.1;

describe('explanations', () => {
  it('case (+0.5, -0.3, -0.3) with delta = -0.1: v1 names u (SI = 1); v2 names b and e as a near tie', () => {
    const c = { u: 0.5, b: -0.3, e: -0.3 };
    const v1 = explainV1(c);
    expect(v1).toBe('u');
    expect(signInconsistent(v1, c, -0.1)).toBe(true);
    const v2 = explainV2('reward', c, -0.1, EPS, 0.2);
    expect(v2?.direction).toBe('down');
    expect(v2?.factors).toEqual(['b', 'e']);
    expect(v2?.shares).toEqual([0.5, 0.5]);
    expect(signInconsistent(v2!.factors[0], c, -0.1)).toBe(false);
  });

  it('case (0.30, 0.27, 0): two factors with delta_tie = 0.2, one factor with delta_tie = 0', () => {
    const c = { u: 0.3, b: 0.27, e: 0 };
    expect(explainV2('reward', c, 0.57, EPS, 0.2)?.factors).toEqual(['u', 'b']);
    expect(explainV2('reward', c, 0.57, EPS, 0)?.factors).toEqual(['u']);
    expect(explainV2('reward', c, 0.57, EPS, 0)?.shares[0]).toBeCloseTo(0.3 / 0.57, 12);
  });

  it('returns null when |delta| < eps', () => {
    expect(explainV2('reward', { u: 0.05, b: 0.02, e: 0 }, 0.07, EPS, 0.2)).toBeNull();
    expect(explainV2('difficulty', { e: -0.0999 }, -0.0999, EPS, 0.2)).toBeNull();
  });

  it('a DDA-E step where v1 names u gives NC = 1, while v2 names e', () => {
    const reward = rewardDecision({ u: 0.8, b: 0.1, e: 0.3 }, cfg.reward);
    const v1 = explainV1(reward.contributions);
    expect(v1).toBe('u');
    const diff = difficultyDecision(
      { rule: 'DDA-E', session: 1, sessions: 20, firstTaskOfSession: false, ePrev: 0.3, ePrevUsed: 0.05, prevDifficulty: 2.1 },
      cfg.difficulty,
    );
    const c = diff.contributions!;
    expect(nonContributing([v1], c)).toBe(true);
    expect(deletionNecessity([v1], c, cfg.difficulty.eps_D)).toBe(false);
    const v2 = explainV2('difficulty', c, diff.plannedStep!, cfg.difficulty.eps_D, cfg.explanation.delta_tie);
    expect(v2?.factors).toEqual(['e']);
    expect(nonContributing(v2!.factors, c)).toBe(false);
    expect(deletionNecessity(v2!.factors, c, cfg.difficulty.eps_D)).toBe(true);
    expect(sufficiency(v2!.factors, c, cfg.difficulty.eps_D)).toBe(true);
    expect(v2?.text).toBe('The next tasks are a little harder because you have been more active lately.');
  });

  it('computes DN and SU on a reward decision with three inputs', () => {
    const c = { u: 0.2, b: 0.15, e: -0.1 }; // delta = 0.25
    expect(category(0.25, EPS)).toBe('up');
    expect(deletionNecessity(['u'], c, EPS)).toBe(true); // 0.05 -> none
    expect(deletionNecessity(['b'], c, EPS)).toBe(false); // 0.10 -> still up
    expect(sufficiency(['u'], c, EPS)).toBe(true);
    expect(sufficiency(['e'], c, EPS)).toBe(false);
    expect(jaccard(['u', 'b'], ['u'])).toBe(0.5);
  });

  it('draws the random baseline only among non-zero factors of the output', () => {
    const rng = stream(1, 'xrandom');
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(explainRandom({ u: 0.2, b: 0, e: -0.1 }, rng)!);
    expect([...seen].sort()).toEqual(['e', 'u']);
    expect(explainRandom({ e: 0 }, rng)).toBeNull();
  });
});
