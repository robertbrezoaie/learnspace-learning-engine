// LLM settings for MyApp, with the same variable names as pit-study's lib/env.ts (LLM_* only).
// Reads Deno.env in Edge Functions and process.env under Node (tests).

type EnvSource = { get(name: string): string | undefined };

const source: EnvSource = (() => {
  const g = globalThis as { Deno?: { env: EnvSource }; process?: { env: Record<string, string | undefined> } };
  if (g.Deno) return g.Deno.env;
  return { get: (name: string) => g.process?.env[name] };
})();

export function readEnv(name: string): string | undefined {
  return source.get(name);
}

function req(name: string): string {
  const v = readEnv(name);
  if (!v || v.trim() === '') throw new Error(`Missing env ${name}`);
  return v.trim();
}

export type LlmProviderName = 'openai_compatible' | 'mock';

export const env = {
  get llmProvider(): LlmProviderName {
    const p = (readEnv('LLM_PROVIDER') ?? 'openai_compatible').trim();
    if (p !== 'openai_compatible' && p !== 'mock') throw new Error(`Unknown LLM_PROVIDER ${p}`);
    return p;
  },
  get llmApiKey() {
    return readEnv('LLM_API_KEY')?.trim() ?? '';
  },
  get llmBaseUrl() {
    return readEnv('LLM_BASE_URL')?.trim() ?? '';
  },
  get llmJsonMode() {
    return /^(1|true|yes)$/i.test(readEnv('LLM_JSON_MODE')?.trim() ?? '');
  },
  get graderModel() {
    return readEnv('LLM_MODEL_GRADER')?.trim() || (this.llmProvider === 'mock' ? 'mock' : req('LLM_MODEL_GRADER'));
  },
  get tutorModel() {
    return readEnv('LLM_MODEL_TUTOR')?.trim() || (this.llmProvider === 'mock' ? 'mock' : req('LLM_MODEL_TUTOR'));
  },
  get promptVersion() {
    return readEnv('PROMPT_VERSION')?.trim() || 'en-v1';
  },
};
