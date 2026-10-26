// The copied core must stay identical to learnspace-sim v1.0 (commit 05f70f7), and pure.
// Purity checks follow learnspace-sim tests/barrier.test.ts (test 8), restricted to the core.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CORE = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/core');
const HEADER_END = '// --- end provenance header ---\n';
const manifest = JSON.parse(readFileSync(join(CORE, 'PROVENANCE.json'), 'utf8')) as {
  commit: string;
  files: Record<string, string>;
};

function tsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? tsFiles(p) : p.endsWith('.ts') ? [p] : [];
  });
}

function imports(file: string): string[] {
  const src = readFileSync(file, 'utf8');
  const re = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  return [...src.matchAll(re)].map((m) => m[1] ?? m[2] ?? m[3]);
}

const coreFiles = tsFiles(CORE);

describe('core provenance', () => {
  it('pins commit 05f70f7', () => {
    expect(manifest.commit.startsWith('05f70f7')).toBe(true);
  });

  it('contains exactly the files listed in PROVENANCE.json', () => {
    const names = coreFiles.map((f) => relative(CORE, f).split(sep).join('/')).sort();
    expect(names).toEqual(Object.keys(manifest.files).sort());
  });

  it('has a body byte-identical to the source file', () => {
    for (const [name, sha] of Object.entries(manifest.files)) {
      const src = readFileSync(join(CORE, name), 'utf8');
      const at = src.indexOf(HEADER_END);
      expect(at, `${name} has no provenance header`).toBeGreaterThan(0);
      const body = src.slice(at + HEADER_END.length);
      expect(createHash('sha256').update(body).digest('hex'), `${name} differs from learnspace-sim v1.0`).toBe(sha);
    }
  });
});

describe('core purity', () => {
  it('imports only from inside the core', () => {
    for (const file of coreFiles) {
      for (const spec of imports(file)) {
        expect(spec.startsWith('.'), `${file} imports non-relative module ${spec}`).toBe(true);
        expect(resolve(dirname(file), spec).startsWith(CORE + sep), `${file} imports ${spec} outside the core`).toBe(true);
      }
    }
  });

  it('uses no ambient randomness, clock, crypto, I/O or global process state', () => {
    for (const file of coreFiles) {
      const src = readFileSync(file, 'utf8');
      for (const banned of ['Math.random', 'Date.now', 'new Date', 'crypto', 'process.', 'require(', 'globalThis']) {
        expect(src.includes(banned), `${file} uses ${banned}`).toBe(false);
      }
    }
  });
});
