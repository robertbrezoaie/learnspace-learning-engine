// Copied from learnspace-sim v1.0 (commit 05f70f7), tests/helpers.ts.
import type { Observation } from '../../src/core/types.ts';

export function obs(firstCorrect: boolean, rtSeconds: number, dontKnow = false): Observation {
  return {
    session: 1,
    taskInSession: 1,
    plannedTasks: 10,
    difficulty: 3,
    firstCorrect: dontKnow ? false : firstCorrect,
    dontKnow,
    rtSeconds,
    arm: null,
    retryCorrect: null,
    retryDontKnow: null,
  };
}
