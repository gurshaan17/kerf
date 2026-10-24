import { useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent } from 'react';
import {
  Activity,
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
  EasingName,
  Effect,
  EffectType,
  Mask,
  NumberKeyframe,
  TextStyle,
} from '@kerf/model';
import {
  formatDuration,
  formatTimecode,
  maskSchema,
  newId,
  sampleNumberKeyframes,
  sortKeyframes,
} from '@kerf/model';
import { sourceFrameAt } from '@kerf/engine';
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
import { selectSelectedClip } from '../state/selectors';

type InspectorTab = 'clip' | 'effects' | 'motion' | 'masks';

type KeyframeProperty = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume';

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

const KEYFRAME_PROPERTIES: Array<{
  id: KeyframeProperty;
  label: string;
  unit: string;
  step: number;
}> = [
  { id: 'x', label: 'Position X', unit: 'px', step: 1 },
  { id: 'y', label: 'Position Y', unit: 'px', step: 1 },
  { id: 'scale', label: 'Scale', unit: '×', step: 0.01 },
  { id: 'rotation', label: 'Rotation', unit: '°', step: 1 },
  { id: 'opacity', label: 'Opacity', unit: '', step: 0.01 },
  { id: 'volume', label: 'Volume', unit: '', step: 0.01 },
];

const EASING_OPTIONS: Array<{ value: EasingName; label: string }> = [
  { value: 'linear', label: 'Linear' },
  { value: 'ease-in', label: 'Ease in' },
  { value: 'ease-out', label: 'Ease out' },
  { value: 'ease-in-out', label: 'Ease in-out' },
  { value: 'hold', label: 'Hold' },
];

function baseKeyframeValue(clip: Clip, property: KeyframeProperty): number {
  if (property === 'volume') {
    return clip.type === 'video' || clip.type === 'audio' ? clip.volume : 0;
  }
  return clip.transform[property];
}

interface KeyframeDrag {
  readonly property: KeyframeProperty;
  readonly index: number;
  readonly keyframes: readonly NumberKeyframe[];
  readonly startClientX: number;
  readonly startFrame: number;
  readonly laneWidth: number;
}

function KeyframeTrail({
  property,
  keyframes,
  durationFrames,
  selectedFrame,
  onSelect,
  onDragStart,
}: {
  readonly property: KeyframeProperty;
  readonly keyframes: readonly NumberKeyframe[];
  readonly durationFrames: number;
  readonly selectedFrame: number | null;
  readonly onSelect: (frame: number) => void;
  readonly onDragStart: (
    event: React.PointerEvent<HTMLButtonElement>,
    property: KeyframeProperty,
    index: number,
    keyframes: readonly NumberKeyframe[],
  ) => void;
}) {
  return (
    <div className="k-keyframe-lane">
      <span className="k-keyframe-lane__rule" aria-hidden="true" />
      {keyframes.map((keyframe, index) => (
        <button
          key={`${keyframe.frame}-${index}`}
          type="button"
          className={cn(
            'k-keyframe-dot',
            selectedFrame === keyframe.frame && 'is-selected',
          )}
          style={{
            left: `${Math.min(100, Math.max(0, (keyframe.frame / Math.max(1, durationFrames)) * 100))}%`,
          }}
          aria-label={`Keyframe at ${keyframe.frame} frames`}
          title={`${keyframe.frame} · ${trimNumber(keyframe.value)}`}
          onPointerDown={(event) =>
            onDragStart(event, property, index, keyframes)
          }
          onClick={(event) => {
            event.stopPropagation();
            onSelect(keyframe.frame);
          }}
        />
      ))}
    </div>
  );
}

function MotionPanel({ clip }: { readonly clip: Clip }) {
  const apply = useStudio((state) => state.apply);
  const playhead = useStudio((state) => state.playhead);
  const pushToast = useStudio((state) => state.pushToast);
  const [selected, setSelected] = useState<{
    readonly property: KeyframeProperty;
    readonly frame: number;
  } | null>(null);
  const [drag, setDrag] = useState<KeyframeDrag | null>(null);

  const isMedia = clip.type === 'video' || clip.type === 'audio';
  const properties = KEYFRAME_PROPERTIES.filter(
    (property) => property.id !== 'volume' || isMedia,
  );
  const localPlayhead = Math.min(
    clip.durationFrames - 1,
    Math.max(0, Math.round(playhead - clip.startFrame)),
  );

  useEffect(() => {
    if (!drag) {
      return;
    }
    const onPointerMove = (event: PointerEvent) => {
      const delta = event.clientX - drag.startClientX;
      const frame = Math.min(
        clip.durationFrames - 1,
        Math.max(
          0,
          Math.round(
            drag.startFrame +
              (delta / Math.max(1, drag.laneWidth)) * clip.durationFrames,
          ),
        ),
      );
      setDrag((current) => {
        if (!current) {
          return current;
        }
        const keyframes = current.keyframes.map((keyframe, index) =>
          index === current.index ? { ...keyframe, frame } : keyframe,
        );
        return { ...current, keyframes };
      });
    };
    const finish = () => {
      const current = drag;
      const moved = current.keyframes[current.index];
      setDrag(null);
      void apply(
        {
          type: 'clip.setKeyframes',
          clipId: clip.id,
          property: current.property,
          keyframes: sortKeyframes(current.keyframes),
        },
        'Move keyframe',
      );
      setSelected({
        property: current.property,
        frame: moved?.frame ?? current.startFrame,
      });
    };
    const cancel = () => setDrag(null);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', cancel);
    };
  }, [apply, clip.durationFrames, clip.id, drag]);

  const selectedKeyframe = (() => {
    if (!selected) {
      return null;
    }
    const keyframes = clip.keyframes[selected.property];
    const index = keyframes.findIndex(
      (keyframe) => keyframe.frame === selected.frame,
    );
    const keyframe = keyframes[index];
    return index >= 0 && keyframe ? { index, keyframe } : null;
  })();

  const commitKeyframes = (
    property: KeyframeProperty,
    keyframes: readonly NumberKeyframe[],
    label: string,
  ) => {
    void apply(
      {
        type: 'clip.setKeyframes',
        clipId: clip.id,
        property,
        keyframes: sortKeyframes(keyframes),
      },
      label,
    );
  };

  const addKeyframe = (property: KeyframeProperty) => {
    const keyframes = [...clip.keyframes[property]];
    const existing = keyframes.findIndex(
      (keyframe) => keyframe.frame === localPlayhead,
    );
    const value =
      sampleNumberKeyframes(keyframes, localPlayhead) ??
      baseKeyframeValue(clip, property);
    const next: NumberKeyframe = {
      frame: localPlayhead,
      value,
      easing: 'linear',
    };
    if (existing >= 0) {
      keyframes[existing] = { ...next, easing: keyframes[existing]!.easing };
    } else {
      keyframes.push(next);
    }
    setSelected({ property, frame: localPlayhead });
    commitKeyframes(property, keyframes, 'Add keyframe');
  };

  const removeKeyframe = () => {
    if (!selected || !selectedKeyframe) {
      return;
    }
    const keyframes = clip.keyframes[selected.property].filter(
      (_, index) => index !== selectedKeyframe.index,
    );
    setSelected(null);
    commitKeyframes(selected.property, keyframes, 'Remove keyframe');
  };

  const updateKeyframe = (patch: Partial<NumberKeyframe>, label: string) => {
    if (!selected || !selectedKeyframe) {
      return;
    }
    const keyframes = clip.keyframes[selected.property].map((keyframe, index) =>
      index === selectedKeyframe.index ? { ...keyframe, ...patch } : keyframe,
    );
    if (patch.frame !== undefined) {
      setSelected({ property: selected.property, frame: patch.frame });
    }
    commitKeyframes(selected.property, keyframes, label);
  };

  const dragStart = (
    event: React.PointerEvent<HTMLButtonElement>,
    property: KeyframeProperty,
    index: number,
    keyframes: readonly NumberKeyframe[],
  ) => {
    if (event.button !== 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const keyframe = keyframes[index];
    if (!keyframe) {
      return;
    }
    const lane = event.currentTarget.closest<HTMLElement>('.k-keyframe-lane');
    const laneWidth = lane?.getBoundingClientRect().width ?? 1;
    setSelected({ property, frame: keyframe.frame });
    setDrag({
      property,
      index,
      keyframes,
      startClientX: event.clientX,
      startFrame: keyframe.frame,
      laneWidth,
    });
  };

  const timeMap =
    clip.type === 'video' || clip.type === 'audio' ? clip.timeMap : [];
  const timeMapMax = Math.max(1, ...timeMap.map((point) => point.sourceFrame));
  const timeMapPath = timeMap
    .map(
      (point) =>
        `${(point.frame / Math.max(1, clip.durationFrames)) * 100},${
          40 - (point.sourceFrame / timeMapMax) * 34
        }`,
    )
    .join(' ');

  const commitTimeMap = (
    points: Array<{ frame: number; sourceFrame: number }>,
    label: string,
  ) => {
    const frames = new Set<number>();
    for (const point of points) {
      if (frames.has(point.frame)) {
        pushToast({
          title: 'Speed ramp needs unique frames',
          description: 'Two ramp points cannot share the same frame.',
          tone: 'warning',
        });
        return;
      }
      frames.add(point.frame);
    }
    const sorted = [...points].sort((left, right) => left.frame - right.frame);
    void apply(
      { type: 'clip.setTimeMap', clipId: clip.id, points: sorted },
      label,
    );
  };

  const addRampPoint = () => {
    if (clip.type !== 'video' && clip.type !== 'audio') {
      return;
    }
    const sourceFrame = sourceFrameAt(clip, clip.startFrame + localPlayhead);
    commitTimeMap(
      [
        ...timeMap.filter((point) => point.frame !== localPlayhead),
        { frame: localPlayhead, sourceFrame },
      ],
      'Add speed ramp point',
    );
  };

  return (
    <div className="k-inspector__stack">
      <div className="k-motion__head">
        <span>Keyframes</span>
        <span className="k-inspector__hint">Playhead {localPlayhead}f</span>
      </div>
      <div className="k-motion__list">
        {properties.map((property) => {
          const keyframes = clip.keyframes[property.id];
          const activeKeyframes =
            drag?.property === property.id ? drag.keyframes : keyframes;
          return (
            <div className="k-motion__property" key={property.id}>
              <div className="k-motion__property-head">
                <span>{property.label}</span>
                <span className="k-motion__count">
                  {keyframes.length} {keyframes.length === 1 ? 'key' : 'keys'}
                </span>
                <IconButton
                  label={`Add ${property.label} keyframe`}
                  size="sm"
                  icon={<Plus size={13} />}
                  onClick={() => addKeyframe(property.id)}
                />
              </div>
              <KeyframeTrail
                property={property.id}
                keyframes={activeKeyframes}
                durationFrames={clip.durationFrames}
                selectedFrame={
                  selected?.property === property.id ? selected.frame : null
                }
                onSelect={(frame) =>
                  setSelected({ property: property.id, frame })
                }
                onDragStart={dragStart}
              />
            </div>
          );
        })}
      </div>

      {selected && selectedKeyframe ? (
        <div className="k-inspector__item">
          <div className="k-inspector__item-head">
            <span className="k-inspector__item-title">
              {KEYFRAME_PROPERTIES.find(
                (property) => property.id === selected.property,
              )?.label ?? selected.property}{' '}
              keyframe
            </span>
            <IconButton
              label="Remove keyframe"
              size="sm"
              icon={<Trash2 size={13} />}
              onClick={removeKeyframe}
            />
          </div>
          <FieldRow>
            <Field label="Frame">
              <NumberInput
                value={selectedKeyframe.keyframe.frame}
                min={0}
                max={clip.durationFrames - 1}
                integer
                onCommit={(frame) => updateKeyframe({ frame }, 'Move keyframe')}
              />
            </Field>
            <Field label="Value">
              <NumberInput
                value={selectedKeyframe.keyframe.value}
                step={1}
                onCommit={(value) =>
                  updateKeyframe({ value }, 'Change keyframe value')
                }
              />
            </Field>
          </FieldRow>
          <Field label="Easing">
            <Select
              value={
                typeof selectedKeyframe.keyframe.easing === 'string'
                  ? selectedKeyframe.keyframe.easing
                  : 'linear'
              }
              options={EASING_OPTIONS}
              onChange={(event) =>
                updateKeyframe(
                  { easing: event.target.value as EasingName },
                  'Change keyframe easing',
                )
              }
            />
          </Field>
        </div>
      ) : (
        <div className="k-inspector__note">
          <Activity size={14} aria-hidden="true" />
          <p>Add a keyframe at the playhead, then drag it along the lane.</p>
        </div>
      )}

      <div className="k-inspector__section">
        <div className="k-inspector__section-title">Speed ramp</div>
        {clip.type === 'video' || clip.type === 'audio' ? (
          <>
            <div className="k-speed-ramp">
              {timeMap.length > 1 ? (
                <svg viewBox="0 0 100 40" preserveAspectRatio="none">
                  <polyline points={timeMapPath} />
                </svg>
              ) : (
                <span>Two or more points create a ramp.</span>
              )}
            </div>
            <div className="k-inspector__inline">
              <Button
                size="sm"
                variant="secondary"
                leadingIcon={<Plus size={13} />}
                onClick={addRampPoint}
              >
                Add point at playhead
              </Button>
              <span className="k-inspector__hint">
                {timeMap.length} {timeMap.length === 1 ? 'point' : 'points'}
              </span>
            </div>
            {timeMap.length > 0 ? (
              <div className="k-inspector__list">
                {timeMap.map((point, index) => (
                  <div
                    className="k-inspector__item"
                    key={`${point.frame}-${index}`}
                  >
                    <div className="k-inspector__item-head">
                      <span className="k-inspector__item-title">
                        Point {index + 1}
                      </span>
                      <IconButton
                        label="Remove speed ramp point"
                        size="sm"
                        icon={<Trash2 size={13} />}
                        onClick={() =>
                          commitTimeMap(
                            timeMap.filter(
                              (_, pointIndex) => pointIndex !== index,
                            ),
                            'Remove speed ramp point',
                          )
                        }
                      />
                    </div>
                    <FieldRow>
                      <Field label="Frame">
                        <NumberInput
                          value={point.frame}
                          min={0}
                          max={clip.durationFrames - 1}
                          integer
                          onCommit={(frame) =>
                            commitTimeMap(
                              timeMap.map((candidate, pointIndex) =>
                                pointIndex === index
                                  ? { ...candidate, frame }
                                  : candidate,
                              ),
                              'Move speed ramp point',
                            )
                          }
                        />
                      </Field>
                      <Field label="Source frame">
                        <NumberInput
                          value={point.sourceFrame}
                          min={0}
                          integer
                          onCommit={(sourceFrame) =>
                            commitTimeMap(
                              timeMap.map((candidate, pointIndex) =>
                                pointIndex === index
                                  ? { ...candidate, sourceFrame }
                                  : candidate,
                              ),
                              'Change speed ramp',
                            )
                          }
                        />
                      </Field>
                    </FieldRow>
                  </div>
                ))}
              </div>
            ) : (
              <p className="k-inspector__hint">
                The clip uses its constant speed until a ramp point is added.
              </p>
            )}
          </>
        ) : (
          <p className="k-inspector__hint">
            Speed ramps apply to video and audio clips.
          </p>
        )}
      </div>
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
            id: 'motion',
            label: 'Motion',
            icon: <Activity size={13} />,
            badge:
              Object.values(clip.keyframes).reduce(
                (total, keyframes) => total + keyframes.length,
                0,
              ) || undefined,
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
      ) : tab === 'motion' ? (
        <MotionPanel clip={clip} />
      ) : (
        <MasksPanel clip={clip} />
      )}
    </Panel>
  );
}

function SequenceSummary() {
  const sequence = useStudio(
    (state) => state.snapshot?.project.sequence ?? null,
  );
  const selection = useStudio((state) => state.selection);

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
  const clip = useStudio(selectSelectedClip);

  if (!clip) {
    return <SequenceSummary />;
  }

  return <InspectorBody key={clip.id} clip={clip} />;
}
