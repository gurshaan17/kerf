import { useMemo, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Film,
  Plus,
  Trash2,
} from 'lucide-react';
import { STARTER_RECIPES, STARTER_BRAND_KITS, fpsToNumber } from '@kerf/model';
import type { BrandKit, Recipe } from '@kerf/model';
import { sequenceDurationFrames } from '@kerf/engine';
import { Button, Dialog, Input, Select } from '@kerf/ui';
import { readLibrary, writeLibrary } from './library';
import type { RecipeLibrary } from './library';
import { useStudio } from '../state/StudioProvider';
import { DraftPreview } from './DraftPreview';
import { SourcePreview } from '../analysis/SourcePreview';
import {
  distributeFootage,
  exampleSequence,
  initialScenes,
  planDraft,
} from './planning';
import type { DraftScene } from './planning';
import './blueprints.css';
import { BlueprintGallery } from './BlueprintGallery';
import { BrandSettings } from './BrandSettings';
import { STARTERS, TREATMENTS } from './catalog';

export function RecipesDialog({
  open,
  onOpenChange,
  initialAssetId,
}: {
  initialAssetId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const snapshot = useStudio((s) => s.snapshot);
  const apply = useStudio((s) => s.apply);
  const setPlayhead = useStudio((s) => s.setPlayhead);
  const setPlaying = useStudio((s) => s.setPlaying);
  const selectClip = useStudio((s) => s.selectClip);
  const importAssets = useStudio((s) => s.importFootage);
  const selection = useStudio((s) => s.selection);
  const [stage, setStage] = useState<'browse' | 'footage' | 'review'>('browse');
  const [recipe, setRecipe] = useState<Recipe>(STARTERS[0]!);
  const [kit, setKit] = useState<BrandKit>(STARTER_BRAND_KITS[0]!);
  const [scenes, setScenes] = useState<DraftScene[]>(() =>
    initialScenes(STARTERS[0]!),
  );
  const [active, setActive] = useState(0);
  const [sourceFrame, setSourceFrame] = useState(0);
  const [sourceId, setSourceId] = useState('');
  const [target, setTarget] = useState(30);
  const [goal, setGoal] = useState('');
  const [prepared, setPrepared] = useState(false);
  const [pendingRecipe, setPendingRecipe] = useState<Recipe | null>(null);
  const [logo, setLogo] = useState('');
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [library, setLibrary] = useState<RecipeLibrary>(() => {
    try {
      return readLibrary(localStorage);
    } catch {
      return { version: 1, recipes: [], kits: [] };
    }
  });
  const [savedName, setSavedName] = useState('');
  const [brandName, setBrandName] = useState('');
  const [example, setExample] = useState<Recipe | null>(null);
  const media =
    snapshot?.assets.filter(
      (asset) =>
        asset.status === 'ready' && ['image', 'video'].includes(asset.kind),
    ) ?? [];
  const selectedClip = snapshot?.project.sequence.tracks
    .flatMap((track) => track.clips)
    .find((clip) => selection.clipIds.includes(clip.id) && 'assetId' in clip);
  const selectedAssetId =
    selectedClip && 'assetId' in selectedClip
      ? selectedClip.assetId
      : undefined;
  const plan = useMemo(() => {
    if (!snapshot) return { error: 'Open a project to create a draft.' };
    try {
      return {
        value: planDraft(
          snapshot.project.sequence,
          snapshot.assets,
          recipe,
          kit,
          scenes,
          logo || undefined,
        ),
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
  }, [snapshot, recipe, kit, scenes, logo]);
  const sample = useMemo(
    () =>
      snapshot && example
        ? exampleSequence(snapshot.project.sequence, example, kit)
        : null,
    [snapshot, example, kit],
  );
  const scene = scenes[active];
  const source = media.find((asset) => asset.id === sourceId);
  const activeAsset = media.find((asset) => asset.id === scene?.assetId);
  const fps = snapshot ? fpsToNumber(snapshot.project.sequence.frameRate) : 24;
  const length = plan.value
    ? sequenceDurationFrames(plan.value.preview) / fps
    : 0;
  const ready = scenes.filter(
    (item) =>
      item.kind === 'title' || media.some((asset) => asset.id === item.assetId),
  ).length;
  const patch = (value: Partial<DraftScene>) =>
    setScenes((values) =>
      values.map((item, index) =>
        index === active ? { ...item, ...value } : item,
      ),
    );
  const choose = (next: Recipe, confirmed = false) => {
    if (prepared && next.id !== recipe.id && !confirmed) {
      setPendingRecipe(next);
      return;
    }
    setPendingRecipe(null);
    setRecipe(next);
    setExample(null);
    setError('');
    setNotice('');
    // Keep work when returning to the current template; a different template starts a new plan.
    if (next.id !== recipe.id || (stage === 'browse' && scenes.length === 0)) {
      setScenes(initialScenes(next));
      setPrepared(false);
      setActive(0);
    }
    if (next.id !== recipe.id || !prepared)
      setTarget(
        next.sceneDefaults?.reduce(
          (sum, scene) =>
            sum + (scene.kind === 'footage' ? scene.durationSeconds : 0),
          0,
        ) || next.sections.length * next.secondsPerSection,
      );
    if (next.id === 'quick-tip' && next.id !== recipe.id)
      setKit((value) => ({ ...value, intro: '', outro: '' }));
    if (!sourceId || (initialAssetId && !prepared))
      setSourceId(
        media.find((asset) => asset.id === initialAssetId)?.id ??
          media.find((asset) => asset.id === selectedAssetId)?.id ??
          media[0]?.id ??
          '',
      );
    setPlaying(false);
    setStage('footage');
  };
  const prepare = () => {
    if (!source || !Number.isFinite(target) || target < 1 || target > 600)
      return;
    if (prepared) {
      setStage('review');
      return;
    }
    const assigned = distributeFootage(scenes, source, target);
    setScenes(
      assigned.map((item, index) =>
        index === 0 && goal.trim()
          ? { ...item, text: goal.trim(), showTitle: true }
          : item,
      ),
    );
    setError('');
    setStage('review');
    setPrepared(true);
    setExample(null);
    setActive(0);
  };
  const save = (kind: 'recipe' | 'kit') => {
    try {
      const name = (kind === 'recipe' ? savedName : brandName).trim();
      if (!name)
        throw new Error(
          `Name your ${kind === 'recipe' ? 'Blueprint' : 'brand preset'} before saving.`,
        );
      const current = readLibrary(localStorage);
      const names =
        kind === 'recipe'
          ? [...STARTER_RECIPES, ...current.recipes]
          : [...STARTER_BRAND_KITS, ...current.kits];
      if (names.some((item) => item.name === name))
        throw new Error('Choose a new name to save a separate copy.');
      const next: RecipeLibrary =
        kind === 'recipe'
          ? {
              ...current,
              recipes: [
                ...current.recipes,
                {
                  ...recipe,
                  id: crypto.randomUUID(),
                  name,
                  sections: scenes.map((item) => item.role),
                  treatment:
                    recipe.treatment ??
                    (['product-demo', 'quick-tip', 'tutorial'].includes(
                      recipe.id,
                    )
                      ? (recipe.id as 'product-demo' | 'quick-tip' | 'tutorial')
                      : 'standard'),
                  sceneDefaults: scenes.map(
                    ({ text, kind, durationSeconds, showTitle }) => ({
                      text,
                      kind,
                      durationSeconds,
                      showTitle: showTitle ?? false,
                    }),
                  ),
                },
              ],
            }
          : { ...current, kits: [...current.kits, { ...kit, name }] };
      writeLibrary(localStorage, next);
      setLibrary(next);
      setError('');
      setNotice(
        `${kind === 'recipe' ? 'Blueprint structure' : 'Brand preset'} saved locally. Your current draft is unchanged.`,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };
  const submit = async () => {
    if (!plan.value || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await apply(plan.value.command, `Apply ${recipe.name}`);
      if (!result)
        throw new Error(
          'Could not add the draft. Your storyboard is still here; try again.',
        );
      const first = result.snapshot.project.sequence.tracks
        .flatMap((track) => track.clips)
        .find(
          (clip) =>
            clip.startFrame === plan.value!.offset &&
            !snapshot?.project.sequence.tracks.some((track) =>
              track.clips.some((existing) => existing.id === clip.id),
            ),
        );
      setPlayhead(plan.value.offset);
      if (first) selectClip(first.id);
      setNotice(
        'Draft added. Start another from the gallery, or continue editing your timeline.',
      );
      setScenes(initialScenes(recipe));
      setPrepared(false);
      setStage('browse');
      onOpenChange(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const move = (direction: number) => {
    const next = active + direction;
    if (next < 0 || next >= scenes.length) return;
    setScenes((values) => {
      const copy = [...values];
      [copy[active], copy[next]] = [copy[next]!, copy[active]!];
      return copy;
    });
    setActive(next);
  };
  const previewFrame =
    plan.value && scene
      ? (() => {
          const intro = kit.intro.trim() ? 3 : 0;
          return (
            Math.round(intro * fps) +
            scenes
              .slice(0, active)
              .reduce(
                (sum, item) => sum + Math.floor(item.durationSeconds * fps),
                0,
              )
          );
        })()
      : 0;

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) onOpenChange(value);
      }}
      size="workspace"
      title="Blueprints & brand kits"
      description="Choose a starting point. Shape it around your footage. Preview before adding."
      footer={
        <>
          <span className="bp-footer-note">
            {stage === 'review'
              ? plan.value
                ? `${length.toFixed(1)}s · ${scenes.length} scenes · ${kit.name} · one-step undo`
                : `${ready} of ${scenes.length} scenes have content`
              : 'Your timeline stays unchanged until you add a draft.'}
          </span>
          {stage !== 'browse' && (
            <Button
              disabled={busy}
              onClick={() => {
                setExample(null);
                setStage(stage === 'review' ? 'footage' : 'browse');
              }}
            >
              Back
            </Button>
          )}
          {stage === 'footage' && (
            <Button
              variant="primary"
              disabled={
                !source ||
                target < 1 ||
                target > 600 ||
                !Number.isFinite(target)
              }
              onClick={prepare}
            >
              Build storyboard <ArrowRight size={14} />
            </Button>
          )}
          {stage === 'review' && (
            <Button
              variant="primary"
              disabled={busy || !plan.value}
              onClick={() => void submit()}
            >
              {busy
                ? 'Adding draft…'
                : plan.value?.offset
                  ? 'Add after current edit'
                  : 'Add to timeline'}
            </Button>
          )}
        </>
      }
    >
      <fieldset
        disabled={busy}
        className="bp-workspace m-0 min-w-0 border-0 p-0"
        aria-busy={busy}
      >
        {pendingRecipe && (
          <div role="alert" className="bp-switch-warning">
            <p>
              Switch to {pendingRecipe.name}? This replaces your current
              storyboard. Your timeline is unchanged.
            </p>
            <Button onClick={() => setPendingRecipe(null)}>
              Keep current storyboard
            </Button>
            <Button onClick={() => choose(pendingRecipe, true)}>
              Switch Blueprint
            </Button>
          </div>
        )}

        {error && (
          <p role="alert" className="bp-message text-danger">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="bp-message">
            {notice}
          </p>
        )}
        {stage === 'browse' ? (
          <>
            <BlueprintGallery
              library={library}
              choose={choose}
              onPreview={(item) => {
                setPlaying(false);
                setExample(item);
              }}
            />
            {sample && snapshot && open && (
              <div className="bp-example">
                <h3>{example?.name} treatment preview</h3>
                <p>
                  Illustrative panels and sample text. Your draft will use only
                  the footage you choose.
                </p>
                <div className="bp-preview">
                  <DraftPreview snapshot={snapshot} sequence={sample} />
                </div>
              </div>
            )}
          </>
        ) : stage === 'footage' ? (
          <div className="bp-setup">
            <div>
              <h3>{recipe.name}</h3>
              <p>{TREATMENTS[recipe.id] ?? recipe.description}</p>
              <div className="bp-outline">
                {recipe.sections.map((role, index) => (
                  <div key={index}>
                    <span>{index + 1}</span>
                    {role}
                  </div>
                ))}
              </div>
              <p>
                We’ll divide the chosen footage into consecutive ranges. Review
                and trim each scene before adding it.
              </p>
            </div>
            <div className="bp-fields">
              <label>
                What should viewers learn?
                <Input
                  aria-label="Video goal"
                  value={goal}
                  maxLength={200}
                  placeholder="e.g. Create and share a workspace"
                  onChange={(event) => setGoal(event.target.value)}
                />
              </label>
              <label>
                Start with footage
                <Select
                  aria-label="Starting footage"
                  value={sourceId}
                  options={[
                    { value: '', label: 'Choose a recording or image…' },
                    ...media.map((asset) => ({
                      value: asset.id,
                      label: asset.name,
                    })),
                  ]}
                  onChange={(event) => {
                    setSourceId(event.target.value);
                    setPrepared(false);
                  }}
                />
              </label>
              {!media.length && (
                <p>
                  Import a recording or image to get started. You can choose
                  title cards later in the storyboard.
                </p>
              )}
              <Button
                onClick={() => void importAssets()}
                leadingIcon={<Plus size={14} />}
              >
                Import footage
              </Button>
              {prepared && (
                <p>
                  Your scene edits are saved. Changing the starting footage or
                  budget rebuilds the source ranges.
                </p>
              )}
              <label>
                Footage budget (seconds)
                <Input
                  aria-label="Target duration"
                  type="number"
                  min={1}
                  max={600}
                  value={target}
                  onChange={(event) => {
                    setTarget(Number(event.target.value));
                    setPrepared(false);
                  }}
                />
              </label>
              <p>
                {source?.kind === 'video'
                  ? `Recording: ${source.durationSeconds.toFixed(1)}s. We use up to ${Math.min(source.durationSeconds, target).toFixed(1)}s; opening and closing cards are additional.`
                  : 'Scene timing stays editable. Opening and closing cards are additional.'}
              </p>
              <label>
                Brand preset
                <Select
                  aria-label="Brand kit"
                  value={kit.name}
                  options={[...STARTER_BRAND_KITS, ...library.kits].map(
                    (item) => ({ value: item.name, label: item.name }),
                  )}
                  onChange={(event) =>
                    setKit(
                      [...STARTER_BRAND_KITS, ...library.kits].find(
                        (item) => item.name === event.target.value,
                      )!,
                    )
                  }
                />
              </label>
              {recipe.id === 'quick-tip' && kit.outro && (
                <Button
                  variant="ghost"
                  onClick={() => setKit({ ...kit, intro: '', outro: '' })}
                >
                  Skip opening and closing cards
                </Button>
              )}
              <p>
                You can change branding in the storyboard. No analysis or
                uploads are required.
              </p>
            </div>
          </div>
        ) : (
          <>
            <div className="bp-heading">
              <div>
                <h3>{recipe.name} storyboard</h3>
                <p>
                  {goal || 'Choose a scene to adjust its footage and timing.'}
                </p>
              </div>
              <span>
                {ready} of {scenes.length} scenes have content
              </span>
            </div>
            <div className="bp-editor">
              <nav className="bp-scenes" aria-label="Storyboard scenes">
                {scenes.map((item, index) => {
                  const asset = media.find(
                    (candidate) => candidate.id === item.assetId,
                  );
                  return (
                    <button
                      key={item.id}
                      aria-current={index === active ? 'step' : undefined}
                      onClick={() => setActive(index)}
                    >
                      <span className="bp-scene-thumb">
                        {asset?.cache.thumbnailPath ? (
                          <img
                            src={`kerfmedia://asset/${encodeURIComponent(asset.id)}/thumbnail`}
                            alt=""
                          />
                        ) : (
                          <Film size={20} />
                        )}
                      </span>
                      <span>
                        <strong>
                          {index + 1}. {item.role}
                        </strong>
                        <small>
                          {item.kind === 'title'
                            ? 'Title card'
                            : (asset?.name ?? 'Choose footage')}
                        </small>
                        <small>
                          {item.durationSeconds.toFixed(1)}s
                          {asset?.kind === 'video'
                            ? ` · from ${item.sourceInSeconds.toFixed(1)}s`
                            : ''}
                        </small>
                      </span>
                    </button>
                  );
                })}
                <Button
                  disabled={scenes.length >= 12}
                  onClick={() => {
                    setScenes([
                      ...scenes,
                      {
                        id: crypto.randomUUID(),
                        role: 'New scene',
                        text: 'New scene',
                        kind: 'footage',
                        durationSeconds: 5,
                        sourceInSeconds: 0,
                        showTitle: false,
                      },
                    ]);
                    setActive(scenes.length);
                  }}
                >
                  <Plus size={14} /> Add scene
                </Button>
              </nav>
              <div className="bp-monitor">
                {plan.value && snapshot && open ? (
                  <div className="bp-preview">
                    <DraftPreview
                      snapshot={snapshot}
                      sequence={plan.value.preview}
                      frame={previewFrame}
                    />
                  </div>
                ) : (
                  <div className="bp-preview-empty">
                    <Film size={28} />
                    <h4>Complete your storyboard to preview</h4>
                    <p>{plan.error}</p>
                  </div>
                )}
                <p className="bp-preview-caption">
                  {plan.value
                    ? `Draft preview · ${length.toFixed(1)} seconds · ${plan.value.offset ? `adds at ${(plan.value.offset / fps).toFixed(1)}s` : 'starts at 0s'}`
                    : 'Required footage must be chosen before you can add the draft.'}
                </p>
                <p>
                  Playback uses the same clips and styling as the timeline. Your
                  existing edit is unchanged.
                </p>
              </div>
              {scene && (
                <aside
                  className="bp-fields bp-scene-details"
                  aria-label="Scene details"
                >
                  <h4>Scene {active + 1}</h4>
                  <label>
                    Scene purpose
                    <Input
                      aria-label="Scene purpose"
                      maxLength={200}
                      value={scene.role}
                      onChange={(event) => patch({ role: event.target.value })}
                    />
                  </label>
                  <label>
                    Content
                    <Select
                      aria-label="Scene type"
                      value={scene.kind}
                      options={[
                        { value: 'footage', label: 'Footage' },
                        { value: 'title', label: 'Title card' },
                      ]}
                      onChange={(event) =>
                        patch({
                          kind:
                            event.target.value === 'title'
                              ? 'title'
                              : 'footage',
                        })
                      }
                    />
                  </label>
                  {scene.kind === 'footage' && (
                    <label>
                      Footage
                      <Select
                        aria-label="Scene footage"
                        value={scene.assetId ?? ''}
                        options={[
                          { value: '', label: 'Choose footage…' },
                          ...media.map((asset) => ({
                            value: asset.id,
                            label: asset.name,
                          })),
                        ]}
                        onChange={(event) => {
                          const asset = media.find(
                            (item) => item.id === event.target.value,
                          );
                          patch({
                            assetId: event.target.value || undefined,
                            sourceInSeconds: 0,
                            durationSeconds:
                              asset?.kind === 'video'
                                ? Math.min(
                                    scene.durationSeconds,
                                    asset.durationSeconds,
                                  )
                                : scene.durationSeconds,
                          });
                        }}
                      />
                    </label>
                  )}
                  {scene.kind === 'footage' &&
                    media.find((asset) => asset.id === scene.assetId)?.kind ===
                      'video' && (
                      <label>
                        Source start (seconds)
                        <Input
                          aria-label="Source start"
                          type="number"
                          min={0}
                          step={0.1}
                          value={Number(scene.sourceInSeconds.toFixed(3))}
                          onChange={(event) =>
                            patch({
                              sourceInSeconds: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    )}
                  {scene.kind === 'footage' &&
                    activeAsset?.kind === 'video' &&
                    snapshot && (
                      <div className="bp-source-trim">
                        <SourcePreview
                          key={activeAsset.id + scene.id}
                          asset={activeAsset}
                          initialFrame={Math.round(scene.sourceInSeconds * fps)}
                          rate={snapshot.project.sequence.frameRate}
                          onFrameChange={setSourceFrame}
                        />
                        <div className="bp-scene-actions">
                          <Button
                            size="sm"
                            onClick={() =>
                              patch({
                                sourceInSeconds: sourceFrame / fps,
                                durationSeconds: Math.min(
                                  scene.durationSeconds,
                                  activeAsset.durationSeconds -
                                    sourceFrame / fps,
                                ),
                              })
                            }
                          >
                            Start here
                          </Button>
                          <Button
                            size="sm"
                            disabled={
                              sourceFrame / fps <= scene.sourceInSeconds
                            }
                            onClick={() =>
                              patch({
                                durationSeconds:
                                  sourceFrame / fps - scene.sourceInSeconds,
                              })
                            }
                          >
                            End here
                          </Button>
                        </div>
                        <p>Scrub the source, then set the range.</p>
                      </div>
                    )}
                  <label>
                    Duration (seconds)
                    <Input
                      aria-label="Scene duration"
                      type="number"
                      min={0.1}
                      max={600}
                      step={0.1}
                      value={Number(scene.durationSeconds.toFixed(3))}
                      onChange={(event) =>
                        patch({ durationSeconds: Number(event.target.value) })
                      }
                    />
                  </label>
                  {scene.kind === 'footage' && (
                    <label className="bp-checkbox">
                      <input
                        type="checkbox"
                        checked={scene.showTitle ?? false}
                        onChange={(event) =>
                          patch({ showTitle: event.target.checked })
                        }
                      />{' '}
                      Show on-screen title
                    </label>
                  )}
                  {(scene.kind === 'title' || scene.showTitle) && (
                    <label>
                      On-screen title
                      <Input
                        aria-label="On-screen title"
                        maxLength={200}
                        value={scene.text}
                        onChange={(event) =>
                          patch({ text: event.target.value })
                        }
                      />
                    </label>
                  )}
                  <div className="bp-scene-actions">
                    <Button
                      aria-label="Move scene earlier"
                      disabled={active === 0}
                      onClick={() => move(-1)}
                    >
                      <ArrowUp size={14} />
                    </Button>
                    <Button
                      aria-label="Move scene later"
                      disabled={active === scenes.length - 1}
                      onClick={() => move(1)}
                    >
                      <ArrowDown size={14} />
                    </Button>
                    <Button
                      disabled={scenes.length >= 12}
                      onClick={() => {
                        setScenes([
                          ...scenes.slice(0, active + 1),
                          { ...scene, id: crypto.randomUUID() },
                          ...scenes.slice(active + 1),
                        ]);
                        setActive(active + 1);
                      }}
                    >
                      Duplicate
                    </Button>
                    <Button
                      aria-label="Remove scene"
                      disabled={scenes.length <= 2}
                      onClick={() => {
                        setScenes(
                          scenes.filter((_, index) => index !== active),
                        );
                        setActive(Math.max(0, active - 1));
                      }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                </aside>
              )}
            </div>
            <div className="bp-bottom">
              <BrandSettings
                kit={kit}
                setKit={setKit}
                library={library}
                media={media}
                logo={logo}
                setLogo={setLogo}
                brandName={brandName}
                setBrandName={setBrandName}
                onSave={() => save('kit')}
              />
              <details>
                <summary>Save Blueprint structure</summary>
                <p>
                  Saves scene purposes and default timing. Choose footage again
                  when reusing it. Brand presets are saved separately.
                </p>
                <div className="bp-save">
                  <Input
                    aria-label="Saved blueprint name"
                    value={savedName}
                    maxLength={80}
                    placeholder="Name this structure"
                    onChange={(event) => setSavedName(event.target.value)}
                  />
                  <Button onClick={() => save('recipe')}>Save Blueprint</Button>
                </div>
              </details>
            </div>
          </>
        )}
      </fieldset>
    </Dialog>
  );
}
