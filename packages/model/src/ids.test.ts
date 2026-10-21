import { describe, expect, it } from 'vitest';
import { idPattern, idSchema, isId, newId } from './ids';

describe('ids', () => {
  it('uses the kind prefix and a compact token', () => {
    const id = newId('project');
    expect(id).toMatch(idPattern('project'));
    expect(id.startsWith('prj_')).toBe(true);
    expect(isId(id, 'project')).toBe(true);
    expect(isId(id, 'clip')).toBe(false);
  });

  it('is unique across calls', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId('clip')));
    expect(ids.size).toBe(200);
  });

  it('validates and brands ids through zod', () => {
    const parsed = idSchema('asset').parse(newId('asset'));
    expect(typeof parsed).toBe('string');
    expect(() => idSchema('asset').parse('nope')).toThrow();
    expect(() => idSchema('asset').parse(newId('clip'))).toThrow();
  });
});
