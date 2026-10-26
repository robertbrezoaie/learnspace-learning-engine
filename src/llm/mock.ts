// Copied from pit-study (../Bandit) lib/llm/mock.ts at tag freeze-v1 (commit e8d0f71); the live study is unchanged.
// Changes in this copy: import paths; process.env is read through llm/env.ts so it runs in Deno; mock texts in English.
import type { LlmRequest, LlmResult } from './adapter.ts';
import { readEnv } from './env.ts';

/**
 * Deterministic stand-in for local development and the load test (LLM_PROVIDER=mock).
 * MOCK_LLM_FAIL=all|grade|grade_half|tutor simulates outages (acceptance criterion 7).
 * Grade heuristic: injection-looking text -> 0 + gaming flag; otherwise by length (<20: 1, <60: 2, else 3).
 */
export async function mockCall(req: LlmRequest, _model: string): Promise<LlmResult> {
  const started = Date.now();
  const latency = Number(readEnv('MOCK_LLM_LATENCY_MS') ?? 150 + Math.random() * 450);
  await new Promise((r) => setTimeout(r, Math.min(latency, req.timeoutMs)));
  const fail = readEnv('MOCK_LLM_FAIL') ?? '';
  const isTutor = req.purpose === 'hint' || req.purpose === 'example';
  const gradeFails = req.purpose === 'grade' && (fail === 'grade' || (fail === 'grade_half' && Math.random() < 0.5));
  if (fail === 'all' || gradeFails || (fail === 'tutor' && isTutor)) {
    return { ok: false, text: 'mock failure', latencyMs: Date.now() - started, error: 'http' };
  }
  if (latency >= req.timeoutMs) return { ok: false, text: null, latencyMs: Date.now() - started, error: 'timeout' };

  let out: unknown;
  if (req.purpose === 'grade') {
    const m = req.user.match(/<learner_answer>\n?([\s\S]*?)\n?<\/learner_answer>/);
    const answer = (m?.[1] ?? '').trim();
    const gaming = /(ignor|system|score|nota maxim|puncte|json|grade this|corector)/i.test(answer);
    const score = gaming ? 0 : answer.length < 20 ? 1 : answer.length < 60 ? 2 : 3;
    out = {
      score,
      misconception: score < 2 ? 'other' : null,
      confidence: 0.7,
      flags: { off_topic: false, gaming_attempt: gaming, wrong_language: false, needs_adult_attention: false },
      rationale: 'Simulated grade (mock).',
    };
  } else if (req.purpose === 'name_reaction') {
    out = { text: 'What a great name! Let us begin.' };
  } else if (req.purpose === 'hint') {
    out = { text: 'Think about what happens step by step. What does the program check, and when? Try again.' };
  } else {
    out = {
      text: 'Take another example: a lamp turns on only when you press the switch. First we check the condition, then we do the action. Try the same idea on your question.',
    };
  }
  return { ok: true, text: JSON.stringify(out), latencyMs: Date.now() - started, inputTokens: 0, outputTokens: 0 };
}
