// The learning loop (LEARNSPACE_RESEARCH_UPDATE.md sections 4–9): one session of planned tasks;
// per task: grade the first answer; after a mistake allocate feedback (TSB), grade the retry and update
// the bandit; then XP with the reward multiplier, the reward explanation, and D_t for the next task.
// All algorithm decisions come from core/ (learnspace-sim v1.0); this file only sequences and logs them.

import type { Arm, Rng } from '../core/types.ts';
import { allocate } from '../core/bandit/allocator.ts';
import { taskXP } from '../core/gamification.ts';
import type { Explanation } from '../core/explain.ts';
import type { LoadedConfig } from '../config/config.ts';
import { difficultyStep, rewardStep } from '../explain/adaptive.ts';
import type { GradeResult } from '../grading/grader.ts';
import { gradeAnswer } from '../grading/grader.ts';
import { generateFeedback, type TutorResult } from '../pedagogy/tutor.ts';
import { selectNext } from '../pedagogy/selection.ts';
import { replay, type SessionRecord } from '../learner/history.ts';
import { missedSessions } from '../learner/absence.ts';
import type { Band } from '../domain/types.ts';
import type { AdaptiveDecisionRow, AttemptRow, BankQuestion, LearnerRow, SessionRow, Store, XpAward } from './store.ts';

export class EngineError extends Error {
  constructor(
    readonly code: 'no_learner' | 'needs_grade_band' | 'needs_consent' | 'no_open_session' | 'not_found' | 'state_mismatch' | 'bank_exhausted',
    readonly status: number,
  ) {
    super(code);
  }
}

export interface EngineDeps {
  store: Store;
  config: LoadedConfig;
  rng: Rng;
  now: () => Date;
  promptVersion: string;
  grade?: typeof gradeAnswer;
  tutor?: typeof generateFeedback;
}

export interface FeedbackView {
  kind: Arm;
  text: string | null;
}

export interface TaskView {
  attempt_id: string;
  session_index: number;
  task_in_session: number;
  planned_tasks: number;
  prompt: string;
  step: 'question' | 'feedback';
  feedback: FeedbackView | null; // step 'feedback' only
  /** Shown at the start of this task when its difficulty step is explained (section 9). */
  difficulty_explanation: string | null;
}

export interface Completion {
  solved: boolean;
  graded: boolean;
  multiplier: number;
  award: XpAward;
  reward_explanation: string | null;
  explanation: string; // the question's model explanation (explanation_ro)
  next: TaskView | null; // null: the session is over
}

export type AnswerResult =
  | { outcome: 'correct' | 'ungraded'; completion: Completion }
  | { outcome: 'mistake'; feedback: FeedbackView; task: TaskView };

export type RetryResult = { outcome: 'correct' | 'incorrect' | 'ungraded'; completion: Completion };

export class Engine {
  private readonly store: Store;
  private readonly cfg: LoadedConfig;
  private readonly grade: typeof gradeAnswer;
  private readonly tutor: typeof generateFeedback;
  private bankCache: BankQuestion[] | null = null;

  constructor(private readonly deps: EngineDeps) {
    this.store = deps.store;
    this.cfg = deps.config;
    this.grade = deps.grade ?? gradeAnswer;
    this.tutor = deps.tutor ?? generateFeedback;
  }

  // ---------- public API ----------

  /** Resumes the open session, or starts the next one with its first task. */
  async start(userId: string): Promise<TaskView | null> {
    const learner = await this.learner(userId);
    if (!learner.grade_band) throw new EngineError('needs_grade_band', 409);
    if (!(await this.store.hasConsent(learner.learner_id, this.cfg.app.consent_version))) {
      throw new EngineError('needs_consent', 409);
    }
    const sessions = await this.store.getSessions(learner.learner_id);
    const open = sessions.find((s) => s.ended_at === null);
    if (open) return this.current(userId);

    const session = await this.store.createSession({
      learner_id: learner.learner_id,
      session_index: sessions.length + 1,
      planned_tasks: this.cfg.app.planned_tasks,
      absent_slots_before: this.absentSlotsBefore(sessions),
      adaptive: learner.adaptive,
      grade_band: learner.grade_band,
    });
    if (!session) return this.current(userId); // a concurrent start won

    const history = await this.history(learner.learner_id);
    const e = replay(history, this.cfg.algorithm.signals).engagementChange();
    const step = difficultyStep(
      { ...this.difficultyBase(session), firstTaskOfSession: true, ePrev: e, ePrevUsed: 0, prevDifficulty: 0 },
      this.cfg.algorithm,
      session.adaptive,
    );
    const attempt = await this.createTask(session, 1, step.decision.difficulty, e, null);
    if (!attempt) {
      await this.store.endSession(session.id, false);
      throw new EngineError('bank_exhausted', 409);
    }
    await this.logDifficulty(attempt.id, step.decision, step.explanation);
    return this.serve(session, attempt);
  }

  /** The current task of the open session, or null when there is none. */
  async current(userId: string): Promise<TaskView | null> {
    const learner = await this.learner(userId);
    const session = (await this.store.getSessions(learner.learner_id)).find((s) => s.ended_at === null);
    if (!session) return null;
    const attempt = (await this.store.getAttempts(learner.learner_id)).find(
      (a) => a.session_id === session.id && (a.step === 'question' || a.step === 'feedback'),
    );
    if (!attempt) return null;
    return this.serve(session, attempt);
  }

  async answer(userId: string, attemptId: string, text: string, dontKnow: boolean): Promise<AnswerResult> {
    const { learner, session, attempt, question } = await this.load(userId, attemptId, 'question');
    const at = this.deps.now();
    const g = await this.grade({
      question,
      text,
      dontKnow,
      band: session.grade_band,
      promptVersion: this.deps.promptVersion,
      log: this.store.llmLogger(session.id),
    });
    const graded = g.status !== 'failed';
    const correct = graded && g.score >= this.cfg.app.correct_min_score;
    const shownAt = attempt.shown_at ?? attempt.created_at;
    const updated = await this.store.updateAttempt(
      attempt.id,
      {
        first_answer_at: at.toISOString(),
        rt_ms: Math.max(0, at.getTime() - new Date(shownAt).getTime()),
        first_answer_text: text,
        first_score: graded ? g.score : null,
        first_grader_status: g.status,
        first_misconception: g.status === 'ok' ? g.misconception : null,
        first_correct: graded ? correct : null,
        dont_know: g.status === 'deterministic' ? g.dontKnow : dontKnow,
        step: correct || !graded ? 'done' : 'feedback',
      },
      'question',
    );
    if (!updated) throw new EngineError('state_mismatch', 409); // a duplicate submit already handled this answer

    if (!graded) return { outcome: 'ungraded', completion: await this.complete(learner, session, updated, question) };
    if (correct) return { outcome: 'correct', completion: await this.complete(learner, session, updated, question) };

    const feedback = await this.giveFeedback(session, updated, question, g);
    const withArm = (await this.store.updateAttempt(updated.id, { feedback_arm: feedback.kind }, 'feedback')) ?? updated;
    return { outcome: 'mistake', feedback, task: await this.serve(session, withArm) };
  }

  async retry(userId: string, attemptId: string, text: string, dontKnow: boolean): Promise<RetryResult> {
    const { learner, session, attempt, question } = await this.load(userId, attemptId, 'feedback');
    const at = this.deps.now();
    // blind grading: the same grader and prompt as the first attempt
    const g = await this.grade({
      question,
      text,
      dontKnow,
      band: session.grade_band,
      promptVersion: this.deps.promptVersion,
      log: this.store.llmLogger(session.id),
    });
    const graded = g.status !== 'failed';
    const correct = graded && g.score >= this.cfg.app.correct_min_score;
    const updated = await this.store.updateAttempt(
      attempt.id,
      {
        retry_answer_at: at.toISOString(),
        retry_answer_text: text,
        retry_score: graded ? g.score : null,
        retry_grader_status: g.status,
        retry_correct: graded ? correct : null,
        retry_dont_know: g.status === 'deterministic' ? g.dontKnow : dontKnow,
        step: 'done',
      },
      'feedback',
    );
    if (!updated) throw new EngineError('state_mismatch', 409);

    const decision = await this.store.getFeedbackDecision(attempt.id);
    if (decision) {
      // reward r = 1 iff the retry is graded correct; a "don't know" scores 0. Only delivered arms update the bandit.
      const reward: 0 | 1 | null = graded ? (correct ? 1 : 0) : null;
      const excluded = !graded ? 'retry_grader_failed' : null;
      const update = graded && decision.delivered_arm === decision.arm && decision.excluded_reason === null;
      await this.store.finalizeFeedback(decision.id, reward, excluded, update);
    }
    const completion = await this.complete(learner, session, updated, question);
    return { outcome: !graded ? 'ungraded' : correct ? 'correct' : 'incorrect', completion };
  }

  /** Records parental consent and the learner's assent for the current consent text (section 10.6). */
  async consent(userId: string): Promise<void> {
    const learner = await this.learner(userId);
    await this.store.recordConsent(learner.learner_id, this.cfg.app.consent_version);
  }

  /** Deletion on request (section 10.7): removes every learning row and starts a new pseudonym. */
  async deleteMyData(userId: string): Promise<void> {
    await this.learner(userId);
    await this.store.deleteLearnerData(userId);
  }

  /** Ends the open session early; the unanswered planned tasks become quit slots for e. */
  async quit(userId: string): Promise<void> {
    const learner = await this.learner(userId);
    const session = (await this.store.getSessions(learner.learner_id)).find((s) => s.ended_at === null);
    if (!session) throw new EngineError('no_open_session', 409);
    for (const a of await this.store.getAttempts(learner.learner_id)) {
      if (a.session_id !== session.id) continue;
      if (a.step !== 'question' && a.step !== 'feedback') continue;
      await this.store.updateAttempt(a.id, { step: 'quit' }, a.step);
      // a mistake left without a retry has no reward: close its decision without updating the bandit
      const d = a.step === 'feedback' ? await this.store.getFeedbackDecision(a.id) : null;
      if (d) await this.store.finalizeFeedback(d.id, null, 'quit', false);
    }
    await this.store.endSession(session.id, true);
  }

  // ---------- task completion ----------

  private async complete(learner: LearnerRow, session: SessionRow, attempt: AttemptRow, question: BankQuestion): Promise<Completion> {
    const graded = attempt.first_grader_status !== 'failed' && attempt.retry_grader_status !== 'failed';
    const solved = attempt.first_correct === true || attempt.retry_correct === true;
    const tracker = replay(await this.history(learner.learner_id), this.cfg.algorithm.signals);
    const signals = tracker.signals();

    // Reward (formula 3). Ungraded tasks get m = 1 and no explanation; the learner never loses XP to a grader failure.
    const reward = rewardStep(signals, this.cfg.algorithm, session.adaptive && graded);
    const xp = taskXP(solved || !graded, attempt.difficulty_used, reward.multiplier, this.cfg.algorithm.gamification);
    const award = await this.store.awardXp(learner.user_id, xp);
    await this.store.insertAdaptiveDecision({
      attempt_id: attempt.id,
      output: 'reward',
      delta: reward.decision.aiReward,
      contributions: reward.decision.contributions as Record<string, number>,
      multiplier: reward.multiplier,
      difficulty: null,
      clipped: null,
      suppressed_by_clip: false,
      ...explanationFields(reward.explanation),
    });
    await this.store.updateAttempt(attempt.id, {
      multiplier: reward.multiplier,
      xp_awarded: xp,
      u: signals.u,
      b: signals.b,
      e: signals.e,
      completed_at: this.deps.now().toISOString(),
    });

    let next: TaskView | null = null;
    if (attempt.task_in_session < session.planned_tasks) {
      const step = difficultyStep(
        {
          ...this.difficultyBase(session),
          firstTaskOfSession: false,
          ePrev: signals.e,
          ePrevUsed: attempt.e_used,
          prevDifficulty: attempt.difficulty_used,
        },
        this.cfg.algorithm,
        session.adaptive,
      );
      const bank = await this.bank();
      const nextAttempt = await this.createTask(
        session,
        attempt.task_in_session + 1,
        step.decision.difficulty,
        signals.e,
        bank.find((q) => q.id === attempt.task_id)?.domain ?? null,
      );
      if (nextAttempt) {
        await this.logDifficulty(nextAttempt.id, step.decision, step.explanation);
        next = await this.serve(session, nextAttempt);
      }
    }
    if (!next) await this.store.endSession(session.id, false);

    return {
      solved,
      graded,
      multiplier: reward.multiplier,
      award,
      reward_explanation: reward.explanation?.text ?? null,
      explanation: question.explanation_ro,
      next,
    };
  }

  // ---------- feedback ----------

  private async giveFeedback(session: SessionRow, attempt: AttemptRow, question: BankQuestion, g: GradeResult): Promise<FeedbackView> {
    // opt-out: plain feedback, no allocation (section 10.8)
    if (!session.adaptive) return { kind: 'plain', text: null };

    const posterior = await this.store.readPosterior();
    const alloc = allocate(posterior, this.cfg.algorithm.bandit.random_share, this.deps.rng, this.cfg.algorithm.bandit.draws);
    let tutor: TutorResult | null = null;
    if (alloc.arm !== 'plain') {
      try {
        tutor = await this.tutor({
          kind: alloc.arm,
          question,
          firstAnswer: attempt.first_answer_text ?? '',
          misconception: g.status === 'ok' ? g.misconception : null,
          band: session.grade_band,
          promptVersion: this.deps.promptVersion,
          log: this.store.llmLogger(session.id),
        });
      } catch {
        tutor = { status: 'failed', text: null, callId: null };
      }
    }
    const failed = tutor !== null && (tutor.status === 'failed' || !tutor.text);
    const delivered: Arm = failed ? 'plain' : alloc.arm;
    await this.store.insertFeedbackDecision({
      attempt_id: attempt.id,
      half: alloc.half,
      arm: alloc.arm,
      delivered_arm: delivered,
      propensity: alloc.propensity,
      propensities: alloc.propensities,
      thompson_probs: alloc.thompsonProbs,
      posterior_snapshot: alloc.posterior,
      tutor_status: tutor === null ? 'not_needed' : failed ? 'failed' : tutor.status,
      feedback_text: failed || tutor === null ? null : tutor.text,
      llm_call_id: tutor?.callId ?? null,
      excluded_reason: failed ? 'tutor_failed' : null,
      core_commit: this.cfg.app.core_commit,
    });
    return { kind: delivered, text: failed || tutor === null ? null : tutor.text };
  }

  // ---------- helpers ----------

  private async learner(userId: string): Promise<LearnerRow> {
    const l = await this.store.getLearner(userId);
    if (!l) throw new EngineError('no_learner', 404);
    return l;
  }

  private async load(userId: string, attemptId: string, step: 'question' | 'feedback') {
    const learner = await this.learner(userId);
    const attempt = (await this.store.getAttempts(learner.learner_id)).find((a) => a.id === attemptId);
    if (!attempt) throw new EngineError('not_found', 404);
    if (attempt.step !== step) throw new EngineError('state_mismatch', 409);
    const session = (await this.store.getSessions(learner.learner_id)).find((s) => s.id === attempt.session_id)!;
    const question = (await this.bank()).find((q) => q.id === attempt.task_id);
    if (!question) throw new EngineError('not_found', 404);
    return { learner, session, attempt, question };
  }

  private async bank(): Promise<BankQuestion[]> {
    this.bankCache ??= await this.store.getBank();
    return this.bankCache;
  }

  /** Learner history in slot order, for the signal replay. */
  private async history(learnerId: string): Promise<SessionRecord[]> {
    const sessions = await this.store.getSessions(learnerId);
    const attempts = await this.store.getAttempts(learnerId);
    return sessions.map((s) => ({
      absentSlotsBefore: s.absent_slots_before,
      plannedTasks: s.planned_tasks,
      quitEarly: s.quit_early,
      tasks: attempts
        .filter((a) => a.session_id === s.id && a.first_answer_at !== null)
        .sort((x, y) => x.task_in_session - y.task_in_session)
        .map((a) => ({
          answered: true,
          graded: a.first_grader_status !== 'failed',
          firstCorrect: a.first_correct === true,
          dontKnow: a.dont_know === true,
          rtMs: a.rt_ms ?? 0,
        })),
    }));
  }

  /** Missed sessions add planned_tasks slots of 0 each before the next session (section 5, e). */
  private absentSlotsBefore(previous: readonly SessionRow[]): number {
    const last = previous.at(-1);
    return missedSessions(last ? new Date(last.started_at) : null, this.deps.now()) * this.cfg.app.planned_tasks;
  }

  /** Curriculum: D_base rises from 2 to 4 over S sessions; sessions after S stay at the end value. */
  private difficultyBase(session: SessionRow) {
    const sessions = this.cfg.app.sessions;
    return {
      rule: session.adaptive ? this.cfg.app.difficulty_rule : ('STATIC' as const),
      session: Math.min(session.session_index, sessions),
      sessions,
    };
  }

  private async createTask(
    session: SessionRow,
    taskInSession: number,
    difficulty: number,
    eUsed: number,
    previousDomain: BankQuestion['domain'] | null,
  ): Promise<AttemptRow | null> {
    const attempts = await this.store.getAttempts(session.learner_id);
    const lastAnsweredAt = new Map<string, number>();
    for (const a of attempts) {
      if (a.first_answer_at) lastAnsweredAt.set(a.task_id, Math.max(lastAnsweredAt.get(a.task_id) ?? 0, Date.parse(a.first_answer_at)));
    }
    const usedInSession = new Set(attempts.filter((a) => a.session_id === session.id).map((a) => a.task_id));
    const pick = selectNext(await this.bank(), difficulty, {
      band: session.grade_band as Band,
      lastAnsweredAt,
      usedInSession,
      previousDomain,
      rng: this.deps.rng,
    });
    if (!pick) return null;
    const q = (await this.bank()).find((x) => x.id === pick.id)!;
    return this.store.insertAttempt({
      learner_id: session.learner_id,
      session_id: session.id,
      task_in_session: taskInSession,
      task_id: q.id,
      task_version: q.version,
      task_level: q.level,
      difficulty_used: difficulty,
      e_used: eUsed,
    });
  }

  private async logDifficulty(attemptId: string, d: ReturnType<typeof difficultyStep>['decision'], ex: Explanation | null) {
    await this.store.insertAdaptiveDecision({
      attempt_id: attemptId,
      output: 'difficulty',
      delta: d.plannedStep,
      contributions: d.contributions as Record<string, number> | null,
      multiplier: null,
      difficulty: d.difficulty,
      clipped: d.clipped,
      suppressed_by_clip: d.suppressedByClip,
      ...explanationFields(ex),
    });
  }

  private async serve(session: SessionRow, attempt: AttemptRow): Promise<TaskView> {
    const now = this.deps.now().toISOString();
    if (attempt.step === 'question') await this.store.markShown(attempt.id, 'shown_at', now);
    let feedback: FeedbackView | null = null;
    if (attempt.step === 'feedback') {
      await this.store.markShown(attempt.id, 'feedback_shown_at', now);
      const d = await this.store.getFeedbackDecision(attempt.id);
      feedback = d ? { kind: d.delivered_arm, text: d.feedback_text } : { kind: 'plain', text: null };
    }
    const question = (await this.bank()).find((q) => q.id === attempt.task_id)!;
    const difficulty = await this.store.getAdaptiveDecision(attempt.id, 'difficulty');
    return {
      attempt_id: attempt.id,
      session_index: session.session_index,
      task_in_session: attempt.task_in_session,
      planned_tasks: session.planned_tasks,
      prompt: question.prompt_ro,
      step: attempt.step === 'feedback' ? 'feedback' : 'question',
      feedback,
      difficulty_explanation: difficulty?.explained ? difficulty.text : null,
    };
  }
}

function explanationFields(ex: Explanation | null): Pick<AdaptiveDecisionRow, 'explained' | 'factors' | 'shares' | 'text'> {
  return ex
    ? { explained: true, factors: ex.factors, shares: ex.shares, text: ex.text }
    : { explained: false, factors: null, shares: null, text: null };
}

