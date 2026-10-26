// Ported from learnspace-sim v1.0 (commit 05f70f7), tests/templates.test.ts. Only import paths changed.
// Test 7 (SIMULATION_SPEC.md section 14): templates.
import { describe, expect, it } from 'vitest';
import { renderExplanation } from '../../src/core/templates.ts';
import { FACTORS, type Direction, type Output } from '../../src/core/types.ts';

describe('templates', () => {
  it('produces a complete sentence for every (output, direction, factor) and for every factor pair', () => {
    for (const output of ['reward', 'difficulty'] as Output[]) {
      for (const direction of ['up', 'down'] as Direction[]) {
        const sign = direction === 'up' ? 1 : -1;
        const sets = [...FACTORS.map((f) => [f]), ['u', 'b'], ['u', 'e'], ['b', 'e']] as (typeof FACTORS)[number][][];
        for (const set of sets) {
          const text = renderExplanation(output, direction, set.map((factor) => ({ factor, contribution: sign * 0.3 })));
          expect(text).not.toMatch(/[{}]/);
          expect(text).toMatch(/^[A-Z].* because .+\.$/);
          if (set.length === 2) expect(text).toContain(' and ');
        }
      }
    }
  });

  it('uses the fragment that matches the sign of the contribution', () => {
    expect(renderExplanation('reward', 'down', [{ factor: 'b', contribution: -0.2 }])).toBe(
      'Your XP bonus is smaller this time because the last questions took you longer than usual.',
    );
    expect(renderExplanation('reward', 'up', [{ factor: 'u', contribution: 0.3 }, { factor: 'e', contribution: 0.25 }])).toBe(
      'You earned extra XP because your mastery of the topic keeps growing and you have been more active lately.',
    );
  });
});
