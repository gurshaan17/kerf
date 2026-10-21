import type { Effect, EditCommand, Mask, Marker, Sequence } from '@kerf/model';
import {
  COMMAND_TYPES,
  createMarker,
  effectSchema,
  maskSchema,
  newId,
  referenceProfileSchema,
  sequenceSchema,
} from '@kerf/model';
import { describe, expect, it } from 'vitest';
import { applyCommand } from './apply';
import type { ApplyContext, ApplyResult } from './apply';
import {
  makeAudioClip,
  makeSequence,
  makeTextClip,
  makeTrack,
  makeVideoClip,
  withClips,
} from './test-fixtures';

interface InverseCase {
  name: string;
  build: () => {
    sequence: Sequence;
    command: EditCommand;
    context?: ApplyContext;
  };
}

interface FixtureOptions {
  effects?: Effect[];
  masks?: Mask[];
  markers?: Marker[];
}

function makeEffect(amount = 2): Effect {
  return effectSchema.parse({
    id: newId('effect'),
    type: 'blur',
    amount,
  });
}

function makeMask(): Mask {
  return maskSchema.parse({
    id: newId('mask'),
    type: 'ellipse',
  });
}

function base(options: FixtureOptions = {}) {
  const videoTrack = makeTrack('video', 0);
  const audioTrack = makeTrack('audio', 1);
  const overlayTrack = makeTrack('overlay', 2);
  const clip = makeVideoClip({
    trackId: videoTrack.id,
    startFrame: 0,
    durationFrames: 20,
    sourceInFrame: 10,
    effects: options.effects,
    masks: options.masks,
  });
  const audio = makeAudioClip({
    trackId: audioTrack.id,
    startFrame: 0,
    durationFrames: 20,
    sourceInFrame: 10,
  });
  const text = makeTextClip(overlayTrack.id, 0, 20);
  const built = makeSequence([
    withClips(videoTrack, [clip]),
    withClips(audioTrack, [audio]),
    withClips(overlayTrack, [text]),
  ]);
  return {
    videoTrack,
    audioTrack,
    overlayTrack,
    clip,
    audio,
    text,
    sequence:
      options.markers === undefined
        ? built
        : sequenceSchema.parse({ ...built, markers: options.markers }),
  };
}

function inverseCase(
  name: EditCommand['type'],
  build: InverseCase['build'],
): InverseCase {
  return { name, build };
}

const cases: InverseCase[] = [
  inverseCase('clip.insert', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.insert',
        clip: makeVideoClip({
          trackId: fixture.videoTrack.id,
          startFrame: 40,
          durationFrames: 20,
        }),
        index: 1,
      },
    };
  }),
  inverseCase('clip.remove', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: { type: 'clip.remove', clipId: fixture.clip.id },
    };
  }),
  inverseCase('clip.update', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.update',
        clipId: fixture.clip.id,
        patch: { label: 'Renamed clip', volume: 0.6 },
      },
    };
  }),
  inverseCase('clip.move', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.move',
        clipId: fixture.clip.id,
        startFrame: 40,
      },
    };
  }),
  inverseCase('clip.trim', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.trim',
        clipId: fixture.clip.id,
        edge: 'out',
        frames: -5,
      },
      context: { sourceDurationFrames: () => 100 },
    };
  }),
  inverseCase('clip.split', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: { type: 'clip.split', clipId: fixture.clip.id, frame: 10 },
    };
  }),
  inverseCase('clip.duplicate', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.duplicate',
        clipId: fixture.clip.id,
        offsetFrames: 30,
      },
    };
  }),
  inverseCase('clip.setSpeed', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: { type: 'clip.setSpeed', clipId: fixture.clip.id, speed: 2 },
      context: { sourceDurationFrames: () => 100 },
    };
  }),
  inverseCase('clip.slip', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.slip',
        clipId: fixture.clip.id,
        deltaFrames: 5,
      },
      context: { sourceDurationFrames: () => 100 },
    };
  }),
  inverseCase('clip.setTimeMap', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.setTimeMap',
        clipId: fixture.clip.id,
        points: [
          { frame: 0, sourceFrame: 0 },
          { frame: 20, sourceFrame: 20 },
        ],
      },
      context: { sourceDurationFrames: () => 100 },
    };
  }),
  inverseCase('clip.setKeyframes', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.setKeyframes',
        clipId: fixture.clip.id,
        property: 'opacity',
        keyframes: [
          { frame: 0, value: 0, easing: 'linear' },
          { frame: 20, value: 1, easing: 'ease-out' },
        ],
      },
    };
  }),
  inverseCase('clip.addEffect', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.addEffect',
        clipId: fixture.clip.id,
        effect: makeEffect(),
      },
    };
  }),
  inverseCase('clip.updateEffect', () => {
    const effect = makeEffect();
    const fixture = base({ effects: [effect] });
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.updateEffect',
        clipId: fixture.clip.id,
        effectId: effect.id,
        patch: { amount: 4, enabled: false },
      },
    };
  }),
  inverseCase('clip.removeEffect', () => {
    const effect = makeEffect();
    const fixture = base({ effects: [effect] });
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.removeEffect',
        clipId: fixture.clip.id,
        effectId: effect.id,
      },
    };
  }),
  inverseCase('clip.addMask', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.addMask',
        clipId: fixture.clip.id,
        mask: makeMask(),
      },
    };
  }),
  inverseCase('clip.updateMask', () => {
    const mask = makeMask();
    const fixture = base({ masks: [mask] });
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.updateMask',
        clipId: fixture.clip.id,
        maskId: mask.id,
        patch: { feather: 0.25, inverted: true },
      },
    };
  }),
  inverseCase('clip.removeMask', () => {
    const mask = makeMask();
    const fixture = base({ masks: [mask] });
    return {
      sequence: fixture.sequence,
      command: {
        type: 'clip.removeMask',
        clipId: fixture.clip.id,
        maskId: mask.id,
      },
    };
  }),
  inverseCase('sequence.rename', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: { type: 'sequence.rename', name: 'Renamed sequence' },
    };
  }),
  inverseCase('sequence.setCanvas', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'sequence.setCanvas',
        width: 1280,
        height: 720,
        frameRate: { numerator: 30, denominator: 1 },
      },
    };
  }),
  inverseCase('sequence.setStyle', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'sequence.setStyle',
        style: { accent: '#ffffff', captionSize: 60 },
      },
    };
  }),
  inverseCase('sequence.setReference', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'sequence.setReference',
        reference: referenceProfileSchema.parse({
          id: newId('reference'),
          name: 'Noir',
          createdAt: 1,
        }),
      },
    };
  }),
  inverseCase('track.add', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'track.add',
        track: makeTrack('caption', 3),
        index: 1,
      },
    };
  }),
  inverseCase('track.remove', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'track.remove',
        trackId: fixture.overlayTrack.id,
      },
    };
  }),
  inverseCase('track.update', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'track.update',
        trackId: fixture.videoTrack.id,
        patch: { name: 'B-roll', height: 80 },
      },
    };
  }),
  inverseCase('track.reorder', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'track.reorder',
        trackId: fixture.videoTrack.id,
        toIndex: 2,
      },
    };
  }),
  inverseCase('marker.add', () => {
    const marker = createMarker({ frame: 5, label: 'Existing' });
    const fixture = base({ markers: [marker] });
    return {
      sequence: fixture.sequence,
      command: {
        type: 'marker.add',
        marker: createMarker({ frame: 15, label: 'New' }),
        index: 0,
      },
    };
  }),
  inverseCase('marker.update', () => {
    const marker = createMarker({ frame: 5, label: 'Existing' });
    const fixture = base({ markers: [marker] });
    return {
      sequence: fixture.sequence,
      command: {
        type: 'marker.update',
        markerId: marker.id,
        patch: { frame: 8, label: 'Moved' },
      },
    };
  }),
  inverseCase('marker.remove', () => {
    const marker = createMarker({ frame: 5, label: 'Existing' });
    const fixture = base({ markers: [marker] });
    return {
      sequence: fixture.sequence,
      command: { type: 'marker.remove', markerId: marker.id },
    };
  }),
  inverseCase('batch', () => {
    const fixture = base();
    return {
      sequence: fixture.sequence,
      command: {
        type: 'batch',
        label: 'Title setup',
        commands: [
          { type: 'sequence.rename', name: 'Title' },
          {
            type: 'marker.add',
            marker: createMarker({ frame: 12, label: 'Title' }),
          },
        ],
      },
    };
  }),
];

function applyThroughInverse(
  sequence: Sequence,
  command: EditCommand,
  context?: ApplyContext,
): ApplyResult {
  return applyCommand(sequence, command, context);
}

describe('every edit command inverts exactly', () => {
  it('covers the whole command catalog', () => {
    const covered = new Set(cases.map((testCase) => testCase.name));
    expect(covered.size).toBe(COMMAND_TYPES.length);
    for (const commandType of COMMAND_TYPES) {
      expect(covered.has(commandType)).toBe(true);
    }
  });

  it.each(cases)('$name', ({ build }) => {
    const { sequence, command, context } = build();
    const result = applyThroughInverse(sequence, command, context);
    expect(result.inverse).not.toBeNull();
    if (!result.inverse) {
      throw new Error('expected an inverse');
    }
    const undone = applyCommand(result.sequence, result.inverse, context);
    expect(undone.sequence).toEqual(sequence);
  });
});

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomInt(
  random: () => number,
  minimum: number,
  maximum: number,
): number {
  return minimum + Math.floor(random() * (maximum - minimum + 1));
}

describe('randomized inverse properties', () => {
  it('keeps insert and remove reversible across a changing track', () => {
    const random = seededRandom(7);
    const track = makeTrack('video', 0);
    let current = makeSequence([withClips(track, [])]);

    for (let step = 0; step < 60; step += 1) {
      const currentTrack = current.tracks[0];
      if (!currentTrack) {
        throw new Error('expected a track');
      }
      const shouldInsert = currentTrack.clips.length === 0 || random() < 0.55;

      let command: EditCommand;
      if (shouldInsert) {
        const end = currentTrack.clips.reduce(
          (latest, clip) =>
            Math.max(latest, clip.startFrame + clip.durationFrames),
          0,
        );
        const clip = makeVideoClip({
          trackId: currentTrack.id,
          startFrame: end + randomInt(random, 0, 20),
          durationFrames: randomInt(random, 1, 20),
        });
        command = {
          type: 'clip.insert',
          clip,
          index: randomInt(random, 0, currentTrack.clips.length),
        };
      } else {
        const clip =
          currentTrack.clips[
            randomInt(random, 0, currentTrack.clips.length - 1)
          ];
        if (!clip) {
          throw new Error('expected a clip to remove');
        }
        command = { type: 'clip.remove', clipId: clip.id };
      }

      const result = applyCommand(current, command);
      expect(result.inverse).not.toBeNull();
      if (!result.inverse) {
        throw new Error('expected an inverse');
      }
      const undone = applyCommand(result.sequence, result.inverse);
      expect(undone.sequence).toEqual(current);
      current = result.sequence;
    }
  });

  it('keeps random in and out trims reversible', () => {
    const random = seededRandom(19);
    const sourceDuration = 1000;

    for (let step = 0; step < 60; step += 1) {
      const track = makeTrack('video', 0);
      const clip = makeVideoClip({
        trackId: track.id,
        startFrame: 50,
        durationFrames: 100,
        sourceInFrame: 100,
        speed: 1,
      });
      const sequence = makeSequence([withClips(track, [clip])]);
      const edge = random() < 0.5 ? 'in' : 'out';
      const frames = randomInt(random, -30, 30);
      const command: EditCommand = {
        type: 'clip.trim',
        clipId: clip.id,
        edge,
        frames,
      };
      const context: ApplyContext = {
        sourceDurationFrames: () => sourceDuration,
      };

      const result = applyCommand(sequence, command, context);
      expect(result.inverse).not.toBeNull();
      if (!result.inverse) {
        throw new Error('expected an inverse');
      }
      const undone = applyCommand(result.sequence, result.inverse, context);
      expect(undone.sequence).toEqual(sequence);
    }
  });
});
