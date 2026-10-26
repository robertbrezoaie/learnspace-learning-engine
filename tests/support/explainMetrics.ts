// Copied from learnspace-sim v1.0 (commit 05f70f7), src/sim/explainMetrics.ts. Test-only: research metrics, not used by the app.
// Explanation metrics per decision (SIMULATION_SPEC.md section 10.1). None of them needs hidden learner state.

import type { Contributions, Factor } from '../../src/core/types.ts';

export type Category = 'up' | 'down' | 'none';

export function category(delta: number, eps: number): Category {
  return delta >= eps ? 'up' : delta <= -eps ? 'down' : 'none';
}

/** Decision value recomputed from contributions (Delta is the sum of contributions for both outputs). */
function sumOf(c: Contributions, keep: (f: Factor) => boolean): number {
  let s = 0;
  for (const [f, v] of Object.entries(c) as [Factor, number][]) if (keep(f)) s += v;
  return s;
}

/** NC: the explanation names a factor that is not an input of this output. */
export function nonContributing(named: readonly Factor[], c: Contributions): boolean {
  return named.some((f) => c[f] === undefined);
}

/** SI: the primary factor's contribution has the opposite sign to Delta. A factor that is not an input counts as 0 (no SI; it is caught by NC). */
export function signInconsistent(primary: Factor, c: Contributions, delta: number): boolean {
  const v = c[primary] ?? 0;
  return v !== 0 && Math.sign(v) !== Math.sign(delta);
}

/** DN: neutralising the named factor(s) changes the category. */
export function deletionNecessity(named: readonly Factor[], c: Contributions, eps: number): boolean {
  const original = category(sumOf(c, () => true), eps);
  return category(sumOf(c, (f) => !named.includes(f)), eps) !== original;
}

/** SU: keeping only the named factor(s), with the others neutralised, keeps the category. */
export function sufficiency(named: readonly Factor[], c: Contributions, eps: number): boolean {
  const original = category(sumOf(c, () => true), eps);
  return category(sumOf(c, (f) => named.includes(f)), eps) === original;
}

/** Jaccard similarity of two factor sets. */
export function jaccard(a: readonly Factor[], b: readonly Factor[]): number {
  const union = new Set([...a, ...b]);
  if (union.size === 0) return 1;
  let inter = 0;
  for (const f of a) if (b.includes(f)) inter++;
  return inter / union.size;
}
