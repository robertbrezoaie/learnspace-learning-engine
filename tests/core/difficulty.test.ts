// Ported from learnspace-sim v1.0 (commit 05f70f7), tests/difficulty.test.ts. Only import paths changed.
// Test 5 (SIMULATION_SPEC.md section 14): difficulty.
import { describe, expect, it } from 'vitest';
import { curriculumBase, difficultyDecision, type DifficultyInput } from '../../src/core/difficulty.ts';
import { loadAlgorithmConfig } from '../support/simConfig.ts';

const cfg = loadAlgorithmConfig().difficulty;

function input(over: Partial<DifficultyInput>): DifficultyInput {
  return { rule: 'DDA-E', session: 1, sessions: 20, firstTaskOfSession: false, ePrev: 0, ePrevUsed: 0, prevDifficulty: 2, ...over };
}

describe('difficulty', () => {
  it('rises from 2 to 4 over the semester', () => {
    expect(curriculumBase(1, 20, cfg)).toBe(2);
    expect(curriculumBase(20, 20, cfg)).toBe(4);
    expect(curriculumBase(11, 20, cfg)).toBeCloseTo(2 + 20 / 19, 12);
  });

  it('reproduces hand-computed values of clip(base * (1 + e), 1, 5)', () => {
    expect(difficultyDecision(input({ ePrev: 0.3 }), cfg).difficulty).toBeCloseTo(2.6, 12);
    const high = difficultyDecision(input({ session: 20, ePrev: 0.5, ePrevUsed: 0.5, prevDifficulty: 5 }), cfg);
    expect(high.difficulty).toBe(5);
    expect(high.clipped).toBe(true);
    const low = difficultyDecision(input({ ePrev: -0.8 }), cfg);
    expect(low.difficulty).toBe(1);
    expect(low.clipped).toBe(true);
  });

  it('uses the curriculum only under STATIC and never explains it', () => {
    const d = difficultyDecision(input({ rule: 'STATIC', session: 20, ePrev: 0.9 }), cfg);
    expect(d.difficulty).toBe(4);
    expect(d.contributions).toBeNull();
  });

  it('gives the step contribution {e: base * (e_{t-1} - e_{t-2})} within a session', () => {
    const d = difficultyDecision(input({ ePrev: 0.3, ePrevUsed: 0.1, prevDifficulty: 2.2 }), cfg);
    expect(d.contributions?.e).toBeCloseTo(0.4, 12);
    expect(d.plannedStep).toBeCloseTo(0.4, 12);
    expect(d.realizedStep).toBeCloseTo(0.4, 12);
    expect(d.suppressedByClip).toBe(false);
  });

  it('never explains the first task of a session', () => {
    const d = difficultyDecision(input({ firstTaskOfSession: true, ePrev: -0.4 }), cfg);
    expect(d.difficulty).toBeCloseTo(1.2, 12);
    expect(d.contributions).toBeNull();
    expect(d.plannedStep).toBeNull();
  });

  it('marks suppressed_by_clip when the planned step is material but the clip removes it', () => {
    // session 20: base 4; previous D = clip(4 * 1.3) = 5; now clip(4 * 1.5) = 5
    const d = difficultyDecision(input({ session: 20, ePrev: 0.5, ePrevUsed: 0.3, prevDifficulty: 5 }), cfg);
    expect(d.plannedStep).toBeCloseTo(0.8, 12);
    expect(d.realizedStep).toBe(0);
    expect(d.suppressedByClip).toBe(true);
  });
});
