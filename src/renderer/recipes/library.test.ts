import { expect, it } from 'vitest';
import { STARTER_RECIPES, STARTER_BRAND_KITS } from '@kerf/model';
import { readLibrary, writeLibrary } from './library';
it('persists reusable recipes without project media references', () => {
  let value: string | null = null;
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
  expect(readLibrary(storage).recipes).toEqual([]);
  const library = {
    version: 1 as const,
    recipes: [...STARTER_RECIPES],
    kits: [...STARTER_BRAND_KITS],
  };
  writeLibrary(storage, library);
  expect(readLibrary(storage)).toEqual(library);
});
it('rejects corrupt or incompatible saved data', () => {
  expect(() => readLibrary({ getItem: () => '{broken' })).toThrow();
  expect(() => readLibrary({ getItem: () => '{"version":2}' })).toThrow();
});
