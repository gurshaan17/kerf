import { describe, expect, it } from 'vitest';
import {
  STARTER_RECIPES,
  STARTER_BRAND_KITS,
  recipeSchema,
  brandKitSchema,
} from './recipes';
describe('recipe catalog', () => {
  it('provides ten unique recipes and three valid kits', () => {
    expect(new Set(STARTER_RECIPES.map((r) => r.id)).size).toBe(10);
    expect(STARTER_BRAND_KITS).toHaveLength(3);
    for (const recipe of STARTER_RECIPES)
      expect(recipeSchema.safeParse(recipe).success).toBe(true);
    for (const kit of STARTER_BRAND_KITS)
      expect(brandKitSchema.safeParse(kit).success).toBe(true);
  });
  it('rejects empty structures and invalid branding', () => {
    expect(
      recipeSchema.safeParse({ ...STARTER_RECIPES[0], sections: [] }).success,
    ).toBe(false);
    expect(brandKitSchema.safeParse({ name: '', style: {} }).success).toBe(
      false,
    );
  });
});
