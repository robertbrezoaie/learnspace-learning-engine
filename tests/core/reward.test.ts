// Ported from learnspace-sim v1.0 (commit 05f70f7), tests/reward.test.ts. Only import paths changed.
// Reward modulation and XP (SIMULATION_SPEC.md sections 6.3 and 6.4).
import { describe, expect, it } from 'vitest';
import { rewardDecision } from '../../src/core/reward.ts';
import { taskXP } from '../../src/core/gamification.ts';
import { loadAlgorithmConfig } from '../support/simConfig.ts';

const cfg = loadAlgorithmConfig();

describe('reward and XP', () => {
  it('computes typed contributions, aiReward and the clipped multiplier', () => {
    const r = rewardDecision({ u: 0.5, b: -0.25, e: 1 }, cfg.reward);
    expect(r.contributions).toEqual({ u: 0.2, b: -0.1, e: 0.2 });
    expect(r.aiReward).toBeCloseTo(0.3, 12);
    expect(r.multiplier).toBeCloseTo(1.15, 12);
    expect(rewardDecision({ u: -1, b: -1, e: -1 }, cfg.reward).multiplier).toBe(0.75);
    expect(rewardDecision({ u: 1, b: 1, e: 1 }, cfg.reward).multiplier).toBe(1.5);
  });

  it('computes XP from Eq. 1 without the social term', () => {
    expect(taskXP(true, 3, 1.15, cfg.gamification)).toBe(Math.round(16 * 1.15));
    expect(taskXP(false, 3, 1.15, cfg.gamification)).toBe(0);
  });
});
