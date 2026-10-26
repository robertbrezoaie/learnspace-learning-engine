// Copied unchanged from learnspace-sim (https://github.com/robertbrezoaie/learnspace-sim),
// tag v1.0, commit 05f70f7, file src/core/bandit/allocator.ts. Do not edit: the paper's results describe this code.
// Integrity: tests/core/provenance.test.ts checks the body below against core/PROVENANCE.json.
// --- end provenance header ---
// Copied from the LearnSpace study-page repository, lib/allocator.ts, commit bf3472e4701f9b1d3062220f1ac1eeb3b6bec4b8.
// Changes (SIMULATION_SPEC.md section 6.8): the RNG is injected as an Rng object (rng() -> rng.next(),
// no secureRandom default), and imports use explicit .ts paths so the file runs unchanged in Deno.
// Everything else is identical to the deployed code.

import { sampleBeta } from './beta.ts';
import type { Rng } from '../types.ts';
import { ARMS, type Arm } from '../types.ts';

export type Posterior = Record<Arm, { a: number; b: number }>;
export type ArmProbs = Record<Arm, number>;

export interface Allocation {
  half: 'random' | 'thompson';
  arm: Arm;
  propensity: number;
  propensities: ArmProbs;
  thompsonProbs: ArmProbs;
  posterior: Posterior;
}

/** P(arm k has the largest sampled theta), estimated by Monte Carlo. Ties broken at random. */
export function estimateThompsonProbs(posterior: Posterior, draws = 5000, rng: Rng): ArmProbs {
  const counts: ArmProbs = { plain: 0, hint: 0, example: 0 };
  const thetas = new Array<number>(ARMS.length);
  for (let d = 0; d < draws; d++) {
    let best = -1;
    let bestArms: number[] = [];
    for (let k = 0; k < ARMS.length; k++) {
      const p = posterior[ARMS[k]];
      thetas[k] = sampleBeta(p.a, p.b, rng);
      if (thetas[k] > best) {
        best = thetas[k];
        bestArms = [k];
      } else if (thetas[k] === best) {
        bestArms.push(k);
      }
    }
    const winner = bestArms.length === 1 ? bestArms[0] : bestArms[Math.floor(rng.next() * bestArms.length)];
    counts[ARMS[winner]]++;
  }
  return { plain: counts.plain / draws, hint: counts.hint / draws, example: counts.example / draws };
}

export function computePropensities(thompsonProbs: ArmProbs, randomShare: number): ArmProbs {
  const out = {} as ArmProbs;
  for (const k of ARMS) out[k] = randomShare / ARMS.length + (1 - randomShare) * thompsonProbs[k];
  return out;
}

function categorical(probs: ArmProbs, rng: Rng): Arm {
  const u = rng.next();
  let acc = 0;
  for (const k of ARMS) {
    acc += probs[k];
    if (u < acc) return k;
  }
  // floating-point remainder: return the last arm with non-zero probability
  for (let i = ARMS.length - 1; i >= 0; i--) if (probs[ARMS[i]] > 0) return ARMS[i];
  return ARMS[ARMS.length - 1];
}

/** Given the Thompson probabilities, choose the half and the arm (spec 8.2). */
export function decide(
  posterior: Posterior,
  thompsonProbs: ArmProbs,
  randomShare: number,
  rng: Rng,
): Allocation {
  const half = rng.next() < randomShare ? 'random' : 'thompson';
  const arm = half === 'random' ? ARMS[Math.floor(rng.next() * ARMS.length)] : categorical(thompsonProbs, rng);
  const propensities = computePropensities(thompsonProbs, randomShare);
  return { half, arm, propensity: propensities[arm], propensities, thompsonProbs, posterior };
}

export function allocate(posterior: Posterior, randomShare: number, rng: Rng, draws = 5000): Allocation {
  const thompsonProbs = estimateThompsonProbs(posterior, draws, rng);
  return decide(posterior, thompsonProbs, randomShare, rng);
}
