// Storage used by the engine. Implemented with Supabase in functions/learn/store.ts
// and in memory in tests/support/memoryStore.ts. Rows mirror the tables of
// migrations/20261023120000_adaptive_engine.sql.

import type { Arm } from '../core/types.ts';
import type { Posterior } from '../core/bandit/allocator.ts';
import type { Band } from '../domain/types.ts';
import type { GradableQuestion } from '../grading/grader.ts';
import type { BankItem } from '../pedagogy/selection.ts';
import type { CallLogger } from '../llm/call.ts';

export interface LearnerRow {
  user_id: string;
  learner_id: string;
  grade_band: Band | null;
  adaptive: boolean;
}

export interface SessionRow {
  id: string;
  learner_id: string;
  session_index: number;
  planned_tasks: number;
  absent_slots_before: number;
  adaptive: boolean;
  grade_band: Band;
  started_at: string;
  ended_at: string | null;
  quit_early: boolean;
}

export type AttemptStep = 'question' | 'feedback' | 'done' | 'quit';
export type GraderStatus = 'ok' | 'deterministic' | 'failed';

export interface AttemptRow {
  id: string;
  learner_id: string;
  session_id: string;
  task_in_session: number;
  task_id: string;
  task_version: number;
  task_level: number;
  difficulty_used: number;
  e_used: number;
  step: AttemptStep;
  created_at: string;
  shown_at: string | null;
  first_answer_at: string | null;
  rt_ms: number | null;
  first_answer_text: string | null;
  first_score: number | null;
  first_grader_status: GraderStatus | null;
  first_misconception: string | null;
  first_correct: boolean | null;
  dont_know: boolean | null;
  feedback_arm: Arm | null;
  feedback_shown_at: string | null;
  retry_answer_at: string | null;
  retry_answer_text: string | null;
  retry_score: number | null;
  retry_grader_status: GraderStatus | null;
  retry_correct: boolean | null;
  retry_dont_know: boolean | null;
  multiplier: number | null;
  xp_awarded: number | null;
  u: number | null;
  b: number | null;
  e: number | null;
  completed_at: string | null;
}

export interface FeedbackDecisionRow {
  id: string;
  attempt_id: string;
  half: 'random' | 'thompson';
  arm: Arm;
  delivered_arm: Arm;
  propensity: number;
  propensities: Record<Arm, number>;
  thompson_probs: Record<Arm, number>;
  posterior_snapshot: Posterior;
  tutor_status: 'ok' | 'regenerated_ok' | 'leak_suspected' | 'failed' | 'not_needed';
  feedback_text: string | null;
  llm_call_id: string | null;
  reward: 0 | 1 | null;
  bandit_updated: boolean;
  excluded_reason: string | null;
  core_commit: string;
}

export interface AdaptiveDecisionRow {
  attempt_id: string;
  output: 'reward' | 'difficulty';
  delta: number | null;
  contributions: Record<string, number> | null;
  multiplier: number | null;
  difficulty: number | null;
  clipped: boolean | null;
  suppressed_by_clip: boolean;
  explained: boolean;
  factors: string[] | null;
  shares: number[] | null;
  text: string | null;
}

export type BankQuestion = BankItem & GradableQuestion;

export interface XpAward {
  xp_gained: number;
  coins_gained: number;
  streak_days: number;
  level_up: boolean;
  new_level: number;
  new_badges: string[];
}

export interface NewSession {
  learner_id: string;
  session_index: number;
  planned_tasks: number;
  absent_slots_before: number;
  adaptive: boolean;
  grade_band: Band;
}

export type NewAttempt = Pick<
  AttemptRow,
  'learner_id' | 'session_id' | 'task_in_session' | 'task_id' | 'task_version' | 'task_level' | 'difficulty_used' | 'e_used'
>;

export interface Store {
  getLearner(userId: string): Promise<LearnerRow | null>;
  getBank(): Promise<BankQuestion[]>;

  /** All sessions of the learner, by session_index. */
  getSessions(learnerId: string): Promise<SessionRow[]>;
  /** Fails (returns null) when the learner already has an open session. */
  createSession(s: NewSession): Promise<SessionRow | null>;
  endSession(sessionId: string, quitEarly: boolean): Promise<void>;

  /** All attempts of the learner, by session then task. */
  getAttempts(learnerId: string): Promise<AttemptRow[]>;
  insertAttempt(a: NewAttempt): Promise<AttemptRow>;
  /** Applies the patch only if the row is still at `expectedStep`; returns the new row, or null if it was not. */
  updateAttempt(id: string, patch: Partial<AttemptRow>, expectedStep?: AttemptStep): Promise<AttemptRow | null>;
  /** Sets shown_at (or feedback_shown_at) only if it is still null. */
  markShown(id: string, field: 'shown_at' | 'feedback_shown_at', at: string): Promise<void>;

  readPosterior(): Promise<Posterior>;
  insertFeedbackDecision(d: Omit<FeedbackDecisionRow, 'id' | 'reward' | 'bandit_updated'>): Promise<FeedbackDecisionRow>;
  getFeedbackDecision(attemptId: string): Promise<FeedbackDecisionRow | null>;
  /** finalize_feedback(): records the reward once and updates the bandit when `update` is true. */
  finalizeFeedback(decisionId: string, reward: 0 | 1 | null, excluded: string | null, update: boolean): Promise<boolean>;

  insertAdaptiveDecision(d: AdaptiveDecisionRow): Promise<void>;
  getAdaptiveDecision(attemptId: string, output: 'reward' | 'difficulty'): Promise<AdaptiveDecisionRow | null>;

  hasConsent(learnerId: string, version: string): Promise<boolean>;
  /** Stores parental consent and learner assent, both with the text version and the time. */
  recordConsent(learnerId: string, version: string): Promise<void>;
  /** delete_learner_data(): deletes the learner and everything that references them, then a fresh learner row. */
  deleteLearnerData(userId: string): Promise<void>;

  llmLogger(sessionId: string): CallLogger;
  /** XP, level, points, coins, streak and badges, as submit-answer does. */
  awardXp(userId: string, xp: number): Promise<XpAward>;
}
