// Copied from learnspace-sim v1.0 (commit 05f70f7), src/sim/rng.ts. Test-only: production uses secureRng.
// Seeded PRNG and distributions (SIMULATION_SPEC.md section 5.1).
// xoshiro128** with 32-bit state words, seeded through splitmix32 from the FNV-1a hash of a stream name.
// Every purpose has its own named stream "{seed}|{purpose}" (section 5.2).

import type { Rng } from '../../src/core/types.ts';

/** 32-bit FNV-1a hash of a string (stream names are ASCII). */
export function fnv1a32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32 generator, used only to fill the xoshiro state. */
function splitmix32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t ^= t >>> 15;
    t = Math.imul(t, 0x735a2d97);
    t ^= t >>> 15;
    return t >>> 0;
  };
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

export class SimRng implements Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
    const sm = splitmix32(fnv1a32(name));
    this.s0 = sm();
    this.s1 = sm();
    this.s2 = sm();
    this.s3 = sm();
  }

  /** A generator with an explicit state; used only to check the reference output of xoshiro128**. */
  static fromState(s0: number, s1: number, s2: number, s3: number): SimRng {
    const r = new SimRng('state');
    r.s0 = s0;
    r.s1 = s1;
    r.s2 = s2;
    r.s3 = s3;
    return r;
  }

  /** Raw 32-bit output of xoshiro128**. */
  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform on [0, 1). */
  next(): number {
    return this.nextUint32() / 4294967296;
  }

  /** Standard normal by Box–Muller; no cached second value, so every call uses exactly two uniforms. */
  normal(): number {
    const u1 = 1 - this.next(); // in (0, 1], so the log is finite
    const u2 = this.next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  }

  lognormal(mu: number, sigma: number): number {
    return Math.exp(mu + sigma * this.normal());
  }

  bernoulli(p: number): boolean {
    return this.next() < p;
  }

  /** Gamma(shape, 1) by Marsaglia–Tsang; shape < 1 uses gamma(shape + 1) * U^(1/shape). */
  gamma(shape: number): number {
    if (!(shape > 0)) throw new Error(`gamma requires shape > 0, got ${shape}`);
    if (shape < 1) return this.gamma(shape + 1) * Math.pow(1 - this.next(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number;
      let v: number;
      do {
        x = this.normal();
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = 1 - this.next();
      if (u < 1 - 0.0331 * x * x * x * x) return d * v;
      if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
    }
  }

  beta(a: number, b: number): number {
    const x = this.gamma(a);
    const y = this.gamma(b);
    return x / (x + y);
  }

  /** Index drawn with the given probabilities (they should sum to 1). */
  categorical(probs: readonly number[]): number {
    const u = this.next();
    let acc = 0;
    for (let i = 0; i < probs.length; i++) {
      acc += probs[i];
      if (u < acc) return i;
    }
    // floating-point remainder: the last index with non-zero probability
    for (let i = probs.length - 1; i >= 0; i--) if (probs[i] > 0) return i;
    return probs.length - 1;
  }

  /** Fisher–Yates shuffle; returns a new array. */
  shuffle<T>(items: readonly T[]): T[] {
    const a = [...items];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = a[i];
      a[i] = a[j];
      a[j] = tmp;
    }
    return a;
  }
}

/** The named stream "{seed}|{purpose}", e.g. stream(3, 'learner:17:attempt'). */
export function stream(seed: number, purpose: string): SimRng {
  return new SimRng(`${seed}|${purpose}`);
}
