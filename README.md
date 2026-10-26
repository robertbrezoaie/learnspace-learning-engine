# LearnSpace learning engine

The learning engine of LearnSpace, the adaptive gamified e-learning platform built in Robert-Emanuel Brezoaie's doctoral research (NUST POLITEHNICA Bucharest). It runs one practice session for a learner:

1. It grades each open answer with an LLM grader (score 0 to 3).
2. After a mistake, a Thompson-sampling bandit chooses the feedback type: plain, hint or worked example.
3. An LLM tutor writes the hint or worked example.
4. It grades the retry and updates the bandit with the result.
5. It computes XP, the reward multiplier and the next task's difficulty with the rule-based core, and explains each reward or difficulty change to the learner (Explanation Layer).

The LLM only grades and writes text. XP, difficulty and the choice of feedback are decided by deterministic code and by the bandit.

## Layout

| Folder | Contents |
|---|---|
| `src/core` | Adaptive core copied from [learnspace-sim](https://github.com/robertbrezoaie/learnspace-sim) v1.0 (commit `05f70f7`): signals, gamification, reward, difficulty, explanations, bandit (`core/bandit`). File hashes are in `src/core/PROVENANCE.json` and checked by `tests/core/provenance.test.ts`. |
| `src/grading` | LLM grader and its prompts |
| `src/pedagogy` | LLM tutor, leakage check, next-task selection |
| `src/llm` | Provider-agnostic LLM adapter (OpenAI-compatible endpoint, e.g. Mistral; mock for tests) |
| `src/engine` | The learning loop (`engine.ts`) over a storage interface (`store.ts`) |
| `src/explain`, `src/learner`, `src/domain`, `src/config` | Adaptive explanations, learner history and absences, question bank and levels, algorithm settings |
| `tests` | 112 tests (Vitest) |

## Where it runs

- **Now:** inside the LearnSpace app's Supabase backend, as the `learn` Edge Function (repository [PHD-MyApp](https://github.com/robertbrezoaie/PHD-MyApp), `supabase/functions/_shared`). The code in `src/` is identical to that folder at commit `101626e`.
- **Planned:** a separate service with its own API behind the LearnSpace app. The storage interface in `src/engine/store.ts` is the seam for that move.
- **Field study (October 2026):** the grader, bandit and tutor that learners used ran on a separate study page, [pit-study](https://github.com/robertbrezoaie/pit-study) (Romanian questions, Mistral Medium 3.5). This engine is the next version of the same components.

## Run the tests

```bash
npm install
npm test
```

The tests use the mock LLM, so no API key is needed. Using a real model requires `LLM_PROVIDER=openai_compatible`, `LLM_BASE_URL`, `LLM_API_KEY`, `LLM_MODEL_GRADER` and `LLM_MODEL_TUTOR`.
