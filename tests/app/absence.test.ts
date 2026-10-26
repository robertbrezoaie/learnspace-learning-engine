import { describe, expect, it } from 'vitest';
import { calendarWeek, missedSessions } from '../../src/learner/absence.ts';

const d = (s: string) => new Date(s);

describe('missed sessions by calendar week', () => {
  it('starts weeks on Monday (UTC)', () => {
    expect(calendarWeek(d('2026-10-25T23:59:59Z'))).toBe(calendarWeek(d('2026-10-19T00:00:00Z')));
    expect(calendarWeek(d('2026-10-26T00:00:00Z'))).toBe(calendarWeek(d('2026-10-25T23:59:59Z')) + 1);
  });

  it('counts the full weeks between two sessions', () => {
    expect(missedSessions(null, d('2026-10-23T10:00:00Z'))).toBe(0);
    expect(missedSessions(d('2026-10-23T10:00:00Z'), d('2026-10-23T18:00:00Z'))).toBe(0); // same week
    expect(missedSessions(d('2026-10-23T10:00:00Z'), d('2026-10-26T10:00:00Z'))).toBe(0); // next week
    expect(missedSessions(d('2026-10-23T10:00:00Z'), d('2026-11-03T10:00:00Z'))).toBe(1);
    expect(missedSessions(d('2026-10-23T10:00:00Z'), d('2026-11-23T10:00:00Z'))).toBe(4);
  });
});
