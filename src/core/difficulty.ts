// Copied unchanged from learnspace-sim (https://github.com/robertbrezoaie/learnspace-sim),
// tag v1.0, commit 05f70f7, file src/core/difficulty.ts. Do not edit: the paper's results describe this code.
// Integrity: tests/core/provenance.test.ts checks the body below against core/PROVENANCE.json.
// --- end provenance header ---
// Difficulty rules (SIMULATION_SPEC.md section 6.5).
// STATIC follows the curriculum. DDA-E is the paper's Eq. 4 with R2's clip: it uses engagement change only.

import { clip, type AlgorithmConfig, type Contributions } from './types.ts';

export type DifficultyRule = 'STATIC' | 'DDA-E';

type DifficultyConfig = AlgorithmConfig['difficulty'];

/** D_base(s) = start + (end - start) * (s - 1) / (S - 1); sessions are numbered from 1. */
export function curriculumBase(session: number, sessions: number, cfg: DifficultyConfig): number {
  if (sessions <= 1) return cfg.curriculum.start;
  return cfg.curriculum.start + ((cfg.curriculum.end - cfg.curriculum.start) * (session - 1)) / (sessions - 1);
}

export interface DifficultyDecision {
  base: number; // D_base(s)
  difficulty: number; // D_t after clipping
  clipped: boolean; // the clip to [D_min, D_max] changed D_t
  /** Contributions to the step, or null when the decision is not explainable (STATIC, or first task of a session). */
  contributions: Contributions | null;
  plannedStep: number | null; // sum of contributions, before clipping
  realizedStep: number | null; // D_t - D_{t-1}, after clipping
  suppressedByClip: boolean; // |planned| >= eps_D but |realized| < eps_D
}

export interface DifficultyInput {
  rule: DifficultyRule;
  session: number;
  sessions: number;
  firstTaskOfSession: boolean;
  /** e after the previous task (e_{t-1}); 0 before the learner's first task. */
  ePrev: number;
  /** The e value used for the previous task's difficulty (e_{t-2}); ignored on the first task of a session. */
  ePrevUsed: number;
  /** D_{t-1}; ignored on the first task of a session. */
  prevDifficulty: number;
}

export function difficultyDecision(input: DifficultyInput, cfg: DifficultyConfig): DifficultyDecision {
  const base = curriculumBase(input.session, input.sessions, cfg);
  if (input.rule === 'STATIC') {
    const difficulty = clip(base, cfg.D_min, cfg.D_max);
    return {
      base,
      difficulty,
      clipped: difficulty !== base,
      contributions: null,
      plannedStep: null,
      realizedStep: null,
      suppressedByClip: false,
    };
  }
  const unclipped = base * (1 + input.ePrev);
  const difficulty = clip(unclipped, cfg.D_min, cfg.D_max);
  const clipped = difficulty !== unclipped;
  if (input.firstTaskOfSession) {
    // follows a curriculum change: not an adaptive decision, never explained
    return { base, difficulty, clipped, contributions: null, plannedStep: null, realizedStep: null, suppressedByClip: false };
  }
  const plannedStep = base * (input.ePrev - input.ePrevUsed);
  const realizedStep = difficulty - input.prevDifficulty;
  const suppressedByClip = Math.abs(plannedStep) >= cfg.eps_D && Math.abs(realizedStep) < cfg.eps_D;
  return { base, difficulty, clipped, contributions: { e: plannedStep }, plannedStep, realizedStep, suppressedByClip };
}
