import { z } from 'zod';
import { brandKitSchema, recipeSchema } from '@kerf/model';
const librarySchema = z.object({
  version: z.literal(1),
  recipes: z.array(recipeSchema).max(100),
  kits: z.array(brandKitSchema).max(100),
});
export type RecipeLibrary = z.infer<typeof librarySchema>;
export const RECIPE_LIBRARY_KEY = 'kerf.recipe-library.v1';
export function readLibrary(storage: Pick<Storage, 'getItem'>): RecipeLibrary {
  const raw = storage.getItem(RECIPE_LIBRARY_KEY);
  return raw
    ? librarySchema.parse(JSON.parse(raw))
    : { version: 1, recipes: [], kits: [] };
}
export function writeLibrary(
  storage: Pick<Storage, 'setItem'>,
  library: RecipeLibrary,
): void {
  storage.setItem(
    RECIPE_LIBRARY_KEY,
    JSON.stringify(librarySchema.parse(library)),
  );
}
