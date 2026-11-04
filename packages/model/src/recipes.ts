import { z } from 'zod';
import { styleConfigSchema } from './style';

export const brandKitSchema = z.object({
  name: z.string().trim().min(1).max(80),
  style: styleConfigSchema,
  intro: z.string().max(200).default(''),
  outro: z.string().max(200).default('Learn more'),
});
export type BrandKit = z.infer<typeof brandKitSchema>;
export const recipeSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300),
  sections: z.array(z.string().trim().min(1).max(200)).min(2).max(12),
  secondsPerSection: z.number().min(2).max(60),
});
export type Recipe = z.infer<typeof recipeSchema>;
const definitions = [
  [
    'product-demo',
    'Product demo',
    'Introduce your product through its key capabilities.',
    ['Introduction', 'Key capability', 'See it in action', 'Get started'],
    8,
  ],
  [
    'feature-launch',
    'Feature launch',
    'Reveal a feature and show how it works.',
    ['Meet the new feature', 'Why it matters', 'Watch it work', 'Try it today'],
    6,
  ],
  [
    'tutorial',
    'Step-by-step tutorial',
    'Guide viewers through a repeatable task.',
    ['What you will learn', 'Step 1', 'Step 2', 'Step 3', 'Recap'],
    10,
  ],
  [
    'updates',
    'Product update roundup',
    'Bring several updates into one release video.',
    ['What is new', 'Update 1', 'Update 2', 'Update 3', 'Explore the updates'],
    7,
  ],
  [
    'quick-tip',
    'Quick tip',
    'Teach one useful shortcut.',
    ['The problem', 'The shortcut', 'The result'],
    5,
  ],
  [
    'before-after',
    'Before and after',
    'Show a change and its outcome.',
    ['Before', 'Make the change', 'After'],
    6,
  ],
  [
    'explainer',
    'Talking-head explainer',
    'Build an explanation around clear talking points.',
    ['The question', 'First point', 'Second point', 'Your takeaway'],
    12,
  ],
  [
    'social-teaser',
    'Social teaser',
    'Create a short preview with a clear next step.',
    ['Take a look', 'The highlight', 'Find out more'],
    4,
  ],
  [
    'customer-story',
    'Customer story',
    'Tell a customer story using your own evidence.',
    ['The challenge', 'The solution', 'The outcome', 'Learn more'],
    10,
  ],
  [
    'walkthrough',
    'App walkthrough',
    'Tour an app in clearly labeled chapters.',
    ['Welcome', 'Find your way', 'Your first task', 'Next steps'],
    9,
  ],
] as const;
export const STARTER_RECIPES: readonly Recipe[] = definitions.map(
  ([id, name, description, sections, secondsPerSection]) =>
    recipeSchema.parse({ id, name, description, sections, secondsPerSection }),
);
export const STARTER_BRAND_KITS: readonly BrandKit[] = [
  brandKitSchema.parse({
    name: 'Clean',
    style: {
      background: '#111827',
      foreground: '#ffffff',
      accent: '#60a5fa',
      displayFontFamily: 'Instrument Sans',
    },
  }),
  brandKitSchema.parse({
    name: 'Bold',
    style: {
      background: '#171717',
      foreground: '#ffffff',
      accent: '#facc15',
      displayFontFamily: 'Instrument Sans',
      captionWeight: 800,
    },
  }),
  brandKitSchema.parse({
    name: 'Editorial',
    style: {
      background: '#201d19',
      foreground: '#f5eee3',
      accent: '#c9a46a',
      displayFontFamily: 'Fraunces',
      captionColor: '#f5eee3',
    },
  }),
];
