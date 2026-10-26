// Copied unchanged from learnspace-sim (https://github.com/robertbrezoaie/learnspace-sim),
// tag v1.0, commit 05f70f7, file src/core/types.ts. Do not edit: the paper's results describe this code.
// Integrity: tests/core/provenance.test.ts checks the body below against core/PROVENANCE.json.
// --- end provenance header ---
// Shared types of the algorithm under test (SIMULATION_SPEC.md section 6).
// Everything in src/core sees only observable data; hidden learner state never appears here.

/** A source of uniform numbers in [0, 1). Injected everywhere; the core never creates randomness. */
export interface Rng {
  next(): number;
}

export const ARMS = ['plain', 'hint', 'example'] as const;
export type Arm = (typeof ARMS)[number];

/** The three normalised inputs: u = mastery (alpha), b = response behaviour (beta), e = engagement change (gamma). */
export const FACTORS = ['u', 'b', 'e'] as const;
export type Factor = (typeof FACTORS)[number];

export type Output = 'reward' | 'difficulty';
export type Direction = 'up' | 'down';

/** One task as the system observed it (section 6.1). */
export interface Observation {
  session: number;
  taskInSession: number;
  plannedTasks: number;
  difficulty: number; // D used for this task
  firstCorrect: boolean; // observed (graded) result: score >= 2
  dontKnow: boolean;
  rtSeconds: number;
  arm: Arm | null; // feedback given after a mistake, otherwise null
  retryCorrect: boolean | null;
  retryDontKnow: boolean | null;
}

/** Input signals, each in [-1, 1]; 0 means neutral / no evidence (section 6.2). */
export interface Signals {
  u: number;
  b: number;
  e: number;
}

/** Weighted contribution of each factor to one decision. A factor that is not an input of the output is absent. */
export type Contributions = Partial<Record<Factor, number>>;

/** configs/algorithm.default.json without its documentation keys. */
export interface AlgorithmConfig {
  signals: {
    N_u: number;
    N_b: number;
    B_min: number;
    rt_sd_floor: number;
    H_s: number;
    H_l: number;
    E_min: number;
    e_denominator_floor: number;
    activity_values: { attempted: number; dont_know: number; quit_slot: number; absent_slot: number };
  };
  reward: {
    alpha: number;
    beta: number;
    gamma: number;
    lambda_r: number;
    m_min: number;
    m_max: number;
    eps_r: number;
  };
  gamification: { baseXP: number; difficultyMultiplier: number };
  difficulty: {
    D_min: number;
    D_max: number;
    eps_D: number;
    curriculum: { start: number; end: number };
  };
  explanation: { delta_tie: number };
  bandit: {
    arms: string[];
    random_share: number;
    prior: { a: number; b: number };
    ts_mode: 'sample' | 'probs';
    draws: number;
    ctx: { u_threshold: number };
  };
}

export function clip(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
