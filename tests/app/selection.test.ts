import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateBank } from '../../src/domain/questionSchema.ts';
import { levelOf, TIER_LEVEL } from '../../src/domain/levels.ts';
import { selectNext, type BankItem, type SelectionContext } from '../../src/pedagogy/selection.ts';
import { stream } from '../support/simRng.ts';

const bank = validateBank(JSON.parse(readFileSync('src/domain/questions.json', 'utf8')));
const items: BankItem[] = bank.map((q) => ({ id: q.id, domain: q.domain, level: levelOf(q.tier), bands: q.bands }));

function ctx(over: Partial<SelectionContext> = {}): SelectionContext {
  return { band: 'upper', lastAnsweredAt: new Map(), usedInSession: new Set(), previousDomain: null, rng: stream(1, 'sel'), ...over };
}

describe('tier -> level mapping', () => {
  it('maps warmup, easy, hard to 1, 3, 5', () => {
    expect(TIER_LEVEL).toEqual({ warmup: 1, easy: 3, hard: 5 });
  });

  it('puts the 62-question bank on levels 1/3/5 as 10/26/26', () => {
    const counts = items.reduce<Record<number, number>>((m, q) => ({ ...m, [q.level]: (m[q.level] ?? 0) + 1 }), {});
    expect(counts).toEqual({ 1: 10, 3: 26, 5: 26 });
  });
});

describe('selectNext', () => {
  it('picks the level closest to D_t', () => {
    expect(selectNext(items, 1.2, ctx())!.level).toBe(1);
    expect(selectNext(items, 3.4, ctx())!.level).toBe(3);
    expect(selectNext(items, 4.1, ctx())!.level).toBe(5);
  });

  it('sends a tie to the lower level (D = 2 -> 1, D = 4 -> 3)', () => {
    expect(selectNext(items, 2, ctx())!.level).toBe(1);
    expect(selectNext(items, 4, ctx())!.level).toBe(3);
  });

  it('prefers an unanswered question at another level over a repeat at the closest level', () => {
    const warmups = items.filter((q) => q.level === 1);
    const seen = new Map(warmups.map((q, i) => [q.id, 1000 + i]));
    expect(selectNext(items, 1, ctx({ lastAnsweredAt: seen }))!.level).toBe(3);
  });

  it('avoids the previous domain when possible', () => {
    for (let i = 0; i < 50; i++) {
      const pick = selectNext(items, 3, ctx({ previousDomain: 'algorithms', rng: stream(i, 'dom') }))!;
      expect(pick.domain).not.toBe('algorithms');
    }
  });

  it('repeats the question answered longest ago once everything has been seen', () => {
    const seen = new Map(items.map((q, i) => [q.id, 10_000 + i]));
    const oldestLevel3 = items.filter((q) => q.level === 3)[0];
    seen.set(oldestLevel3.id, 1);
    expect(selectNext(items, 3, ctx({ lastAnsweredAt: seen }))!.id).toBe(oldestLevel3.id);
  });

  it('respects the grade band (two hard questions are upper only)', () => {
    const upperOnly = new Set(items.filter((q) => !q.bands.includes('lower')).map((q) => q.id));
    expect(upperOnly.size).toBe(2);
    for (let i = 0; i < 200; i++) {
      expect(upperOnly.has(selectNext(items, 5, ctx({ band: 'lower', rng: stream(i, 'band') }))!.id)).toBe(false);
    }
  });

  it('fills a first session of 12 at D = 2 with the 10 warmups, then level 3, without repeats', () => {
    const used = new Set<string>();
    let previousDomain: BankItem['domain'] | null = null;
    const levels: number[] = [];
    for (let t = 0; t < 12; t++) {
      const q: BankItem = selectNext(items, 2, ctx({ usedInSession: used, previousDomain, rng: stream(t, 'session') }))!;
      used.add(q.id);
      previousDomain = q.domain;
      levels.push(q.level);
    }
    expect(used.size).toBe(12);
    expect(levels).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 3, 3]);
  });

  it('returns null when the pool is empty', () => {
    expect(selectNext([], 3, ctx())).toBeNull();
  });
});
