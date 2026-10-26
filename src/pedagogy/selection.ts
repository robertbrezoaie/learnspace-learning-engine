// Outer loop: picks the next task for difficulty D_t (LEARNSPACE_RESEARCH_UPDATE.md section 7, "Task selection").
// Order of preference:
//   1. a question the learner has not answered before;
//   2. the level closest to D_t (a tie goes to the lower level);
//   3. a different domain from the previous task (as pit-study spreads domains);
//   4. the question answered longest ago (only matters once every question has been seen);
//   5. uniformly at random among the rest.

import type { Rng } from '../core/types.ts';
import type { Band, Domain } from '../domain/types.ts';

export interface BankItem {
  id: string;
  domain: Domain;
  level: number; // 1–5
  bands: string[];
}

export interface SelectionContext {
  band: Band;
  /** question id -> when the learner last answered it (epoch ms); absent = never answered */
  lastAnsweredAt: ReadonlyMap<string, number>;
  /** ids already used in the current session; never repeated within a session */
  usedInSession: ReadonlySet<string>;
  previousDomain: Domain | null;
  rng: Rng;
}

export function selectNext(items: readonly BankItem[], difficulty: number, ctx: SelectionContext): BankItem | null {
  const pool = items.filter((q) => q.bands.includes(ctx.band) && !ctx.usedInSession.has(q.id));
  if (pool.length === 0) return null;
  const keyed = pool.map((q) => {
    const answered = ctx.lastAnsweredAt.get(q.id);
    return {
      q,
      key: [
        answered === undefined ? 0 : 1,
        Math.abs(q.level - difficulty),
        q.level,
        q.domain === ctx.previousDomain ? 1 : 0,
        answered ?? 0,
      ],
    };
  });
  keyed.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) if (a.key[i] !== b.key[i]) return a.key[i] - b.key[i];
    return 0;
  });
  const best = keyed.filter((k) => k.key.every((v, i) => v === keyed[0].key[i]));
  return best[Math.floor(ctx.rng.next() * best.length)].q;
}
