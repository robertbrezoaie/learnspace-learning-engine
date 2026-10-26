// Copied unchanged from learnspace-sim (https://github.com/robertbrezoaie/learnspace-sim),
// tag v1.0, commit 05f70f7, file src/core/templates.ts. Do not edit: the paper's results describe this code.
// Integrity: tests/core/provenance.test.ts checks the body below against core/PROVENANCE.json.
// --- end provenance header ---
// English text fragments of learner-facing explanations (SIMULATION_SPEC.md section 6.7).

import type { Direction, Factor, Output } from './types.ts';

export const FRAMES: Record<Output, Record<Direction, string>> = {
  difficulty: {
    up: 'The next tasks are a little harder because {reasons}.',
    down: 'The next tasks are a little easier because {reasons}.',
  },
  reward: {
    up: 'You earned extra XP because {reasons}.',
    down: 'Your XP bonus is smaller this time because {reasons}.',
  },
};

/** Reason fragment by factor and by the sign of its contribution. */
export const REASONS: Record<Factor, { positive: string; negative: string }> = {
  e: { positive: 'you have been more active lately', negative: 'you have been less active lately' },
  u: { positive: 'your mastery of the topic keeps growing', negative: 'the topic is still new for you' },
  b: { positive: 'you are working more fluently than usual', negative: 'the last questions took you longer than usual' },
};

export interface NamedFactor {
  factor: Factor;
  contribution: number;
}

/** Fills the frame of (output, direction) with one or two reason fragments joined by " and ". */
export function renderExplanation(output: Output, direction: Direction, factors: readonly NamedFactor[]): string {
  const reasons = factors
    .map((f) => (f.contribution >= 0 ? REASONS[f.factor].positive : REASONS[f.factor].negative))
    .join(' and ');
  return FRAMES[output][direction].replace('{reasons}', reasons);
}
