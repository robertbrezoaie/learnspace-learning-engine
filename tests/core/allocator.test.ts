// Ported from learnspace-sim v1.0 (commit 05f70f7), tests/allocator.test.ts. Import paths changed; the TS_CTX ablation test is dropped (contextual.ts is not deployed).
// Test 3 (SIMULATION_SPEC.md section 14): the deployed allocator and the 'sample' mode.
import { describe, expect, it } from 'vitest';
import { computePropensities, decide, estimateThompsonProbs, type Posterior } from '../../src/core/bandit/allocator.ts';
import { chooseArm, initialPosterior, updatePosterior } from '../../src/core/bandit/thompson.ts';
import { ARMS, type Arm } from '../../src/core/types.ts';
import { stream } from '../support/simRng.ts';

const RANDOM_SHARE = 0.5;
const POSTERIORS: Posterior[] = [
  { plain: { a: 5, b: 10 }, hint: { a: 8, b: 6 }, example: { a: 12, b: 5 } },
  { plain: { a: 2, b: 2 }, hint: { a: 3, b: 2 }, example: { a: 2, b: 3 } },
  { plain: { a: 40, b: 30 }, hint: { a: 45, b: 28 }, example: { a: 20, b: 20 } },
];

function frequencies(arms: Arm[]): Record<Arm, number> {
  const f: Record<Arm, number> = { plain: 0, hint: 0, example: 0 };
  for (const a of arms) f[a] += 1 / arms.length;
  return f;
}

describe('deployed allocator', () => {
  it('gives probsTS of about 1/3 per arm for equal states', () => {
    const probs = estimateThompsonProbs(initialPosterior({ a: 1, b: 1 }), 30_000, stream(1, 'alloc-equal'));
    for (const k of ARMS) expect(Math.abs(probs[k] - 1 / 3)).toBeLessThan(0.02);
  });

  it('gives propensities that sum to 1 and are each at least RANDOM_SHARE / 3', () => {
    const rng = stream(1, 'alloc-props');
    for (const p of POSTERIORS) {
      const props = computePropensities(estimateThompsonProbs(p, 5000, rng), RANDOM_SHARE);
      expect(Math.abs(ARMS.reduce((s, k) => s + props[k], 0) - 1)).toBeLessThan(1e-9);
      for (const k of ARMS) expect(props[k]).toBeGreaterThanOrEqual(RANDOM_SHARE / 3);
    }
  });

  it('allocates with empirical frequencies matching the propensities over 30,000 allocations', () => {
    const rng = stream(1, 'alloc-freq');
    const p = POSTERIORS[0];
    const probs = estimateThompsonProbs(p, 20_000, rng);
    const arms: Arm[] = [];
    let propensities = computePropensities(probs, RANDOM_SHARE);
    for (let i = 0; i < 30_000; i++) {
      const a = decide(p, probs, RANDOM_SHARE, rng);
      arms.push(a.arm);
      propensities = a.propensities;
      expect(a.propensity).toBe(a.propensities[a.arm]);
    }
    const freq = frequencies(arms);
    for (const k of ARMS) expect(Math.abs(freq[k] - propensities[k])).toBeLessThan(0.01);
  });

  it("gives the same arm frequencies in 'sample' and 'probs' modes for three fixed posteriors", () => {
    const n = 100_000;
    POSTERIORS.forEach((p, i) => {
      const rngSample = stream(1, `mode-sample:${i}`);
      const rngProbs = stream(1, `mode-probs:${i}`);
      const sampleArms: Arm[] = [];
      for (let j = 0; j < n; j++) sampleArms.push(chooseArm(p, RANDOM_SHARE, 'sample', 0, rngSample).arm);
      const probs = estimateThompsonProbs(p, n, rngProbs);
      const probsArms: Arm[] = [];
      for (let j = 0; j < n; j++) probsArms.push(decide(p, probs, RANDOM_SHARE, rngProbs).arm);
      const fs = frequencies(sampleArms);
      const fp = frequencies(probsArms);
      for (const k of ARMS) expect(Math.abs(fs[k] - fp[k])).toBeLessThan(0.01);
    });
  });

  it("logs propensities in 'probs' mode only", () => {
    const rng = stream(1, 'mode-log');
    const p = initialPosterior({ a: 1, b: 1 });
    expect(chooseArm(p, RANDOM_SHARE, 'probs', 1000, rng).propensities).not.toBeNull();
    expect(chooseArm(p, RANDOM_SHARE, 'sample', 1000, rng).propensities).toBeNull();
  });

  it('updates a += r, b += 1 - r on the chosen arm only', () => {
    const p = initialPosterior({ a: 1, b: 1 });
    updatePosterior(p, 'hint', 1);
    updatePosterior(p, 'hint', 0);
    updatePosterior(p, 'example', 0);
    expect(p).toEqual({ plain: { a: 1, b: 1 }, hint: { a: 2, b: 2 }, example: { a: 1, b: 2 } });
  });
});
