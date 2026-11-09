import { Clapperboard } from 'lucide-react';
import { STARTER_RECIPES } from '@kerf/model';
import type { Recipe } from '@kerf/model';
import { Button, Select } from '@kerf/ui';
import type { RecipeLibrary } from './library';
import { STARTERS, TREATMENTS } from './catalog';
export function BlueprintGallery({
  library,
  choose,
  onPreview,
}: {
  library: RecipeLibrary;
  choose: (recipe: Recipe) => void;
  onPreview: (recipe: Recipe) => void;
}) {
  return (
    <>
      <div className="bp-heading">
        <div>
          <h3>What are you making?</h3>
          <p>Start with a treatment, then make it yours.</p>
        </div>
        <span>Manual editing · works offline</span>
      </div>
      <div className="bp-gallery">
        {STARTERS.map((item) => (
          <article key={item.id} className="bp-template">
            <button
              className={`bp-template-art bp-template-art--${item.id}`}
              aria-label={`Preview ${item.name}`}
              onClick={() => onPreview(item)}
            >
              <div className="bp-sample-screen">
                <span />
                <span />
                <span />
              </div>
              <span className="bp-sample-title">
                {item.id === 'tutorial'
                  ? '1. Make your first move'
                  : item.id === 'quick-tip'
                    ? 'One small shortcut.'
                    : 'Show what matters.'}
              </span>
              <span className="bp-watch">
                <Clapperboard size={14} /> Preview treatment
              </span>
            </button>
            <h4>{item.name}</h4>
            <p>{TREATMENTS[item.id]}</p>
            <p className="bp-requirement">
              Bring a recording or images · {item.sections.length} editable
              scenes
            </p>
            <Button onClick={() => choose(item)}>Use {item.name}</Button>
          </article>
        ))}
      </div>
      <label className="bp-other">
        Other & saved Blueprints
        <Select
          aria-label="Other Blueprints"
          value=""
          options={[
            { value: '', label: 'Choose another starting point…' },
            ...STARTER_RECIPES.filter((item) => !STARTERS.includes(item))
              .concat(library.recipes)
              .map((item) => ({ value: item.id, label: item.name })),
          ]}
          onChange={(event) => {
            const next = [...STARTER_RECIPES, ...library.recipes].find(
              (item) => item.id === event.target.value,
            );
            if (next) choose(next);
          }}
        />
      </label>
    </>
  );
}
