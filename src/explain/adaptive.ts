// App rules around the core (LEARNSPACE_RESEARCH_UPDATE.md sections 6, 7, 9 and 10.8).
// The core computes the decisions; this module only decides which of them are explained
// and applies the static rules when a learner has opted out of adaptation.

import type { AlgorithmConfig, Signals } from '../core/types.ts';
import { rewardDecision, type RewardDecision } from '../core/reward.ts';
import { difficultyDecision, type DifficultyDecision, type DifficultyInput } from '../core/difficulty.ts';
import { explainV2, type Explanation } from '../core/explain.ts';

/** Reward after a task: Δ = aiReward, ε = eps_r. With adaptation off, m = 1 and nothing is explained. */
export function rewardStep(
  signals: Signals,
  cfg: AlgorithmConfig,
  adaptive: boolean,
): { decision: RewardDecision; multiplier: number; explanation: Explanation | null } {
  const decision = rewardDecision(signals, cfg.reward);
  if (!adaptive) return { decision, multiplier: 1, explanation: null };
  const explanation = explainV2('reward', decision.contributions, decision.aiReward, cfg.reward.eps_r, cfg.explanation.delta_tie);
  return { decision, multiplier: decision.multiplier, explanation };
}

/**
 * Difficulty for the next task: Δ = planned step, ε = eps_D, contributions {e} only.
 * Never explained on the first task of a session (contributions = null), under STATIC, or when the clip
 * suppresses the step. With adaptation off the STATIC rule applies.
 */
export function difficultyStep(
  input: DifficultyInput,
  cfg: AlgorithmConfig,
  adaptive: boolean,
): { decision: DifficultyDecision; explanation: Explanation | null } {
  const decision = difficultyDecision(adaptive ? input : { ...input, rule: 'STATIC' }, cfg.difficulty);
  if (decision.contributions === null || decision.plannedStep === null || decision.suppressedByClip) {
    return { decision, explanation: null };
  }
  const explanation = explainV2('difficulty', decision.contributions, decision.plannedStep, cfg.difficulty.eps_D, cfg.explanation.delta_tie);
  return { decision, explanation };
}
