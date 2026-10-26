// Loads the algorithm parameters: algorithm.default.json (from learnspace-sim v1.0, unchanged)
// with the app-only overrides of algorithm.app.json. Every module reads parameters from here.

import type { AlgorithmConfig } from '../core/types.ts';
import { type DifficultyRule } from '../core/difficulty.ts';
import defaults from './algorithm.default.json' with { type: 'json' };
import overrides from './algorithm.app.json' with { type: 'json' };

export interface AppConfig {
  difficulty_rule: DifficultyRule;
  planned_tasks: number;
  sessions: number;
  correct_min_score: number;
  core_commit: string;
  consent_version: string;
}

export interface LoadedConfig {
  algorithm: AlgorithmConfig;
  app: AppConfig;
}

type Json = Record<string, unknown>;

function isObject(v: unknown): v is Json {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Deep merge of `over` into `base`; keys starting with '_' are documentation and are dropped. */
function merge(base: Json, over: Json): Json {
  const out: Json = {};
  for (const [k, v] of Object.entries(base)) if (!k.startsWith('_')) out[k] = isObject(v) ? merge(v, {}) : v;
  for (const [k, v] of Object.entries(over)) {
    if (k.startsWith('_')) continue;
    out[k] = isObject(v) && isObject(out[k]) ? merge(out[k] as Json, v) : isObject(v) ? merge(v, {}) : v;
  }
  return out;
}

/** Same checks as learnspace-sim's loadAlgorithmConfig, plus the app settings. */
export function validate(cfg: LoadedConfig): LoadedConfig {
  const { alpha, beta, gamma } = cfg.algorithm.reward;
  for (const [name, w] of Object.entries({ alpha, beta, gamma })) {
    if (typeof w !== 'number' || !Number.isFinite(w) || w < 0) throw new Error(`config: reward.${name} must be a number >= 0`);
  }
  if (Math.abs(alpha + beta + gamma - 1) > 1e-9) throw new Error('config: alpha + beta + gamma must equal 1');
  if (cfg.algorithm.bandit.ts_mode !== 'probs') throw new Error('config: the app must use bandit.ts_mode = probs');
  if (cfg.app.difficulty_rule !== 'DDA-E' && cfg.app.difficulty_rule !== 'STATIC') throw new Error('config: app.difficulty_rule');
  if (!(Number.isInteger(cfg.app.planned_tasks) && cfg.app.planned_tasks >= 1)) throw new Error('config: app.planned_tasks');
  if (!(Number.isInteger(cfg.app.sessions) && cfg.app.sessions >= 1)) throw new Error('config: app.sessions must be a positive integer');
  return cfg;
}

export function loadConfig(): LoadedConfig {
  const merged = merge(defaults as Json, overrides as Json);
  const { app, ...algorithm } = merged;
  return validate({ algorithm: algorithm as unknown as AlgorithmConfig, app: app as unknown as AppConfig });
}

export const config: LoadedConfig = loadConfig();
