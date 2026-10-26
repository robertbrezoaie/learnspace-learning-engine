// In-memory Store for engine tests. Mirrors the semantics of the SQL schema that the engine relies on:
// one open session per learner, step compare-and-set, shown_at set once, finalize_feedback once.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Posterior } from '../../src/core/bandit/allocator.ts';
import { levelOf } from '../../src/domain/levels.ts';
import { validateBank } from '../../src/domain/questionSchema.ts';
import type { LlmCallRow } from '../../src/llm/call.ts';
import type {
  AdaptiveDecisionRow,
  AttemptRow,
  AttemptStep,
  BankQuestion,
  FeedbackDecisionRow,
  LearnerRow,
  NewAttempt,
  NewSession,
  SessionRow,
  Store,
  XpAward,
} from '../../src/engine/store.ts';

export function loadBank(): BankQuestion[] {
  const raw = JSON.parse(readFileSync('src/domain/questions.json', 'utf8'));
  return validateBank(raw).map((q) => ({ ...q, level: levelOf(q.tier), version: 1 }));
}

export class MemoryStore implements Store {
  learners: LearnerRow[] = [];
  sessions: SessionRow[] = [];
  attempts: AttemptRow[] = [];
  decisions: (FeedbackDecisionRow & { finalized: boolean })[] = [];
  adaptive: AdaptiveDecisionRow[] = [];
  llmCalls: (LlmCallRow & { session_id: string })[] = [];
  posterior: Posterior = { plain: { a: 1, b: 1 }, hint: { a: 1, b: 1 }, example: { a: 1, b: 1 } };
  xp = new Map<string, number>();
  consents: { learner_id: string; kind: string; version: string }[] = [];
  private readonly bank = loadBank();

  constructor(private readonly clock: () => Date) {}

  addLearner(over: Partial<LearnerRow> = {}): LearnerRow {
    const l: LearnerRow = { user_id: randomUUID(), learner_id: randomUUID(), grade_band: 'upper', adaptive: true, ...over };
    this.learners.push(l);
    return l;
  }

  async getLearner(userId: string) {
    return this.learners.find((l) => l.user_id === userId) ?? null;
  }
  async getBank() {
    return this.bank;
  }
  async getSessions(learnerId: string) {
    return this.sessions.filter((s) => s.learner_id === learnerId).sort((a, b) => a.session_index - b.session_index);
  }
  async createSession(s: NewSession) {
    if (this.sessions.some((x) => x.learner_id === s.learner_id && x.ended_at === null)) return null;
    const row: SessionRow = { ...s, id: randomUUID(), started_at: this.clock().toISOString(), ended_at: null, quit_early: false };
    this.sessions.push(row);
    return row;
  }
  async endSession(id: string, quitEarly: boolean) {
    const s = this.sessions.find((x) => x.id === id)!;
    s.ended_at = this.clock().toISOString();
    s.quit_early = quitEarly;
  }
  async getAttempts(learnerId: string) {
    const order = new Map(this.sessions.map((s) => [s.id, s.session_index]));
    return this.attempts
      .filter((a) => a.learner_id === learnerId)
      .sort((a, b) => order.get(a.session_id)! - order.get(b.session_id)! || a.task_in_session - b.task_in_session)
      .map((a) => ({ ...a }));
  }
  async insertAttempt(a: NewAttempt) {
    if (this.attempts.some((x) => x.session_id === a.session_id && x.task_in_session === a.task_in_session)) {
      throw new Error('unique violation: (session_id, task_in_session)');
    }
    const row: AttemptRow = {
      ...a,
      id: randomUUID(),
      step: 'question',
      created_at: this.clock().toISOString(),
      shown_at: null,
      first_answer_at: null,
      rt_ms: null,
      first_answer_text: null,
      first_score: null,
      first_grader_status: null,
      first_misconception: null,
      first_correct: null,
      dont_know: null,
      feedback_arm: null,
      feedback_shown_at: null,
      retry_answer_at: null,
      retry_answer_text: null,
      retry_score: null,
      retry_grader_status: null,
      retry_correct: null,
      retry_dont_know: null,
      multiplier: null,
      xp_awarded: null,
      u: null,
      b: null,
      e: null,
      completed_at: null,
    };
    this.attempts.push(row);
    return { ...row };
  }
  async updateAttempt(id: string, patch: Partial<AttemptRow>, expectedStep?: AttemptStep) {
    const a = this.attempts.find((x) => x.id === id);
    if (!a || (expectedStep && a.step !== expectedStep)) return null;
    Object.assign(a, patch);
    return { ...a };
  }
  async markShown(id: string, field: 'shown_at' | 'feedback_shown_at', at: string) {
    const a = this.attempts.find((x) => x.id === id)!;
    if (a[field] === null) a[field] = at;
  }
  async readPosterior() {
    return structuredClone(this.posterior);
  }
  async insertFeedbackDecision(d: Omit<FeedbackDecisionRow, 'id' | 'reward' | 'bandit_updated'>) {
    if (this.decisions.some((x) => x.attempt_id === d.attempt_id)) throw new Error('unique violation: attempt_id');
    const row = { ...d, id: randomUUID(), reward: null, bandit_updated: false, finalized: false };
    this.decisions.push(row);
    return row;
  }
  async getFeedbackDecision(attemptId: string) {
    return this.decisions.find((d) => d.attempt_id === attemptId) ?? null;
  }
  async finalizeFeedback(id: string, reward: 0 | 1 | null, excluded: string | null, update: boolean) {
    const d = this.decisions.find((x) => x.id === id);
    if (!d || d.finalized) return false;
    d.finalized = true;
    d.reward = reward;
    d.excluded_reason = d.excluded_reason ?? excluded;
    d.bandit_updated = update;
    if (update && reward !== null) {
      this.posterior[d.arm].a += reward;
      this.posterior[d.arm].b += 1 - reward;
    }
    return true;
  }
  async insertAdaptiveDecision(d: AdaptiveDecisionRow) {
    if (this.adaptive.some((x) => x.attempt_id === d.attempt_id && x.output === d.output)) {
      throw new Error('unique violation: (attempt_id, output)');
    }
    this.adaptive.push(d);
  }
  async getAdaptiveDecision(attemptId: string, output: 'reward' | 'difficulty') {
    return this.adaptive.find((d) => d.attempt_id === attemptId && d.output === output) ?? null;
  }
  async hasConsent(learnerId: string, version: string) {
    const kinds = new Set(this.consents.filter((c) => c.learner_id === learnerId && c.version === version).map((c) => c.kind));
    return kinds.has('parental_consent') && kinds.has('learner_assent');
  }
  async recordConsent(learnerId: string, version: string) {
    for (const kind of ['parental_consent', 'learner_assent']) this.consents.push({ learner_id: learnerId, kind, version });
  }
  async deleteLearnerData(userId: string) {
    const l = this.learners.find((x) => x.user_id === userId)!;
    const sessions = new Set(this.sessions.filter((s) => s.learner_id === l.learner_id).map((s) => s.id));
    const attempts = new Set(this.attempts.filter((a) => a.learner_id === l.learner_id).map((a) => a.id));
    this.decisions = this.decisions.filter((d) => !attempts.has(d.attempt_id));
    this.adaptive = this.adaptive.filter((d) => !attempts.has(d.attempt_id));
    this.attempts = this.attempts.filter((a) => !attempts.has(a.id));
    this.llmCalls = this.llmCalls.filter((c) => !sessions.has(c.session_id));
    this.sessions = this.sessions.filter((s) => !sessions.has(s.id));
    this.consents = this.consents.filter((c) => c.learner_id !== l.learner_id);
    this.learners = this.learners.filter((x) => x.user_id !== userId);
    this.learners.push({ user_id: userId, learner_id: randomUUID(), grade_band: null, adaptive: true });
  }

  llmLogger(sessionId: string) {
    return async (row: LlmCallRow) => {
      this.llmCalls.push({ ...row, session_id: sessionId });
      return String(this.llmCalls.length);
    };
  }
  async awardXp(userId: string, xp: number): Promise<XpAward> {
    const total = (this.xp.get(userId) ?? 0) + xp;
    this.xp.set(userId, total);
    return { xp_gained: xp, coins_gained: 0, streak_days: 1, level_up: false, new_level: 1, new_badges: [] };
  }
}
