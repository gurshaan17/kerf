import type { ComponentType } from 'react';
import {
  Droplets,
  Focus,
  MessageSquareText,
  Plus,
  Sparkles,
  Trash2,
  Unlink,
  Wand2,
  ZoomIn,
} from 'lucide-react';
import type {
  Clip,
  EditCommand,
  FxOverlayClip,
  OverlayKind,
  Sequence,
} from '@kerf/model';
import {
  clipSchema,
  formatDuration,
  formatTimecode,
  newId,
  secondsToFrames,
} from '@kerf/model';
import { ensureEffectsTrackCommands, findClip } from '@kerf/engine';
import { defaultOverlayProps } from '@kerf/tools';
import { Button, IconButton, Panel } from '@kerf/ui';
import { useStudio } from '../state/StudioProvider';
import { selectSelectedClip } from '../state/selectors';

const FALLBACK_OVERLAY_SECONDS = 3;

const OVERLAY_LABELS: Record<OverlayKind, string> = {
  blur: 'Blur',
  callout: 'Callout',
  spotlight: 'Spotlight',
  zoom: 'Zoom',
};

interface OverlayCard {
  readonly kind: OverlayKind;
  readonly title: string;
  readonly description: string;
  readonly icon: ComponentType<{ size?: number | string }>;
}

const OVERLAY_CARDS: readonly OverlayCard[] = [
  {
    kind: 'blur',
    title: 'Blur',
    description: 'Obscure a region with a gaussian or pixelated blur.',
    icon: Droplets,
  },
  {
    kind: 'callout',
    title: 'Callout',
    description: 'Label a detail with a text card and optional pointer.',
    icon: MessageSquareText,
  },
  {
    kind: 'spotlight',
    title: 'Spotlight',
    description: 'Dim everything outside a rect or ellipse.',
    icon: Focus,
  },
  {
    kind: 'zoom',
    title: 'Zoom',
    description: 'Magnify a region through a clean lens.',
    icon: ZoomIn,
  },
];

function visualSource(clip: Clip | null): Clip | null {
  if (!clip || clip.type === 'fxOverlay' || clip.type === 'audio') {
    return null;
  }
  return clip;
}

function overlayClips(sequence: Sequence): FxOverlayClip[] {
  return sequence.tracks
    .filter((track) => track.kind === 'effects')
    .flatMap((track) => track.clips)
    .filter((clip): clip is FxOverlayClip => clip.type === 'fxOverlay')
    .sort((left, right) => left.startFrame - right.startFrame);
}

function linkedLabel(sequence: Sequence, overlay: FxOverlayClip): string {
  if (!overlay.linkedItemId) {
    return 'Unlinked';
  }
  const source = findClip(sequence, overlay.linkedItemId)?.clip;
  return source
    ? `Linked to ${source.label || source.type}`
    : 'Linked clip missing';
}

export function EffectsPanel() {
  const sequence = useStudio((state) => state.snapshot?.project.sequence);
  const selected = useStudio(selectSelectedClip);
  const playhead = useStudio((state) => state.playhead);
  const selection = useStudio((state) => state.selection);
  const apply = useStudio((state) => state.apply);
  const selectClip = useStudio((state) => state.selectClip);
  const setPlayhead = useStudio((state) => state.setPlayhead);

  if (!sequence) {
    return null;
  }

  const overlays = overlayClips(sequence);
  const effectsTrack = sequence.tracks.find(
    (track) => track.kind === 'effects',
  );
  const locked = effectsTrack?.locked ?? false;
  const source = visualSource(selected);
  const rate = sequence.frameRate;

  const addOverlay = async (kind: OverlayKind) => {
    const effects = ensureEffectsTrackCommands(sequence);
    const startFrame = source?.startFrame ?? playhead;
    const durationFrames =
      source?.durationFrames ??
      Math.max(1, Math.round(secondsToFrames(FALLBACK_OVERLAY_SECONDS, rate)));
    const overlay = clipSchema.parse({
      id: newId('clip'),
      trackId: effects.trackId,
      type: 'fxOverlay',
      startFrame: Math.max(0, Math.round(startFrame)),
      durationFrames: Math.max(1, Math.round(durationFrames)),
      label: OVERLAY_LABELS[kind],
      linkedItemId: source?.id ?? null,
      props: defaultOverlayProps(kind),
    }) as FxOverlayClip;
    const commands: EditCommand[] = [
      ...effects.commands,
      { type: 'clip.insert', clip: overlay },
    ];
    const command: EditCommand =
      commands.length === 1
        ? commands[0]!
        : {
            type: 'batch',
            label: effects.created
              ? 'Add overlay and Effects track'
              : 'Add overlay',
            commands,
          };
    const result = await apply(
      command,
      effects.created ? 'Add overlay and Effects track' : 'Add overlay',
    );
    if (result) {
      selectClip(overlay.id);
      setPlayhead(overlay.startFrame);
    }
  };

  const unlink = (overlay: FxOverlayClip) => {
    void apply(
      {
        type: 'clip.update',
        clipId: overlay.id,
        patch: { linkedItemId: null },
      },
      'Unlink overlay',
    );
  };

  const remove = (overlay: FxOverlayClip) => {
    void apply({ type: 'clip.remove', clipId: overlay.id }, 'Delete overlay');
  };

  return (
    <Panel
      title="Effects"
      subtitle={
        overlays.length === 0
          ? 'Timed overlays'
          : `${overlays.length} ${overlays.length === 1 ? 'overlay' : 'overlays'}`
      }
      bodyClassName="p-0"
      actions={
        <span className="k-track-head__dot" data-kind="effects">
          <Wand2 size={11} />
        </span>
      }
    >
      <div className="k-effects">
        <section>
          <div className="k-effects__section-title">Add an overlay</div>
          <div className="k-effects__grid">
            {OVERLAY_CARDS.map((card) => {
              const Icon = card.icon;
              return (
                <div className="k-effects__card" key={card.kind}>
                  <div className="k-effects__card-head">
                    <Icon size={13} />
                    {card.title}
                  </div>
                  <p>{card.description}</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    leadingIcon={<Plus size={13} />}
                    disabled={locked}
                    onClick={() => void addOverlay(card.kind)}
                  >
                    Add {card.title}
                  </Button>
                </div>
              );
            })}
          </div>
          {locked ? (
            <p className="k-inspector__hint">
              Unlock the Effects track to add or change overlays.
            </p>
          ) : null}
        </section>

        <section>
          <div className="k-effects__section-title">
            {source
              ? `Link to ${source.label || source.type}`
              : 'Unlinked · starts at the playhead'}
          </div>
          {overlays.length === 0 ? (
            <div className="k-inspector__note">
              <Sparkles size={14} aria-hidden="true" />
              <p>
                No overlays yet. Add one to give this sequence a blur, callout,
                spotlight or zoom.
              </p>
            </div>
          ) : (
            <div className="k-effects__list" role="list">
              {overlays.map((overlay) => {
                const kind = overlay.props.kind;
                return (
                  <div
                    key={overlay.id}
                    role="listitem"
                    className={
                      selection.clipIds.includes(overlay.id)
                        ? 'k-effects__item is-selected'
                        : 'k-effects__item'
                    }
                  >
                    <button
                      type="button"
                      className="k-effects__main"
                      onClick={() => selectClip(overlay.id)}
                    >
                      <span className="k-effects__badge" data-kind={kind}>
                        {OVERLAY_LABELS[kind]}
                      </span>
                      <span className="k-effects__title">
                        {overlay.label || OVERLAY_LABELS[kind]}
                      </span>
                      <span className="k-effects__sub">
                        {formatTimecode(overlay.startFrame, rate)} ·{' '}
                        {formatDuration(overlay.durationFrames, rate)} ·{' '}
                        {linkedLabel(sequence, overlay)}
                      </span>
                    </button>
                    <span className="k-effects__actions">
                      <IconButton
                        label="Unlink overlay"
                        tooltip="Unlink overlay"
                        size="sm"
                        disabled={!overlay.linkedItemId || locked}
                        icon={<Unlink size={12} />}
                        onClick={() => unlink(overlay)}
                      />
                      <IconButton
                        label="Delete overlay"
                        tooltip="Delete overlay"
                        size="sm"
                        disabled={locked}
                        icon={<Trash2 size={12} />}
                        onClick={() => remove(overlay)}
                      />
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </Panel>
  );
}
