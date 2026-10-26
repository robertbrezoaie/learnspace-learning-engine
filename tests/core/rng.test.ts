// Ported from learnspace-sim v1.0 (commit 05f70f7), tests/rng.test.ts. Only import paths changed.
// Test 1 (SIMULATION_SPEC.md section 14): RNG.
import { describe, expect, it } from 'vitest';
import { SimRng, fnv1a32, stream } from '../support/simRng.ts';

describe('rng', () => {
  it('matches the reference output of xoshiro128** for state (1, 2, 3, 4)', () => {
    const r = SimRng.fromState(1, 2, 3, 4);
    expect([r.nextUint32(), r.nextUint32(), r.nextUint32(), r.nextUint32()]).toEqual([11520, 0, 5927040, 70819200]);
  });

  it('hashes stream names with FNV-1a', () => {
    expect(fnv1a32('')).toBe(0x811c9dc5);
    expect(fnv1a32('a')).toBe(0xe40c292c);
  });

  it('gives the same sequence for the same stream name and different sequences for different names', () => {
    const a = stream(1, 'pop');
    const b = stream(1, 'pop');
    const c = stream(2, 'pop');
    const d = stream(1, 'policy');
    const sa = Array.from({ length: 100 }, () => a.next());
    expect(Array.from({ length: 100 }, () => b.next())).toEqual(sa);
    expect(Array.from({ length: 100 }, () => c.next())).not.toEqual(sa);
    expect(Array.from({ length: 100 }, () => d.next())).not.toEqual(sa);
  });

  it('draws uniforms on [0, 1) with the right mean and variance over 10^6 draws', () => {
    const r = stream(7, 'uniform-test');
    const n = 1_000_000;
    let sum = 0;
    let sumSq = 0;
    let min = 1;
    let max = 0;
    for (let i = 0; i < n; i++) {
      const x = r.next();
      sum += x;
      sumSq += x * x;
      if (x < min) min = x;
      if (x > max) max = x;
    }
    const mean = sum / n;
    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThan(1);
    expect(Math.abs(mean - 0.5)).toBeLessThan(0.002);
    expect(Math.abs(sumSq / n - mean * mean - 1 / 12)).toBeLessThan(0.001);
  });

  it('draws standard normals with mean 0 +/- 0.005 and sd 1 +/- 0.005 over 10^6 draws', () => {
    const r = stream(7, 'normal-test');
    const n = 1_000_000;
    let sum = 0;
    let sumSq = 0;
    for (let i = 0; i < n; i++) {
      const x = r.normal();
      sum += x;
      sumSq += x * x;
    }
    const mean = sum / n;
    expect(Math.abs(mean)).toBeLessThan(0.005);
    expect(Math.abs(Math.sqrt(sumSq / n - mean * mean) - 1)).toBeLessThan(0.005);
  });

  it('consumes exactly two uniforms per normal draw', () => {
    const a = stream(3, 'x');
    const b = stream(3, 'x');
    a.normal();
    b.next();
    b.next();
    expect(a.next()).toBe(b.next());
  });

  it('draws gamma (shape < 1 and >= 1), beta, bernoulli and categorical with the right means', () => {
    const r = stream(5, 'dist-test');
    const n = 200_000;
    const mean = (f: () => number) => {
      let s = 0;
      for (let i = 0; i < n; i++) s += f();
      return s / n;
    };
    expect(Math.abs(mean(() => r.gamma(0.5)) - 0.5)).toBeLessThan(0.01);
    expect(Math.abs(mean(() => r.gamma(3)) - 3)).toBeLessThan(0.03);
    expect(Math.abs(mean(() => r.beta(2, 5)) - 2 / 7)).toBeLessThan(0.01);
    expect(Math.abs(mean(() => (r.bernoulli(0.3) ? 1 : 0)) - 0.3)).toBeLessThan(0.01);
    expect(Math.abs(mean(() => r.lognormal(0, 0.5)) - Math.exp(0.125))).toBeLessThan(0.01);
    const counts = [0, 0, 0];
    for (let i = 0; i < n; i++) counts[r.categorical([0.2, 0.5, 0.3])]++;
    expect(counts.map((c) => Math.round((c / n) * 100) / 100)).toEqual([0.2, 0.5, 0.3]);
  });

  it('shuffles without losing or duplicating elements and without changing the input', () => {
    const r = stream(1, 'week:1:order');
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = r.shuffle(input);
    expect(input).toEqual(Array.from({ length: 50 }, (_, i) => i));
    expect([...out].sort((x, y) => x - y)).toEqual(input);
    expect(out).not.toEqual(input);
  });
});
