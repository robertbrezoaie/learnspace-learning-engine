// Production RNG for the core (uniform in [0, 1) from the platform CSPRNG).
// Never use Math.random for feedback allocation: the logged propensities assume unpredictable draws.

import type { Rng } from './core/types.ts';

export const secureRng: Rng = {
  next(): number {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    return buf[0] / 2 ** 32;
  },
};
