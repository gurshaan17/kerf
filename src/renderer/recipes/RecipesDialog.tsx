import { useState } from 'react';
import { STARTER_RECIPES, STARTER_BRAND_KITS } from '@kerf/model';
import type { BrandKit, Recipe } from '@kerf/model';
import { recipeCommand } from '@kerf/engine';
import type { RecipeSectionInput } from '@kerf/engine';
import { Button, Dialog, Input, Select } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';

export function RecipesDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const snapshot = useStudio((s) => s.snapshot);
  const apply = useStudio((s) => s.apply);
  const [recipe, setRecipe] = useState<Recipe>(STARTER_RECIPES[0]!);
  const [kit, setKit] = useState<BrandKit>(STARTER_BRAND_KITS[0]!);
  const [sections, setSections] = useState<RecipeSectionInput[]>(
    recipe.sections.map((text) => ({ text })),
  );
  const [logo, setLogo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const media =
    snapshot?.assets.filter(
      (a) => a.status === 'ready' && ['image', 'video'].includes(a.kind),
    ) ?? [];
  const updateSection = (index: number, patch: Partial<RecipeSectionInput>) =>
    setSections((values) =>
      values.map((value, i) => (i === index ? { ...value, ...patch } : value)),
    );
  const submit = async () => {
    if (!snapshot) return;
    setBusy(true);
    setError('');
    try {
      const command = recipeCommand(
        snapshot.project.sequence,
        snapshot.assets,
        recipe,
        kit,
        sections,
        logo || undefined,
      );
      const result = await apply(command, `Apply ${recipe.name}`);
      if (!result) throw new Error('Could not apply the recipe. Try again.');
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
      title="Recipes & brand kits"
      description="Build an editable draft from your footage. Everything stays on your machine."
      footer={
        <Button
          disabled={busy || !snapshot || sections.some((s) => !s.text.trim())}
          onClick={() => void submit()}
        >
          {busy ? 'Building draft…' : 'Append draft'}
        </Button>
      }
    >
      <fieldset disabled={busy} className="grid min-w-0 gap-5 border-0 p-4">
        <label className="grid gap-2 text-sm">
          Recipe
          <Select
            aria-label="Recipe"
            value={recipe.id}
            options={STARTER_RECIPES.map((r) => ({
              value: r.id,
              label: r.name,
            }))}
            onChange={(e) => {
              const next = STARTER_RECIPES.find(
                (r) => r.id === e.target.value,
              )!;
              setRecipe(next);
              setSections(next.sections.map((text) => ({ text })));
              setError('');
            }}
          />
        </label>
        <p className="text-xs text-ink-muted">{recipe.description}</p>
        <label className="grid gap-2 text-sm">
          Brand kit
          <Select
            aria-label="Brand kit"
            value={kit.name}
            options={STARTER_BRAND_KITS.map((k) => ({
              value: k.name,
              label: k.name,
            }))}
            onChange={(e) =>
              setKit(STARTER_BRAND_KITS.find((k) => k.name === e.target.value)!)
            }
          />
        </label>
        <div
          className="rounded-sm p-5 text-center"
          style={{
            background: kit.style.background,
            color: kit.style.foreground,
            fontFamily: kit.style.displayFontFamily,
          }}
        >
          <p className="text-xl">{sections[0]?.text}</p>
          <p className="mt-2 text-xs" style={{ color: kit.style.accent }}>
            {kit.name} · {recipe.secondsPerSection}s per section
          </p>
        </div>
        <label className="grid gap-2 text-sm">
          Seconds per section
          <Input
            aria-label="Seconds per section"
            type="number"
            min={2}
            max={60}
            value={recipe.secondsPerSection}
            onChange={(e) =>
              setRecipe({
                ...recipe,
                secondsPerSection: Number(e.target.value),
              })
            }
          />
        </label>
        <label className="grid gap-2 text-sm">
          Intro
          <Input
            value={kit.intro}
            onChange={(e) => setKit({ ...kit, intro: e.target.value })}
            placeholder="Optional opening title"
          />
        </label>
        <div className="grid gap-4">
          {sections.map((section, index) => (
            <div key={index} className="grid gap-2 border-t border-line pt-3">
              <label className="grid gap-2 text-sm">
                Section {index + 1}
                <Input
                  aria-label={`Section ${index + 1} title`}
                  maxLength={200}
                  value={section.text}
                  onChange={(e) =>
                    updateSection(index, { text: e.target.value })
                  }
                />
              </label>
              <Select
                aria-label={`Section ${index + 1} footage`}
                value={section.assetId ?? ''}
                options={[
                  { value: '', label: 'Title only' },
                  ...media.map((a) => ({ value: a.id, label: a.name })),
                ]}
                onChange={(e) =>
                  updateSection(index, { assetId: e.target.value || undefined })
                }
              />
            </div>
          ))}
        </div>
        <label className="grid gap-2 text-sm">
          Outro
          <Input
            value={kit.outro}
            onChange={(e) => setKit({ ...kit, outro: e.target.value })}
          />
        </label>
        <label className="grid gap-2 text-sm">
          Logo
          <Select
            aria-label="Logo"
            value={logo}
            options={[
              { value: '', label: 'No logo' },
              ...media
                .filter((a) => a.kind === 'image')
                .map((a) => ({ value: a.id, label: a.name })),
            ]}
            onChange={(e) => setLogo(e.target.value)}
          />
        </label>
        <p className="text-xs text-ink-muted">
          Uses the current canvas and frame rate. Video starts at its beginning
          and is shortened to fit; shorter clips shorten their section. Existing
          edits are preserved. Undo removes the whole draft.
        </p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </fieldset>
    </Dialog>
  );
}
