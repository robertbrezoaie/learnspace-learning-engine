// Copied unchanged from learnspace-sim (https://github.com/robertbrezoaie/learnspace-sim),
// tag v1.0, commit 05f70f7, file src/core/bandit/thompson.ts. Do not edit: the paper's results describe this code.
// Integrity: tests/core/provenance.test.ts checks the body below against core/PROVENANCE.json.
// --- end provenance header ---
// Bandit state, update and arm choice around the deployed allocator (SIMULATION_SPEC.md section 6.8).
// allocator.ts and beta.ts are the deployed files. This file adds what the deployed code keeps elsewhere
// (the posterior update lives in SQL, update_bandit) and the 'sample' mode used for long runs.

import { sampleBeta } from './beta.ts';
import { allocate, type ArmProbs, type Posterior } from './allocator.ts';
import { ARMS, type Arm, type Rng } from '../types.ts';

export type TsMode = 'sample' | 'probs';

export function initialPosterior(prior: { a: number; b: number }): Posterior {
  return {
    plain: { a: prior.a, b: prior.b },
    hint: { a: prior.a, b: prior.b },
    example: { a: prior.a, b: prior.b },
  };
}

/** Deployed update (update_bandit in the study page): a += r, b += 1 - r. Called after every graded retry, from both halves. */
export function updatePosterior(posterior: Posterior, arm: Arm, reward: 0 | 1): void {
  posterior[arm].a += reward;
  posterior[arm].b += 1 - reward;
}

/** One Thompson draw: theta_k ~ Beta(a_k, b_k) for each arm, argmax, ties broken at random. */
export function sampleThompsonArm(posterior: Posterior, rng: Rng): Arm {
  let best = -1;
  let bestArms: number[] = [];
  for (let k = 0; k < ARMS.length; k++) {
    const p = posterior[ARMS[k]];
    const theta = sampleBeta(p.a, p.b, rng);
    if (theta > best) {
      best = theta;
      bestArms = [k];
    } else if (theta === best) {
      bestArms.push(k);
    }
  }
  const winner = bestArms.length === 1 ? bestArms[0] : bestArms[Math.floor(rng.next() * bestArms.length)];
  return ARMS[winner];
}

export interface ArmChoice {
  half: 'random' | 'thompson';
  arm: Arm;
  /** 'probs' mode only: propensities and Thompson probabilities at decision time. */
  propensities: ArmProbs | null;
  thompsonProbs: ArmProbs | null;
}

/**
 * Chooses the feedback arm for one mistake.
 * 'probs' calls the deployed allocate() unchanged. 'sample' gives the same arm distribution with one Beta draw per arm.
 */
export function chooseArm(posterior: Posterior, randomShare: number, mode: TsMode, draws: number, rng: Rng): ArmChoice {
  if (mode === 'probs') {
    const a = allocate(posterior, randomShare, rng, draws);
    return { half: a.half, arm: a.arm, propensities: a.propensities, thompsonProbs: a.thompsonProbs };
  }
  const half = rng.next() < randomShare ? 'random' : 'thompson';
  const arm = half === 'random' ? ARMS[Math.floor(rng.next() * ARMS.length)] : sampleThompsonArm(posterior, rng);
  return { half, arm, propensities: null, thompsonProbs: null };
}
