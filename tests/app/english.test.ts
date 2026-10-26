// MyApp runs in English (Robert, 2026-10-24): the bank is a translation of pit-study's, and the prompts are "en-v1".
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GRADER_SYSTEM, graderSystem } from '../../src/grading/prompts.ts';
import { tutorSystem } from '../../src/pedagogy/prompts.ts';
import { isLeaky } from '../../src/pedagogy/leakage.ts';
import { env } from '../../src/llm/env.ts';

const ROMANIAN = /[ăâîșțşţ]|Romanian/;
const load = (f: string) => JSON.parse(readFileSync(`src/domain/${f}`, 'utf8')) as Record<string, unknown>[];

describe('English question bank', () => {
  const en = load('questions.json');
  const ro = load('questions.ro.json');

  it('has the same questions, tiers, bands, rubric levels and misconception tags as the Romanian original', () => {
    const shape = (q: Record<string, unknown>) => ({
      id: q.id,
      domain: q.domain,
      tier: q.tier,
      bands: q.bands,
      rubric: Object.keys(q.rubric as object),
      tags: (q.misconceptions as { tag: string }[]).map((m) => m.tag),
    });
    expect(en.map(shape)).toEqual(ro.map(shape));
  });

  it('contains no Romanian text', () => {
    for (const q of en) expect(JSON.stringify(q), String(q.id)).not.toMatch(/[ăâîșțşţ]/);
  });
});

describe('English prompts', () => {
  it('is the default prompt version', () => {
    expect(env.promptVersion).toBe('en-v1');
  });

  it('asks the grader and the tutor for English and keeps pit-study\'s v1 prompt unchanged', () => {
    expect(graderSystem('en-v1')).not.toMatch(ROMANIAN);
    expect(graderSystem('en-v1')).toContain('not mainly in English');
    for (const kind of ['hint', 'example'] as const) {
      expect(tutorSystem('en-v1', kind)).not.toMatch(ROMANIAN);
      expect(tutorSystem('en-v1', kind)).toContain('Write in English.');
    }
    expect(GRADER_SYSTEM.v1).toContain('Romanian schoolchildren');
    expect(tutorSystem('v1', 'hint')).toContain('Write in Romanian');
  });
});

describe('leakage guard on English text', () => {
  const ref = 'The loop stops too early: the condition is i < 100 instead of i <= 100, or range(1, 100) instead of range(1, 101).';

  it('flags a hint that repeats the reference answer and passes one that does not', () => {
    expect(isLeaky(ref, 'The loop stops too early because the condition should include 100, so change range to stop later.')).toBe(true);
    expect(isLeaky(ref, 'Think about which number should be printed last. Check the very last repetition.')).toBe(false);
  });

  it('ignores English function words', () => {
    expect(isLeaky('this would have been there', 'this would have been there')).toBe(false);
  });
});
