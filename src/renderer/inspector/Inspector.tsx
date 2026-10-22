import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  AudioLines,
  Eye,
  EyeOff,
  Film,
  Layers,
  Plus,
  SlidersHorizontal,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  Clip,
  ClipPatch,
  Effect,
  EffectType,
  Mask,
  TextStyle,
} from '@kerf/model';
import { formatDuration, formatTimecode, maskSchema, newId } from '@kerf/model';
import {
  Button,
  Field,
  FieldRow,
  IconButton,
  Input,
  Panel,
  Select,
  Tabs,
  Textarea,
  cn,
} from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';

type InspectorTab = 'clip' | 'effects' | 'masks';

const EFFECT_OPTIONS: Array<{ value: EffectType; label: string }> = [
  { value: 'blur', label: 'Blur' },
  { value: 'brightness', label: 'Brightness' },
  { value: 'contrast', label: 'Contrast' },
  { value: 'saturate', label: 'Saturation' },
  { value: 'grayscale', label: 'Grayscale' },
  { value: 'sepia', label: 'Sepia' },
  { value: 'hue-rotate', label: 'Hue rotate' },
  { value: 'drop-shadow', label: 'Drop shadow' },
];

const EFFECT_DEFAULT_AMOUNT: Record<EffectType, number> = {
  blur: 4,
  brightness: 1.15,
  contrast: 1.15,
  saturate: 1.2,
  grayscale: 1,
  sepia: 1,
  'hue-rotate': 20,
  'drop-shadow': 12,
};

const EFFECT_STEP: Record<EffectType, number> = {
  blur: 0.5,
  brightness: 0.05,
  contrast: 0.05,
  saturate: 0.05,
  grayscale: 0.05,
  sepia: 0.05,
  'hue-rotate': 1,
  'drop-shadow': 1,
};

const BLEND_OPTIONS = [
  { value: 'normal', label: 'Normal' },
  { value: 'screen', label: 'Screen' },
  { value: 'multiply', label: 'Multiply' },
  { value: 'overlay', label: 'Overlay' },
  { value: 'add', label: 'Add' },
];

const ALIGN_OPTIONS = [
  { value: 'left', label: 'Left' },
  { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' },
];

function trimNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) {
    return '0';
  }
  return String(Number(value.toFixed(digits)));
}

function commitOnEnter(event: KeyboardEvent<HTMLInputElement>): void {
  if (event.key === 'Enter') {
    event.currentTarget.blur();
  }
}

function NumberInput({
  value,
  onCommit,
  min,
  max,
  step = 1,
  integer = false,
  className,
}: {
  readonly value: number;
  readonly onCommit: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
  readonly integer?: boolean;
  readonly className?: string;
}) {
  const [draft, setDraft] = useState(() => trimNumber(value));

  useEffect(() => {
    setDraft(trimNumber(value));
  }, [value]);

  const commit = () => {
    const parsed = Number(draft);
    if (!Number.isFinite(parsed)) {
      setDraft(trimNumber(value));
      return;
    }
    const clamped = Math.min(
      max ?? Number.POSITIVE_INFINITY,
      Math.max(min ?? Number.NEGATIVE_INFINITY, parsed),
    );
    const next = integer ? Math.round(clamped) : clamped;
    setDraft(trimNumber(next));
    onCommit(next);
  };

  return (
    <Input
      className={className}
      value={draft}
      inputMode={integer ? 'numeric' : 'decimal'}
      step={step}
      min={min}
      max={max}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={commitOnEnter}
      onFocus={(event) => event.currentTarget.select()}
    />
  );
}

function TextInput({
  value,
  onCommit,
  placeholder,
  className,
}: {
  readonly value: string;
  readonly onCommit: (value: string) => void;
  readonly placeholder?: string;
  readonly className?: string;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = () => {
    if (draft !== value) {
      onCommit(draft);
    }
  };

  return (
    <Input
      className={className}
      value={draft}
      placeholder={placeholder}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={commit}
      onKeyDown={commitOnEnter}
    />
  );
}

function TextBlockInput({
  value,
  onCommit,
}: {
  readonly value: string;
  readonly onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <Textarea
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) {
          onCommit(draft);
        }
      }}
    />
  );
}

function PercentInput({
  value,
  onCommit,
  min = 0,
  max = 100,
  step = 1,
}: {
  readonly value: number;
  readonly onCommit: (value: number) => void;
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}) {
  return (
    <NumberInput
      value={value * 100}
      min={min}
      max={max}
      step={step}
      onCommit={(next) => onCommit(next / 100)}
    />
  );
}

function ClipHeader({ clip }: { readonly clip: Clip }) {
  const rate = useStudio((state) => state.snapshot?.project.sequence.frameRate);
  const label = clip.label || clip.type;
  return (
    <div className="k-inspector__heading">
      <span className={cn('k-inspector__badge', `is-${clip.type}`)}>
        {clip.type}
      </span>
      <span className="k-inspector__heading-label">{label}</span>
      {rate ? (
        <span className="k-inspector__heading-meta">
          {formatTimecode(clip.startFrame, rate)} ·{' '}
          {formatDuration(clip.durationFrames, rate)}
        </span>
      ) : null}
    </div>
  );
}

function ClipFields({ clip }: { readonly clip: Clip }) {
  const apply = useStudio((state) => state.apply);
  const rate = useStudio((state) => state.snapshot?.project.sequence.frameRate);

  const update = (patch: ClipPatch, label: string) => {
    void apply({ type: 'clip.update', clipId: clip.id, patch }, label);
  };

  const updateTransform = (
    patch: Partial<Clip['transform']>,
    label: string,
  ) => {
    update({ transform: { ...clip.transform, ...patch } }, label);
  };

  return (
    <>
      <Field label="Label" hint="Shown on the timeline and in the monitor.">
        <TextInput
          value={clip.label}
          placeholder={clip.type}
          onCommit={(label) => update({ label }, 'Rename clip')}
        />
      </Field>

      <div className="k-inspector__section">
        <div className="k-inspector__section-title">Timing</div>
        <FieldRow>
          <Field label="Start frame">
            <NumberInput
              value={clip.startFrame}
              min={0}
              integer
              onCommit={(startFrame) =>
                update({ startFrame }, 'Move clip in time')
              }
            />
          </Field>
          <Field label="Duration">
            <NumberInput
              value={clip.durationFrames}
              min={1}
              integer
              onCommit={(durationFrames) =>
                update({ durationFrames }, 'Resize clip')
              }
            />
          </Field>
        </FieldRow>
        {rate ? (
          <p className="k-inspector__hint">
            In {formatTimecode(clip.startFrame, rate)} · Out{' '}
            {formatTimecode(clip.startFrame + clip.durationFrames, rate)}
          </p>
        ) : null}
      </div>

      <div className="k-inspector__section">
        <div className="k-inspector__section-title">Transform</div>
        <FieldRow>
          <Field label="Position X">
            <NumberInput
              value={clip.transform.x}
              step={1}
              onCommit={(x) => updateTransform({ x }, 'Move clip')}
            />
          </Field>
          <Field label="Position Y">
            <NumberInput
              value={clip.transform.y}
              step={1}
              onCommit={(y) => updateTransform({ y }, 'Move clip')}
            />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Scale %">
            <PercentInput
              value={clip.transform.scale}
              min={1}
              max={1000}
              onCommit={(scale) => updateTransform({ scale }, 'Scale clip')}
            />
          </Field>
          <Field label="Rotation °">
            <NumberInput
              value={clip.transform.rotation}
              step={1}
              onCommit={(rotation) =>
                updateTransform({ rotation }, 'Rotate clip')
              }
            />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Opacity %">
            <PercentInput
              value={clip.transform.opacity}
              onCommit={(opacity) =>
                updateTransform({ opacity }, 'Change clip opacity')
              }
            />
          </Field>
          <Field label="Blend mode">
            <Select
              value={clip.blendMode}
              options={BLEND_OPTIONS}
              onChange={(event) =>
                update(
                  {
                    blendMode: event.target.value as Clip['blendMode'],
                  },
                  'Change blend mode',
                )
              }
            />
          </Field>
        </FieldRow>
        <FieldRow>
          <Field label="Anchor X %">
            <PercentInput
              value={clip.transform.anchorX}
              onCommit={(anchorX) =>
                updateTransform({ anchorX }, 'Change transform anchor')
              }
            />
          </Field>
          <Field label="Anchor Y %">
            <PercentInput
              value={clip.transform.anchorY}
              onCommit={(anchorY) =>
                updateTransform({ anchorY }, 'Change transform anchor')
              }
            />
          </Field>
        </FieldRow>
      </div>

      {(clip.type === 'video' || clip.type === 'audio') && (
        <div className="k-inspector__section">
          <div className="k-inspector__section-title">
            {clip.type === 'audio' ? 'Audio' : 'Media'}
          </div>
          <FieldRow>
            <Field label="Speed %">
              <PercentInput
                value={clip.speed}
                min={10}
                max={1600}
                step={5}
                onCommit={(speed) =>
                  void apply(
                    { type: 'clip.setSpeed', clipId: clip.id, speed },
                    'Change clip speed',
                  )
                }
              />
            </Field>
            <Field label="Volume %">
              <PercentInput
                value={clip.volume}
                min={0}
                max={400}
                step={5}
                onCommit={(volume) => update({ volume }, 'Change clip volume')}
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Fade in (frames)">
              <NumberInput
                value={clip.fade.inFrames}
                min={0}
                max={clip.durationFrames}
                integer
                onCommit={(inFrames) =>
                  update(
                    {
                      fade: { ...clip.fade, inFrames },
                    },
                    'Change fade in',
                  )
                }
              />
            </Field>
            <Field label="Fade out (frames)">
              <NumberInput
                value={clip.fade.outFrames}
                min={0}
                max={clip.durationFrames}
                integer
                onCommit={(outFrames) =>
                  update(
                    {
                      fade: { ...clip.fade, outFrames },
                    },
                    'Change fade out',
                  )
                }
              />
            </Field>
          </FieldRow>
        </div>
      )}

      {clip.type === 'image' && (
        <Field label="Fit" hint="Contain keeps the whole still in frame.">
          <Select
            value={clip.fit}
            options={[
              { value: 'contain', label: 'Contain' },
              { value: 'cover', label: 'Cover' },
              { value: 'fill', label: 'Fill' },
            ]}
            onChange={(event) =>
              update(
                { fit: event.target.value as 'contain' | 'cover' | 'fill' },
                'Change image fit',
              )
            }
          />
        </Field>
      )}

      {(clip.type === 'text' || clip.type === 'caption') && (
        <div className="k-inspector__section">
          <div className="k-inspector__section-title">Type</div>
          <Field label="Content">
            <TextBlockInput
              value={clip.text}
              onCommit={(text) => update({ text }, 'Edit text')}
            />
          </Field>
          <FieldRow>
            <Field label="Size">
              <NumberInput
                value={clip.style.fontSize}
                min={6}
                max={400}
                onCommit={(fontSize) =>
                  update(
                    { style: { ...clip.style, fontSize } },
                    'Change text size',
                  )
                }
              />
            </Field>
            <Field label="Weight">
              <NumberInput
                value={clip.style.fontWeight}
                min={100}
                max={900}
                step={100}
                integer
                onCommit={(fontWeight) =>
                  update(
                    { style: { ...clip.style, fontWeight } },
                    'Change text weight',
                  )
                }
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Color">
              <TextInput
                value={clip.style.color}
                onCommit={(color) =>
                  update(
                    { style: { ...clip.style, color } },
                    'Change text color',
                  )
                }
              />
            </Field>
            <Field label="Align">
              <Select
                value={clip.style.align}
                options={ALIGN_OPTIONS}
                onChange={(event) =>
                  update(
                    {
                      style: {
                        ...clip.style,
                        align: event.target.value as TextStyle['align'],
                      },
                    },
                    'Align text',
                  )
                }
              />
            </Field>
          </FieldRow>
          <Field label="Background">
            <TextInput
              value={clip.style.background ?? ''}
              placeholder="transparent"
              onCommit={(background) =>
                update(
                  {
                    style: {
                      ...clip.style,
                      background: background.trim() || null,
                    },
                  },
                  'Change text background',
                )
              }
            />
          </Field>
        </div>
      )}

      {clip.type === 'shape' && (
        <div className="k-inspector__section">
          <div className="k-inspector__section-title">Shape</div>
          <FieldRow>
            <Field label="Width %">
              <PercentInput
                value={clip.width}
                min={1}
                max={400}
                onCommit={(width) => update({ width }, 'Resize shape')}
              />
            </Field>
            <Field label="Height %">
              <PercentInput
                value={clip.height}
                min={1}
                max={400}
                onCommit={(height) => update({ height }, 'Resize shape')}
              />
            </Field>
          </FieldRow>
          <FieldRow>
            <Field label="Fill">
              <TextInput
                value={clip.fill}
                onCommit={(fill) => update({ fill }, 'Change shape fill')}
              />
            </Field>
            <Field label="Stroke">
              <TextInput
                value={clip.stroke ?? ''}
                placeholder="none"
                onCommit={(stroke) =>
                  update(
                    { stroke: stroke.trim() || null },
                    'Change shape stroke',
                  )
                }
              />
            </Field>
          </FieldRow>
        </div>
      )}
    </>
  );
}

function EffectsPanel({ clip }: { readonly clip: Clip }) {
  const apply = useStudio((state) => state.apply);
  const [effectType, setEffectType] = useState<EffectType>('blur');

  const addEffect = () => {
    const effect = {
      id: newId('effect'),
      type: effectType,
      enabled: true,
      amount: EFFECT_DEFAULT_AMOUNT[effectType],
    } satisfies Effect;
    void apply(
      { type: 'clip.addEffect', clipId: clip.id, effect },
      'Add effect',
    );
  };

  return (
    <div className="k-inspector__stack">
      <div className="k-inspector__inline">
        <Select
          value={effectType}
          options={EFFECT_OPTIONS}
          onChange={(event) => setEffectType(event.target.value as EffectType)}
        />
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Plus size={13} />}
          onClick={addEffect}
        >
          Add
        </Button>
      </div>

      {clip.effects.length === 0 ? (
        <div className="k-inspector__note">
          <Sparkles size={14} aria-hidden="true" />
          <p>No effects yet. Blur, colour and shadow filters render live.</p>
        </div>
      ) : (
        <div className="k-inspector__list">
          {clip.effects.map((effect) => (
            <div className="k-inspector__item" key={effect.id}>
              <div className="k-inspector__item-head">
                <IconButton
                  label={effect.enabled ? 'Disable effect' : 'Enable effect'}
                  size="sm"
                  icon={
                    effect.enabled ? <Eye size={13} /> : <EyeOff size={13} />
                  }
                  onClick={() =>
                    void apply(
                      {
                        type: 'clip.updateEffect',
                        clipId: clip.id,
                        effectId: effect.id,
                        patch: { enabled: !effect.enabled },
                      },
                      'Toggle effect',
                    )
                  }
                />
                <Select
                  value={effect.type}
                  options={EFFECT_OPTIONS}
                  onChange={(event) => {
                    const next = event.target.value as EffectType;
                    void apply(
                      {
                        type: 'clip.updateEffect',
                        clipId: clip.id,
                        effectId: effect.id,
                        patch: {
                          type: next,
                          amount: EFFECT_DEFAULT_AMOUNT[next],
                        },
                      },
                      'Change effect',
                    );
                  }}
                />
                <IconButton
                  label="Remove effect"
                  size="sm"
                  icon={<Trash2 size={13} />}
                  onClick={() =>
                    void apply(
                      {
                        type: 'clip.removeEffect',
                        clipId: clip.id,
                        effectId: effect.id,
                      },
                      'Remove effect',
                    )
                  }
                />
              </div>
              <Field label="Amount">
                <NumberInput
                  value={effect.amount}
                  step={EFFECT_STEP[effect.type]}
                  onCommit={(amount) =>
                    void apply(
                      {
                        type: 'clip.updateEffect',
                        clipId: clip.id,
                        effectId: effect.id,
                        patch: { amount },
                      },
                      'Change effect amount',
                    )
                  }
                />
              </Field>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function MasksPanel({ clip }: { readonly clip: Clip }) {
  const apply = useStudio((state) => state.apply);

  const addMask = (type: Mask['type']) => {
    const mask = maskSchema.parse({
      id: newId('mask'),
      type,
      path:
        type === 'path' ? 'M 0.1 0.1 L 0.9 0.1 L 0.9 0.9 L 0.1 0.9 Z' : null,
    });
    void apply({ type: 'clip.addMask', clipId: clip.id, mask }, 'Add mask');
  };

  return (
    <div className="k-inspector__stack">
      <div className="k-inspector__inline k-inspector__inline--wrap">
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Plus size={13} />}
          onClick={() => addMask('rect')}
        >
          Rect
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Plus size={13} />}
          onClick={() => addMask('ellipse')}
        >
          Ellipse
        </Button>
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<Plus size={13} />}
          onClick={() => addMask('path')}
        >
          Path
        </Button>
      </div>

      {clip.masks.length === 0 ? (
        <div className="k-inspector__note">
          <Layers size={14} aria-hidden="true" />
          <p>No masks. Add a shape to cut the layer without re-rendering it.</p>
        </div>
      ) : (
        <div className="k-inspector__list">
          {clip.masks.map((mask) => (
            <div className="k-inspector__item" key={mask.id}>
              <div className="k-inspector__item-head">
                <span className="k-inspector__item-title">
                  {mask.type === 'rect'
                    ? 'Rectangle'
                    : mask.type === 'ellipse'
                      ? 'Ellipse'
                      : 'Path'}
                </span>
                <IconButton
                  label={mask.inverted ? 'Use mask' : 'Invert mask'}
                  size="sm"
                  icon={
                    mask.inverted ? <EyeOff size={13} /> : <Eye size={13} />
                  }
                  onClick={() =>
                    void apply(
                      {
                        type: 'clip.updateMask',
                        clipId: clip.id,
                        maskId: mask.id,
                        patch: { inverted: !mask.inverted },
                      },
                      'Invert mask',
                    )
                  }
                />
                <IconButton
                  label="Remove mask"
                  size="sm"
                  icon={<Trash2 size={13} />}
                  onClick={() =>
                    void apply(
                      {
                        type: 'clip.removeMask',
                        clipId: clip.id,
                        maskId: mask.id,
                      },
                      'Remove mask',
                    )
                  }
                />
              </div>
              <FieldRow>
                <Field label="X %">
                  <PercentInput
                    value={mask.x}
                    onCommit={(x) =>
                      void apply(
                        {
                          type: 'clip.updateMask',
                          clipId: clip.id,
                          maskId: mask.id,
                          patch: { x },
                        },
                        'Move mask',
                      )
                    }
                  />
                </Field>
                <Field label="Y %">
                  <PercentInput
                    value={mask.y}
                    onCommit={(y) =>
                      void apply(
                        {
                          type: 'clip.updateMask',
                          clipId: clip.id,
                          maskId: mask.id,
                          patch: { y },
                        },
                        'Move mask',
                      )
                    }
                  />
                </Field>
              </FieldRow>
              <FieldRow>
                <Field label="Width %">
                  <PercentInput
                    value={mask.width}
                    onCommit={(width) =>
                      void apply(
                        {
                          type: 'clip.updateMask',
                          clipId: clip.id,
                          maskId: mask.id,
                          patch: { width },
                        },
                        'Resize mask',
                      )
                    }
                  />
                </Field>
                <Field label="Height %">
                  <PercentInput
                    value={mask.height}
                    onCommit={(height) =>
                      void apply(
                        {
                          type: 'clip.updateMask',
                          clipId: clip.id,
                          maskId: mask.id,
                          patch: { height },
                        },
                        'Resize mask',
                      )
                    }
                  />
                </Field>
              </FieldRow>
              {mask.type === 'path' ? (
                <Field label="Path">
                  <TextInput
                    value={mask.path ?? ''}
                    placeholder="M 0.1 0.1 L 0.9 0.1 …"
                    onCommit={(path) =>
                      void apply(
                        {
                          type: 'clip.updateMask',
                          clipId: clip.id,
                          maskId: mask.id,
                          patch: { path: path.trim() || null },
                        },
                        'Edit mask path',
                      )
                    }
                  />
                </Field>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function InspectorBody({ clip }: { readonly clip: Clip }) {
  const [tab, setTab] = useState<InspectorTab>('clip');
  const label = clip.label || clip.type;

  return (
    <Panel title="Inspector" subtitle={label} bodyClassName="p-0">
      <Tabs
        label="Inspector sections"
        value={tab}
        onValueChange={(value) => setTab(value as InspectorTab)}
        items={[
          {
            id: 'clip',
            label: clip.type === 'audio' ? 'Audio' : 'Clip',
            icon:
              clip.type === 'audio' ? (
                <AudioLines size={13} />
              ) : (
                <SlidersHorizontal size={13} />
              ),
          },
          {
            id: 'effects',
            label: 'Effects',
            icon: <Sparkles size={13} />,
            badge: clip.effects.length || undefined,
          },
          {
            id: 'masks',
            label: 'Masks',
            icon: <Layers size={13} />,
            badge: clip.masks.length || undefined,
          },
        ]}
      />
      <ClipHeader clip={clip} />
      {tab === 'clip' ? (
        <div className="k-inspector__stack">
          <ClipFields clip={clip} />
        </div>
      ) : tab === 'effects' ? (
        <EffectsPanel clip={clip} />
      ) : (
        <MasksPanel clip={clip} />
      )}
    </Panel>
  );
}

function SequenceSummary() {
  const snapshot = useStudio((state) => state.snapshot);
  const selection = useStudio((state) => state.selection);
  const sequence = snapshot?.project.sequence;

  const summary = useMemo(() => {
    if (!sequence) {
      return null;
    }
    return {
      name: sequence.name,
      tracks: sequence.tracks.length,
      clips: sequence.tracks.reduce(
        (total, track) => total + track.clips.length,
        0,
      ),
      duration: formatDuration(
        sequence.tracks.reduce(
          (end, track) =>
            Math.max(
              end,
              ...track.clips.map(
                (clip) => clip.startFrame + clip.durationFrames,
              ),
            ),
          0,
        ),
        sequence.frameRate,
      ),
    };
  }, [sequence]);

  return (
    <Panel title="Inspector" subtitle={summary?.name ?? 'Sequence'}>
      <div className="k-inspector__stack">
        <div className="k-inspector__empty">
          {selection.clipIds.length > 1 ? (
            <>
              <Layers size={22} aria-hidden="true" />
              <p>{selection.clipIds.length} clips selected</p>
              <span>Select one clip to edit its properties.</span>
            </>
          ) : (
            <>
              <Film size={22} aria-hidden="true" />
              <p>No clip selected</p>
              <span>Select a clip on the timeline to inspect it.</span>
            </>
          )}
        </div>
        {summary ? (
          <div className="k-inspector__summary">
            <div>
              <span>Tracks</span>
              <strong>{summary.tracks}</strong>
            </div>
            <div>
              <span>Clips</span>
              <strong>{summary.clips}</strong>
            </div>
            <div>
              <span>Duration</span>
              <strong>{summary.duration}</strong>
            </div>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}

export function Inspector() {
  const snapshot = useStudio((state) => state.snapshot);
  const selection = useStudio((state) => state.selection);
  const clip = useMemo(() => {
    if (!snapshot || selection.clipIds.length !== 1) {
      return null;
    }
    const id = selection.clipIds[0];
    return (
      snapshot.project.sequence.tracks
        .flatMap((track) => track.clips)
        .find((candidate) => candidate.id === id) ?? null
    );
  }, [selection.clipIds, snapshot]);

  if (!clip) {
    return <SequenceSummary />;
  }

  return <InspectorBody key={clip.id} clip={clip} />;
}
