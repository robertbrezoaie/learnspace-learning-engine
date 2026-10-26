// Difficulty levels on the 1–5 scale of DDA-E (LEARNSPACE_RESEARCH_UPDATE.md section 7).
// The pit-study bank has three tiers; Robert decided to map them instead of re-labelling (2026-10-23).

import type { Tier } from './types.ts';

export const TIER_LEVEL: Record<Tier, number> = { warmup: 1, easy: 3, hard: 5 };

export function levelOf(tier: Tier): number {
  return TIER_LEVEL[tier];
}
