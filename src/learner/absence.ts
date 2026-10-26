// Missed sessions (LEARNSPACE_RESEARCH_UPDATE.md sections 5 and 12.1).
// Rule: one session per calendar week is planned; every full calendar week (Monday to Sunday, UTC)
// with no session between the previous session and the new one counts as one missed session,
// which adds planned_tasks activity slots of 0 before the new session's first task.

const WEEK_MS = 7 * 24 * 3600 * 1000;
// 1970-01-05 was a Monday
const MONDAY_EPOCH_MS = Date.UTC(1970, 0, 5);

export function calendarWeek(at: Date): number {
  return Math.floor((at.getTime() - MONDAY_EPOCH_MS) / WEEK_MS);
}

export function missedSessions(previousStart: Date | null, now: Date): number {
  if (!previousStart) return 0;
  return Math.max(0, calendarWeek(now) - calendarWeek(previousStart) - 1);
}
