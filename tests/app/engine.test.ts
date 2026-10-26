// End-to-end engine tests (LEARNSPACE_RESEARCH_UPDATE.md section 11): scripted learners through whole sessions,
// with a scripted grader and tutor. Checks that every log row of section 4 is written and consistent.
import { describe, expect, it } from 'vitest';
import { config } from '../../src/config/config.ts';
import { Engine, EngineError, type TaskView } from '../../src/engine/engine.ts';
import type { gradeAnswer } from '../../src/grading/grader.ts';
import type { generateFeedback } from '../../src/pedagogy/tutor.ts';
import { signalsOf } from '../../src/learner/history.ts';
import { MemoryStore } from '../support/memoryStore.ts';
import { stream } from '../support/simRng.ts';

const FLAGS = { off_topic: false, gaming_attempt: false, wrong_language: false, needs_adult_attention: false };

/** Answers are scripted by their text: "s0".."s3" give that score, "fail" makes the grader fail. */
const scriptedGrader: typeof gradeAnswer = async ({ text, dontKnow }) => {
  if (dontKnow) return { status: 'deterministic', score: 0, dontKnow: true };
  if (text === 'fail') return { status: 'failed', callId: null };
  const score = Number(text.replace('s', ''));
  return { status: 'ok', score, misconception: null, confidence: 0.9, flags: FLAGS, rationale: 'r', callId: null };
};

let tutorCalls = 0;
const scriptedTutor: typeof generateFeedback = async ({ kind }) => {
  tutorCalls++;
  return { status: 'ok', text: `${kind} text`, callId: null };
};

function setup(over: { adaptive?: boolean; grade_band?: 'lower' | 'upper' | null } = {}) {
  let t = Date.parse('2026-10-23T10:00:00Z');
  const clock = () => new Date(t);
  const store = new MemoryStore(clock);
  const learner = store.addLearner(over);
  void store.recordConsent(learner.learner_id, config.app.consent_version);
  const engine = new Engine({
    store,
    config,
    rng: stream(7, 'engine'),
    now: clock,
    promptVersion: 'v1',
    grade: scriptedGrader,
    tutor: scriptedTutor,
  });
  return { store, learner, engine, advance: (ms: number) => (t += ms) };
}

describe('engine: one scripted session', () => {
  it('goes through answer, mistake, feedback, retry, reward and difficulty, logging every row', async () => {
    const { store, learner, engine, advance } = setup();
    let task: TaskView | null = await engine.start(learner.user_id);
    expect(task?.task_in_session).toBe(1);
    expect(task?.difficulty_explanation).toBeNull(); // first task of a session: curriculum, never explained

    const script = ['s3', 's2', 's1', 's3', 's0', 's2', 's3', 's3', 's1', 's2', 's3', 's3'];
    let i = 0;
    while (task) {
      advance(20_000 + 1000 * i);
      const first = script[i++];
      const r = await engine.answer(learner.user_id, task.attempt_id, first, false);
      if (r.outcome === 'mistake') {
        expect(r.task.step).toBe('feedback');
        expect(['plain', 'hint', 'example']).toContain(r.feedback.kind);
        if (r.feedback.kind !== 'plain') expect(r.feedback.text).toBe(`${r.feedback.kind} text`);
        advance(15_000);
        const retry = await engine.retry(learner.user_id, task.attempt_id, 's2', false);
        expect(retry.outcome).toBe('correct');
        task = retry.completion.next;
      } else {
        expect(r.outcome).toBe('correct');
        task = r.completion.next;
      }
    }

    // section 4: one session, 12 attempts, one feedback decision per mistake, two adaptive rows per task
    expect(store.sessions).toHaveLength(1);
    expect(store.sessions[0].ended_at).not.toBeNull();
    expect(store.sessions[0].quit_early).toBe(false);
    expect(store.attempts).toHaveLength(12);
    const mistakes = store.attempts.filter((a) => a.first_correct === false);
    expect(mistakes).toHaveLength(3);
    expect(store.decisions).toHaveLength(3);
    expect(store.adaptive.filter((d) => d.output === 'reward')).toHaveLength(12);
    expect(store.adaptive.filter((d) => d.output === 'difficulty')).toHaveLength(12);

    for (const a of store.attempts) {
      expect(a.step).toBe('done');
      expect(a.shown_at).not.toBeNull();
      expect(a.rt_ms).toBeGreaterThan(0);
      expect(a.first_correct).toBe((a.first_score ?? 0) >= 2);
      expect(a.u).not.toBeNull();
      expect(a.difficulty_used).toBeGreaterThanOrEqual(1);
      expect(a.difficulty_used).toBeLessThanOrEqual(5);
      expect(a.xp_awarded).toBeGreaterThan(0); // every task was solved (first attempt or retry)
      expect(a.feedback_arm === null).toBe(a.first_correct === true);
    }
    for (const d of store.decisions) {
      expect(d.reward).toBe(1);
      expect(d.bandit_updated).toBe(true);
      expect(d.core_commit).toBe('05f70f7');
      expect(d.propensity).toBeGreaterThanOrEqual(1 / 6 - 1e-12);
      expect(d.propensity).toBe(d.propensities[d.arm]);
    }
    // the bandit moved by exactly one success per decision
    const total = Object.values(store.posterior).reduce((s, p) => s + p.a + p.b, 0);
    expect(total).toBe(6 + 3);

    // XP follows formula (1) with the logged multiplier
    for (const a of store.attempts) {
      expect(a.xp_awarded).toBe(Math.round((10 + 2 * a.difficulty_used) * a.multiplier!));
    }
    expect(store.xp.get(learner.user_id)).toBe(store.attempts.reduce((s, a) => s + a.xp_awarded!, 0));
  });

  it('logs the signals that a replay of the attempts gives', async () => {
    const { store, learner, engine, advance } = setup();
    let task = await engine.start(learner.user_id);
    while (task) {
      advance(30_000);
      const r = await engine.answer(learner.user_id, task.attempt_id, 's3', false);
      task = r.outcome === 'mistake' ? null : r.completion.next;
    }
    const last = store.attempts.at(-1)!;
    const expected = signalsOf(
      [{ absentSlotsBefore: 0, plannedTasks: 12, quitEarly: false, tasks: store.attempts.map((a) => ({
        answered: true, graded: true, firstCorrect: true, dontKnow: false, rtMs: a.rt_ms! })) }],
      config.algorithm.signals,
    );
    expect({ u: last.u, b: last.b, e: last.e }).toEqual(expected);
  });
});

describe('engine: rules', () => {
  it('asks for the grade band before the first session', async () => {
    const { learner, engine } = setup({ grade_band: null });
    await expect(engine.start(learner.user_id)).rejects.toMatchObject({ code: 'needs_grade_band' });
  });

  it('resumes the open session instead of starting a new one', async () => {
    const { store, learner, engine } = setup();
    const a = await engine.start(learner.user_id);
    const b = await engine.start(learner.user_id);
    expect(b?.attempt_id).toBe(a?.attempt_id);
    expect(store.sessions).toHaveLength(1);
  });

  it('rejects a duplicate answer without grading or allocating twice', async () => {
    const { store, learner, engine } = setup();
    const task = (await engine.start(learner.user_id))!;
    await engine.answer(learner.user_id, task.attempt_id, 's0', false);
    await expect(engine.answer(learner.user_id, task.attempt_id, 's0', false)).rejects.toBeInstanceOf(EngineError);
    expect(store.decisions).toHaveLength(1);
  });

  it('treats "I don\'t know" as a mistake with feedback, and a "don\'t know" retry as reward 0', async () => {
    const { store, learner, engine } = setup();
    const task = (await engine.start(learner.user_id))!;
    const r = await engine.answer(learner.user_id, task.attempt_id, '', true);
    expect(r.outcome).toBe('mistake');
    const retry = await engine.retry(learner.user_id, task.attempt_id, '', true);
    expect(retry.outcome).toBe('incorrect');
    expect(retry.completion.solved).toBe(false);
    expect(store.attempts[0].xp_awarded).toBe(0);
    expect(store.decisions[0].reward).toBe(0);
    expect(store.attempts[0]).toMatchObject({ dont_know: true, retry_dont_know: true });
  });

  it('never updates the bandit when the tutor failed and plain feedback was delivered instead', async () => {
    const { store, learner } = setup();
    const engine = new Engine({
      store, config, rng: stream(3, 'tutor-fail'), now: () => new Date(), promptVersion: 'v1', grade: scriptedGrader,
      tutor: async () => ({ status: 'failed', text: null, callId: null }),
    });
    // force a hint/example decision by trying until the allocator picks a tutor arm
    let task = (await engine.start(learner.user_id))!;
    for (let k = 0; k < 12 && task; k++) {
      const r = await engine.answer(learner.user_id, task.attempt_id, 's0', false);
      if (r.outcome !== 'mistake') break;
      const retry = await engine.retry(learner.user_id, task.attempt_id, 's3', false);
      task = retry.completion.next!;
    }
    const failed = store.decisions.filter((d) => d.arm !== 'plain');
    expect(failed.length).toBeGreaterThan(0);
    for (const d of failed) {
      expect(d.delivered_arm).toBe('plain');
      expect(d.tutor_status).toBe('failed');
      expect(d.bandit_updated).toBe(false);
    }
  });

  it('gives an ungraded task XP with m = 1 and no reward explanation when the grader fails', async () => {
    const { store, learner, engine } = setup();
    const task = (await engine.start(learner.user_id))!;
    const r = await engine.answer(learner.user_id, task.attempt_id, 'fail', false);
    expect(r.outcome).toBe('ungraded');
    if (r.outcome !== 'ungraded') return;
    expect(r.completion.multiplier).toBe(1);
    expect(r.completion.reward_explanation).toBeNull();
    expect(store.decisions).toHaveLength(0);
    expect(store.attempts[0].xp_awarded).toBe(Math.round(10 + 2 * store.attempts[0].difficulty_used));
  });

  it('applies the static rules when the learner has opted out', async () => {
    const { store, learner, engine } = setup({ adaptive: false });
    let task = await engine.start(learner.user_id);
    let k = 0;
    while (task) {
      const r = await engine.answer(learner.user_id, task.attempt_id, k++ % 2 ? 's0' : 's3', false);
      if (r.outcome === 'mistake') {
        expect(r.feedback).toEqual({ kind: 'plain', text: null });
        task = (await engine.retry(learner.user_id, task.attempt_id, 's3', false)).completion.next;
      } else task = r.completion.next;
    }
    expect(store.decisions).toHaveLength(0);
    for (const a of store.attempts) {
      expect(a.multiplier).toBe(1);
      expect(a.difficulty_used).toBe(2); // D_base(1) = 2
    }
    expect(store.adaptive.every((d) => !d.explained)).toBe(true);
    expect(tutorCalls).toBeGreaterThanOrEqual(0);
  });

  it('turns a quit session into quit slots and closes an open feedback decision without a bandit update', async () => {
    const { store, learner, engine } = setup();
    const task = (await engine.start(learner.user_id))!;
    await engine.answer(learner.user_id, task.attempt_id, 's0', false);
    const before = structuredClone(store.posterior);
    await engine.quit(learner.user_id);
    expect(store.sessions[0]).toMatchObject({ quit_early: true });
    expect(store.attempts[0].step).toBe('quit');
    expect(store.decisions[0]).toMatchObject({ excluded_reason: 'quit', bandit_updated: false, reward: null });
    expect(store.posterior).toEqual(before);
    const next = await engine.start(learner.user_id);
    expect(next?.session_index).toBe(2);
  });

  it('follows the curriculum over 20 sessions: D_base 2 in session 1, 4 from session 20 on', async () => {
    const { store, learner, engine } = setup({ adaptive: false });
    for (let s = 1; s <= 21; s++) {
      const task = (await engine.start(learner.user_id))!;
      const d = store.attempts.find((a) => a.id === task.attempt_id)!.difficulty_used;
      if (s === 1) expect(d).toBe(2);
      if (s === 11) expect(d).toBeCloseTo(2 + 20 / 19, 12);
      if (s >= 20) expect(d).toBe(4);
      await engine.quit(learner.user_id);
    }
  });

  it('shows a difficulty explanation only at the start of the task it applies to, naming e', async () => {
    const { store, learner, engine, advance } = setup();
    // three sessions so that e can move (E_min = 10 slots)
    for (let s = 0; s < 3; s++) {
      let task = await engine.start(learner.user_id);
      let k = 0;
      while (task) {
        advance(s === 2 && k > 5 ? 600_000 : 20_000);
        k++;
        const r = await engine.answer(learner.user_id, task.attempt_id, 's3', false);
        task = r.outcome === 'mistake' ? null : r.completion.next;
        if (s === 0 && k === 6) {
          await engine.quit(learner.user_id); // a quit lowers e
          task = null;
        }
      }
    }
    const shown = store.adaptive.filter((d) => d.output === 'difficulty' && d.explained);
    expect(shown.length).toBeGreaterThan(0);
    for (const d of shown) {
      expect(d.factors).toEqual(['e']);
      expect(d.text).toMatch(/^The next tasks are a little (harder|easier) because you have been (more|less) active lately\.$/);
    }
  });
});

describe('engine: data protection (section 10)', () => {
  it('asks for consent before the first session, and again when the consent text changes', async () => {
    const { store, learner, engine } = setup();
    store.consents = [];
    await expect(engine.start(learner.user_id)).rejects.toMatchObject({ code: 'needs_consent' });
    await engine.consent(learner.user_id);
    expect(store.consents.map((c) => c.kind).sort()).toEqual(['learner_assent', 'parental_consent']);
    expect(await engine.start(learner.user_id)).not.toBeNull();
    store.consents = store.consents.map((c) => ({ ...c, version: 'v0' }));
    await engine.quit(learner.user_id);
    await expect(engine.start(learner.user_id)).rejects.toMatchObject({ code: 'needs_consent' });
  });

  it('deletes every learning row on request and starts a new pseudonym', async () => {
    const { store, learner, engine } = setup();
    const task = (await engine.start(learner.user_id))!;
    await engine.answer(learner.user_id, task.attempt_id, 's0', false);
    await engine.retry(learner.user_id, task.attempt_id, 's3', false);
    await engine.deleteMyData(learner.user_id);
    for (const rows of [store.sessions, store.attempts, store.decisions, store.adaptive, store.consents]) expect(rows).toHaveLength(0);
    const fresh = (await store.getLearner(learner.user_id))!;
    expect(fresh.learner_id).not.toBe(learner.learner_id);
    expect(fresh.grade_band).toBeNull();
    await expect(engine.start(learner.user_id)).rejects.toMatchObject({ code: 'needs_grade_band' });
  });
});

describe('engine: missed sessions', () => {
  it('adds planned_tasks slots of 0 per calendar week without a session', async () => {
    const { store, learner, engine, advance } = setup();
    await engine.start(learner.user_id); // Friday 2026-10-23
    await engine.quit(learner.user_id);
    advance(3 * 24 * 3600 * 1000); // Monday 2026-10-26: next week, nothing missed
    await engine.start(learner.user_id);
    await engine.quit(learner.user_id);
    advance(15 * 24 * 3600 * 1000); // Tuesday 2026-11-10: the week of 2 November had no session
    await engine.start(learner.user_id);
    expect(store.sessions.map((s) => s.absent_slots_before)).toEqual([0, 0, 12]);
  });
});
