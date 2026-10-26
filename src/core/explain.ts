// Copied unchanged from learnspace-sim (https://github.com/robertbrezoaie/learnspace-sim),
// tag v1.0, commit 05f70f7, file src/core/explain.ts. Do not edit: the paper's results describe this code.
// Integrity: tests/core/provenance.test.ts checks the body below against core/PROVENANCE.json.
// --- end provenance header ---
// Explanation Layer (SIMULATION_SPEC.md section 6.6).
// v2: decision-specific rule (the revised paper's rule), called once per output with that output's own contributions.
// v1: the original global-argmax rule (paper section 3.4, Step 5), kept for comparison only.
// Random: one factor drawn uniformly from the output's own non-zero contributions.

import { renderExplanation } from './templates.ts';
import { FACTORS, type Contributions, type Direction, type Factor, type Output, type Rng } from './types.ts';

export interface Explanation {
  output: Output;
  direction: Direction;
  factors: Factor[]; // one factor, or two on a near tie; primary first
  shares: number[]; // |c_j| / sum of |c_k| over sign-consistent factors, aligned with `factors`
  text: string;
}

/** Factors present in c, in the fixed order u, b, e (used to break ties deterministically). */
function presentFactors(c: Contributions): Factor[] {
  return FACTORS.filter((f) => c[f] !== undefined);
}

/**
 * v2 rule. Returns null when |delta| < eps (no material change, nothing shown).
 * Sign-consistent non-zero factors are sorted by |c_j| descending (ties keep the order u, b, e);
 * the second factor is added when |c_2| >= (1 - deltaTie) * |c_1|.
 */
export function explainV2(
  output: Output,
  c: Contributions,
  delta: number,
  eps: number,
  deltaTie: number,
): Explanation | null {
  if (Math.abs(delta) < eps) return null;
  const dir = Math.sign(delta);
  const consistent = presentFactors(c)
    .filter((f) => c[f] !== 0 && Math.sign(c[f] as number) === dir)
    .sort((a, b) => Math.abs(c[b] as number) - Math.abs(c[a] as number));
  if (consistent.length === 0) {
    // cannot happen when delta is the sum of the contributions and |delta| >= eps > 0
    throw new Error(`explainV2: no sign-consistent factor for delta = ${delta}`);
  }
  const factors: Factor[] = [consistent[0]];
  const c0 = Math.abs(c[consistent[0]] as number);
  if (consistent.length >= 2 && Math.abs(c[consistent[1]] as number) >= (1 - deltaTie) * c0) {
    factors.push(consistent[1]);
  }
  const total = consistent.reduce((acc, f) => acc + Math.abs(c[f] as number), 0);
  const shares = factors.map((f) => Math.abs(c[f] as number) / total);
  const direction: Direction = dir > 0 ? 'up' : 'down';
  const text = renderExplanation(
    output,
    direction,
    factors.map((f) => ({ factor: f, contribution: c[f] as number })),
  );
  return { output, direction, factors, shares, text };
}

/**
 * v1 rule: argmax over {u, b, e} of |reward contribution| (ties keep the order u, b, e).
 * The same factor explains every adaptive decision of the task; no threshold, no tie handling, no sign check.
 */
export function explainV1(rewardContributions: Contributions): Factor {
  let best: Factor = FACTORS[0];
  let bestAbs = -1;
  for (const f of FACTORS) {
    const v = Math.abs(rewardContributions[f] ?? 0);
    if (v > bestAbs) {
      best = f;
      bestAbs = v;
    }
  }
  return best;
}

/** Random baseline: one factor uniformly from the output's own factors with c_j != 0; null if there is none. */
export function explainRandom(c: Contributions, rng: Rng): Factor | null {
  const candidates = presentFactors(c).filter((f) => c[f] !== 0);
  if (candidates.length === 0) return null;
  return candidates[Math.floor(rng.next() * candidates.length)];
}
