// Copied unchanged from learnspace-sim (https://github.com/robertbrezoaie/learnspace-sim),
// tag v1.0, commit 05f70f7, file src/core/bandit/beta.ts. Do not edit: the paper's results describe this code.
// Integrity: tests/core/provenance.test.ts checks the body below against core/PROVENANCE.json.
// --- end provenance header ---
// Copied from the LearnSpace study-page repository, lib/beta.ts, commit bf3472e4701f9b1d3062220f1ac1eeb3b6bec4b8.
// Changes (SIMULATION_SPEC.md section 6.8): the RNG is injected as an Rng object (rng() -> rng.next(),
// no secureRandom default), and imports use explicit .ts paths so the file runs unchanged in Deno.
// Everything else is identical to the deployed code.

import type { Rng } from '../types.ts';

/** Standard normal via the Marsaglia polar method. */
function normal(rng: Rng): number {
  for (;;) {
    const u = 2 * rng.next() - 1;
    const v = 2 * rng.next() - 1;
    const s = u * u + v * v;
    if (s > 0 && s < 1) return u * Math.sqrt((-2 * Math.log(s)) / s);
  }
}

/** Gamma(shape, 1) by Marsaglia–Tsang. Requires shape >= 1 (always true here: Beta params start at 1). */
export function sampleGamma(shape: number, rng: Rng): number {
  if (!(shape >= 1)) throw new Error(`sampleGamma requires shape >= 1, got ${shape}`);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = normal(rng);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rng.next();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Beta(a, b) = X / (X + Y) with X ~ Gamma(a), Y ~ Gamma(b). */
export function sampleBeta(a: number, b: number, rng: Rng): number {
  const x = sampleGamma(a, rng);
  const y = sampleGamma(b, rng);
  return x / (x + y);
}
