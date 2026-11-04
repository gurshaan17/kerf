import { useState } from 'react';
import { STARTER_RECIPES, STARTER_BRAND_KITS } from '@kerf/model';
import type { BrandKit, Recipe } from '@kerf/model';
import { recipeCommand } from '@kerf/engine';
import type { RecipeSectionInput } from '@kerf/engine';
import { Button, Dialog, Input, Select } from '@kerf/ui';
import { readLibrary, writeLibrary } from './library';
import type { RecipeLibrary } from './library';
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
  const [library, setLibrary] = useState<RecipeLibrary>(() => {
    try {
      return readLibrary(localStorage);
    } catch {
      return { version: 1, recipes: [], kits: [] };
    }
  });
  const [savedName, setSavedName] = useState('');
  const [notice, setNotice] = useState('');
  const recipes = [...STARTER_RECIPES, ...library.recipes];
  const kits = [...STARTER_BRAND_KITS, ...library.kits];
  const save = () => {
    try {
      // Re-read first: preserve changes saved by another window and refuse to overwrite damaged data.
      const current = readLibrary(localStorage);
      const name = savedName.trim();
      if (!name)
        throw new Error('Name your recipe and brand kit before saving.');
      if (
        kits.some((k) => k.name === name) ||
        recipes.some((r) => r.name === name)
      )
        throw new Error('Choose a new name to save a separate copy.');
      const next: RecipeLibrary = {
        version: 1,
        recipes: [
          ...current.recipes,
          {
            ...recipe,
            id: crypto.randomUUID(),
            name,
            sections: sections.map((s) => s.text),
          },
        ],
        kits: [...current.kits, { ...kit, name }],
      };
      writeLibrary(localStorage, next);
      setLibrary(next);
      setSavedName('');
      setNotice('Saved locally. Choose this recipe and kit in any project.');
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
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
            options={recipes.map((r) => ({
              value: r.id,
              label: r.name,
            }))}
            onChange={(e) => {
              const next = recipes.find((r) => r.id === e.target.value)!;
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
            options={kits.map((k) => ({
              value: k.name,
              label: k.name,
            }))}
            onChange={(e) =>
              setKit(kits.find((k) => k.name === e.target.value)!)
            }
          />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="grid gap-2 text-sm">
            Text color
            <Input
              aria-label="Text color"
              type="color"
              value={kit.style.foreground}
              onChange={(e) =>
                setKit({
                  ...kit,
                  style: {
                    ...kit.style,
                    foreground: e.target.value,
                    captionColor: e.target.value,
                  },
                })
              }
            />
          </label>
          <label className="grid gap-2 text-sm">
            Background
            <Input
              aria-label="Background color"
              type="color"
              value={kit.style.background}
              onChange={(e) =>
                setKit({
                  ...kit,
                  style: {
                    ...kit.style,
                    background: e.target.value,
                    captionBackground: e.target.value,
                  },
                })
              }
            />
          </label>
          <label className="grid gap-2 text-sm">
            Accent
            <Input
              aria-label="Accent color"
              type="color"
              value={kit.style.accent}
              onChange={(e) =>
                setKit({
                  ...kit,
                  style: { ...kit.style, accent: e.target.value },
                })
              }
            />
          </label>
          <label className="grid gap-2 text-sm">
            Font
            <Select
              aria-label="Brand font"
              value={kit.style.displayFontFamily}
              options={['Instrument Sans', 'Fraunces', 'JetBrains Mono'].map(
                (value) => ({ value, label: value }),
              )}
              onChange={(e) =>
                setKit({
                  ...kit,
                  style: {
                    ...kit.style,
                    displayFontFamily: e.target.value,
                    fontFamily: e.target.value,
                    captionFontFamily: e.target.value,
                  },
                })
              }
            />
          </label>
        </div>
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
              <Button
                disabled={sections.length <= 2}
                onClick={() => {
                  setSections(sections.filter((_, i) => i !== index));
                  setRecipe({
                    ...recipe,
                    sections: recipe.sections.filter((_, i) => i !== index),
                  });
                }}
              >
                Remove section {index + 1}
              </Button>
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
        <Button
          disabled={sections.length >= 12}
          onClick={() => {
            setSections([...sections, { text: 'Next step' }]);
            setRecipe({
              ...recipe,
              sections: [...recipe.sections, 'Next step'],
            });
          }}
        >
          Add section
        </Button>
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
        <div className="grid gap-2 border-t border-line pt-4">
          <label className="grid gap-2 text-sm">
            Save a reusable copy
            <Input
              aria-label="Saved recipe name"
              maxLength={80}
              value={savedName}
              onChange={(e) => setSavedName(e.target.value)}
              placeholder="e.g. Acme feature launch"
            />
          </label>
          <Button onClick={save}>Save recipe & kit</Button>
          <p className="text-xs text-ink-muted">
            Saves structure, timing, wording and branding. Choose footage and a
            project logo again when reusing it.
          </p>
          {notice && (
            <p role="status" className="text-sm text-ink">
              {notice}
            </p>
          )}
        </div>
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
