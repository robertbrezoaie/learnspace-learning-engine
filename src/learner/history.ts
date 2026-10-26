// Rebuilds the learner's signals u, b, e from the logs (LEARNSPACE_RESEARCH_UPDATE.md section 5).
// The tracker is fed in slot order: per session, the absent slots for missed sessions first,
// then one slot per answered task, then one quit slot per planned task left when the session was quit.

import type { AlgorithmConfig, Signals } from '../core/types.ts';
import { SignalTracker } from '../core/signals.ts';

export interface TaskRecord {
  answered: boolean; // the first answer was submitted
  graded: boolean; // the first answer has a score (the grader did not fail)
  firstCorrect: boolean;
  dontKnow: boolean;
  rtMs: number;
}

export interface SessionRecord {
  absentSlotsBefore: number;
  plannedTasks: number;
  quitEarly: boolean;
  tasks: TaskRecord[]; // in task order
}

/** Smallest response time used for ln(rt): keeps the log finite for a same-millisecond submit. */
const MIN_RT_SECONDS = 0.001;

export function replay(sessions: readonly SessionRecord[], cfg: AlgorithmConfig['signals']): SignalTracker {
  const t = new SignalTracker(cfg);
  for (const s of sessions) {
    t.recordSlots(s.absentSlotsBefore, cfg.activity_values.absent_slot);
    let answered = 0;
    for (const task of s.tasks) {
      if (!task.answered) continue;
      answered++;
      if (task.graded) {
        t.recordTask({
          session: 0,
          taskInSession: 0,
          plannedTasks: s.plannedTasks,
          difficulty: 0,
          firstCorrect: task.firstCorrect,
          dontKnow: task.dontKnow,
          rtSeconds: Math.max(task.rtMs / 1000, MIN_RT_SECONDS),
          arm: null,
          retryCorrect: null,
          retryDontKnow: null,
        });
      } else {
        // no score: the slot counts as activity, but there is no evidence for u or b
        t.recordSlot(task.dontKnow ? cfg.activity_values.dont_know : cfg.activity_values.attempted);
      }
    }
    if (s.quitEarly) t.recordSlots(Math.max(0, s.plannedTasks - answered), cfg.activity_values.quit_slot);
  }
  return t;
}

export function signalsOf(sessions: readonly SessionRecord[], cfg: AlgorithmConfig['signals']): Signals {
  return replay(sessions, cfg).signals();
}
