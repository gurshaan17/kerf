import { describe, expect, it } from 'vitest';
import { DEFAULT_COMPOSITION_SOURCE } from '@kerf/model';
import { COMPOSITION_SOURCE_LIMIT, validateCompositionSource } from './policy';

describe('composition source policy', () => {
  it('accepts the default scene tree expression', () => {
    expect(validateCompositionSource(DEFAULT_COMPOSITION_SOURCE)).toMatchObject(
      {
        ok: true,
        source: DEFAULT_COMPOSITION_SOURCE,
      },
    );
  });

  it('accepts arithmetic and whitelisted Math calls', () => {
    expect(
      validateCompositionSource(
        '({ nodes: [{ type: "text", text: "x", x: 50 + Math.sin(time) * 10 }] })',
      ).ok,
    ).toBe(true);
  });

  it('rejects host globals and network access', () => {
    for (const source of [
      'window.location',
      'document.body',
      'fetch("https://example.com")',
      'process.env',
      'globalThis',
      'localStorage',
      'postMessage({}, "*")',
      'new Date()',
    ]) {
      const result = validateCompositionSource(source);
      expect(result.ok, source).toBe(false);
    }
  });

  it('rejects statements, functions and extra expressions', () => {
    for (const source of [
      '({}); 1',
      '(() => 1)()',
      'while (true) {}',
      '({ nodes: [1] }); fetch("x")',
      'x = 1',
    ]) {
      expect(validateCompositionSource(source).ok, source).toBe(false);
    }
  });

  it('rejects empty and oversized sources', () => {
    expect(validateCompositionSource('   ').ok).toBe(false);
    expect(
      validateCompositionSource(
        `({ a: "${'x'.repeat(COMPOSITION_SOURCE_LIMIT)}" })`,
      ).ok,
    ).toBe(false);
  });
});
