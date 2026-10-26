// Ported from pit-study (../Bandit) tests/tutor.test.ts at freeze-v1. Import paths changed; the username tests are dropped (pit-study name generator not ported).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { contentWords, isLeaky, leakageRatio } from '../../src/pedagogy/leakage.ts';

describe('spec 9.4 – leakage guard', () => {
  const ref = 'Bucla se oprește prea devreme: condiția este i < 100 în loc de i <= 100, range(1, 100) în loc de range(1, 101).';

  it('content words: lowercase, no diacritics, 4+ letters, no stopwords', () => {
    const w = contentWords('Bucla se oprește PREA devreme pentru că condiția este greșită');
    expect([...w].sort()).toEqual(['bucla', 'conditia', 'devreme', 'gresita', 'opreste', 'prea'].sort());
  });

  it('flags texts that reuse more than half of the reference content words', () => {
    expect(isLeaky(ref, 'Bucla se oprește prea devreme, condiția trebuie schimbată ca range să includă 100.')).toBe(true);
    expect(isLeaky(ref, 'Gândește-te: ce număr ar trebui să fie ultimul afișat? Verifică ultima repetare.')).toBe(false);
    expect(leakageRatio('', 'orice')).toBe(0);
  });

  it('regenerates once when the first text leaks, and reports regenerated_ok', async () => {
    const texts = [
      '{"text": "Bucla se oprește prea devreme, condiția range trebuie schimbată."}',
      '{"text": "Gândește-te ce număr ar trebui afișat ultimul."}',
    ];
    vi.resetModules();
    vi.doMock('../../src/llm/adapter.ts', async (orig) => ({
      ...(await orig<typeof import('../../src/llm/adapter.ts')>()),
      getProvider: () => ({ name: 'fake', call: async () => ({ ok: true, text: texts.shift()!, latencyMs: 5 }) }),
      modelFor: () => 'fake',
    }));
    const { generateFeedback } = await import('../../src/pedagogy/tutor.ts');
    const users: string[] = [];
    const res = await generateFeedback({
      kind: 'hint',
      question: {
        id: 'ALG-H1', tier: 'hard', version: 1, prompt_ro: 'p', reference_answer_ro: ref,
        rubric: { '0': 'a', '1': 'b', '2': 'c', '3': 'd' }, misconceptions: [], explanation_ro: 'e',
      },
      firstAnswer: 'nu stiu',
      misconception: null,
      band: 'lower',
      promptVersion: 'v1',
      log: async (r) => (users.push(r.request.user as string), null),
    });
    expect(res.status).toBe('regenerated_ok');
    expect(users[1]).toMatch(/revealed too much of the answer/);
  });

  afterEach(() => vi.resetModules());
});

describe('tutor text formatting', () => {
  it('strips markdown marks the model adds, keeping the words', async () => {
    const { stripMarkdown } = await import('../../src/pedagogy/tutor.ts');
    expect(stripMarkdown('Să luăm aplicația **Calculatoare** de pe telefon.')).toBe('Să luăm aplicația Calculatoare de pe telefon.');
    expect(stripMarkdown('ceva care să aleagă *fără* să repete')).toBe('ceva care să aleagă fără să repete');
    expect(stripMarkdown('poți spune: *„Un pisoi mic și pufos”*')).toBe('poți spune: „Un pisoi mic și pufos”');
    expect(stripMarkdown('### Pas 1\nfolosește `max-width`')).toBe('Pas 1\nfolosește max-width');
    expect(stripMarkdown('5 * 3 = 15 și 2 * 2 = 4')).toBe('5 * 3 = 15 și 2 * 2 = 4');
  });
});
