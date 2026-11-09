import { STARTER_RECIPES } from '@kerf/model';
export const STARTERS = ['product-demo', 'quick-tip', 'tutorial'].map(
  (id) => STARTER_RECIPES.find((recipe) => recipe.id === id)!,
);
export const TREATMENTS: Record<string, string> = {
  'product-demo': 'Footage first · lower titles · clear closing card',
  'quick-tip': 'Three short beats · top titles · no forced outro',
  tutorial: 'Step-by-step chapters · numbered labels · room to explain',
};
