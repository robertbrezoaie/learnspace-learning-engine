// Ported from learnspace-sim v1.0 (commit 05f70f7), tests/beta.test.ts. Only import paths changed.
// Test 2 (SIMULATION_SPEC.md section 14): Beta sampler, as in Report 5 Part B section 8.5.
import { describe, expect, it } from 'vitest';
import { sampleBeta } from '../../src/core/bandit/beta.ts';
import { stream } from '../support/simRng.ts';

describe('deployed Beta sampler', () => {
  for (const [a, b] of [
    [1, 1],
    [2, 5],
    [30, 10],
  ]) {
    it(`has mean within 0.01 of a/(a+b) for Beta(${a}, ${b}) over 100,000 draws`, () => {
      const rng = stream(1, `beta-test:${a}:${b}`);
      let sum = 0;
      for (let i = 0; i < 100_000; i++) sum += sampleBeta(a, b, rng);
      expect(Math.abs(sum / 100_000 - a / (a + b))).toBeLessThan(0.01);
    });
  }
});
