// Test-only stand-in for learnspace-sim's src/sim/config.ts loadAlgorithmConfig: the ported tests
// run against the simulation's own parameters (algorithm.default.json, without the app overrides).

import type { AlgorithmConfig } from '../../src/core/types.ts';
import defaults from '../../src/config/algorithm.default.json' with { type: 'json' };

export function loadAlgorithmConfig(): AlgorithmConfig {
  return structuredClone(defaults) as unknown as AlgorithmConfig;
}
