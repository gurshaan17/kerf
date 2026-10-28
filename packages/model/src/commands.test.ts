import { describe, expect, it } from 'vitest';
import { clipSchema } from './clips';
import {
  COMMAND_TYPES,
  clipPatchSchema,
  commandLabel,
  createCommandEnvelope,
  editCommandEnvelopeSchema,
  editCommandSchema,
} from './commands';
import type { EditCommand } from './commands';
import { newId } from './ids';
import { applyOverlayPropsPatch, overlayPropsSchema } from './overlays';
import { createMarker, createTrack } from './sequence';

const makeClip = () =>
  clipSchema.parse({
    id: newId('clip'),
    trackId: newId('track'),
    startFrame: 0,
    durationFrames: 48,
    type: 'video',
    assetId: newId('asset'),
  });

describe('edit commands', () => {
  const clip = makeClip();
  const commands: EditCommand[] = [
    { type: 'clip.insert', clip },
    { type: 'clip.remove', clipId: clip.id },
    { type: 'clip.update', clipId: clip.id, patch: { label: 'Renamed' } },
    {
      type: 'clip.move',
      clipId: clip.id,
      trackId: newId('track'),
      startFrame: 12,
    },
    { type: 'clip.trim', clipId: clip.id, edge: 'in', frames: -4 },
    { type: 'clip.split', clipId: clip.id, frame: 24 },
    {
      type: 'clip.duplicate',
      clipId: clip.id,
      trackId: newId('track'),
      offsetFrames: 12,
    },
    { type: 'clip.setSpeed', clipId: clip.id, speed: 2 },
    { type: 'clip.slip', clipId: clip.id, deltaFrames: 6 },
    { type: 'clip.setTimeMap', clipId: clip.id, points: [] },
    {
      type: 'clip.setKeyframes',
      clipId: clip.id,
      property: 'opacity',
      keyframes: [],
    },
    {
      type: 'clip.addEffect',
      clipId: clip.id,
      effect: {
        id: newId('effect'),
        type: 'blur',
        enabled: true,
        amount: 2,
      },
    },
    {
      type: 'clip.updateEffect',
      clipId: clip.id,
      effectId: newId('effect'),
      patch: { amount: 0.5 },
    },
    {
      type: 'clip.removeEffect',
      clipId: clip.id,
      effectId: newId('effect'),
    },
    {
      type: 'clip.addMask',
      clipId: clip.id,
      mask: {
        id: newId('mask'),
        type: 'ellipse',
        x: 0.1,
        y: 0.1,
        width: 0.8,
        height: 0.8,
        rotation: 0,
        feather: 0,
        opacity: 1,
        inverted: false,
        path: null,
      },
    },
    {
      type: 'clip.updateMask',
      clipId: clip.id,
      maskId: newId('mask'),
      patch: { feather: 0.2 },
    },
    { type: 'clip.removeMask', clipId: clip.id, maskId: newId('mask') },
    { type: 'sequence.rename', name: 'New name' },
    { type: 'sequence.setCanvas', width: 1080, height: 1920 },
    { type: 'sequence.setStyle', style: { accent: '#ffffff' } },
    { type: 'sequence.setReference', reference: null },
    { type: 'track.add', track: createTrack({ kind: 'video' }) },
    { type: 'track.remove', trackId: newId('track') },
    { type: 'track.update', trackId: newId('track'), patch: { locked: true } },
    { type: 'track.reorder', trackId: newId('track'), toIndex: 2 },
    { type: 'marker.add', marker: createMarker({ frame: 24 }) },
    { type: 'marker.update', markerId: newId('marker'), patch: { frame: 48 } },
    { type: 'marker.remove', markerId: newId('marker') },
    {
      type: 'batch',
      label: 'Build opening',
      commands: [
        { type: 'sequence.rename', name: 'Opening' },
        { type: 'clip.remove', clipId: clip.id },
      ],
    },
  ];

  it('parses every catalog command', () => {
    const seen = new Set<string>();

    for (const command of commands) {
      const parsed = editCommandSchema.parse(command);
      expect(parsed.type).toBe(command.type);
      expect(commandLabel(parsed).length).toBeGreaterThan(0);
      seen.add(parsed.type);
    }

    expect(seen.size).toBe(COMMAND_TYPES.length);
    expect(COMMAND_TYPES).toHaveLength(29);
  });

  it('parses nested batches recursively', () => {
    const nested = editCommandSchema.parse({
      type: 'batch',
      label: 'Nested',
      commands: [
        {
          type: 'batch',
          commands: [{ type: 'sequence.rename', name: 'Inner' }],
        },
        { type: 'marker.remove', markerId: newId('marker') },
      ],
    });

    expect(nested.type).toBe('batch');
    if (nested.type !== 'batch') {
      throw new Error('expected a batch');
    }
    expect(nested.commands).toHaveLength(2);
    expect(nested.commands[0]?.type).toBe('batch');
    expect(commandLabel(nested)).toBe('Nested');
  });

  it('wraps commands with a default user actor', () => {
    const rename: EditCommand = { type: 'sequence.rename', name: 'Cut one' };
    const envelope = editCommandEnvelopeSchema.parse({
      id: newId('command'),
      command: rename,
      createdAt: 10,
    });

    expect(envelope.actor).toBe('user');
    expect(envelope.label).toBe('');
    expect(envelope.command).toEqual(rename);
  });

  it('creates envelopes for an explicit actor', () => {
    const envelope = createCommandEnvelope({
      command: { type: 'sequence.rename', name: 'Agent cut' },
      actor: 'agent',
      label: 'Rename sequence',
      now: 20,
    });

    expect(envelope.id.startsWith('cmd_')).toBe(true);
    expect(envelope.actor).toBe('agent');
    expect(envelope.label).toBe('Rename sequence');
    expect(envelope.createdAt).toBe(20);
  });

  it('rejects unknown commands and malformed envelopes', () => {
    expect(() => editCommandSchema.parse({ type: 'clip.explode' })).toThrow();
    expect(() =>
      editCommandEnvelopeSchema.parse({
        id: 'not-a-command-id',
        command: { type: 'sequence.rename', name: 'Cut' },
        createdAt: 1,
      }),
    ).toThrow();
  });

  it('accepts partial overlay props in a clip patch', () => {
    const patch = clipPatchSchema.parse({
      props: {
        region: { x: 0.2 },
        transitionInFrames: 12,
        pointer: { y: 0.4 },
      },
      linkedItemId: null,
    });

    expect(patch.props?.region).toEqual({ x: 0.2 });
    expect(patch.props?.transitionInFrames).toBe(12);
    expect(patch.props?.pointer).toEqual({ y: 0.4 });
    expect(patch.linkedItemId).toBeNull();
  });

  it('does not add media defaults to partial clip patches', () => {
    const parsed = editCommandSchema.parse({
      type: 'clip.update',
      clipId: newId('clip'),
      patch: { props: { region: { x: 0.25 } } },
    });

    if (parsed.type !== 'clip.update') {
      throw new Error('expected a clip update');
    }
    expect(parsed.patch).toEqual({ props: { region: { x: 0.25 } } });
  });
});

describe('overlay props patches', () => {
  const region = { x: 0.1, y: 0.2, w: 0.4, h: 0.3 };

  it('deep-merges nested props and preserves the kind', () => {
    const blur = overlayPropsSchema.parse({ kind: 'blur', region });
    const updated = applyOverlayPropsPatch(blur, {
      region: { x: 0.3 },
      amount: 40,
      easing: 'linear',
    });

    if (updated.kind !== 'blur') {
      throw new Error('expected a blur overlay');
    }
    expect(updated.region).toEqual({ x: 0.3, y: 0.2, w: 0.4, h: 0.3 });
    expect(updated.amount).toBe(40);
    expect(updated.easing).toBe('linear');
  });

  it('merges partial points and can clear a nullable point', () => {
    const zoom = overlayPropsSchema.parse({
      kind: 'zoom',
      region,
      focus: { x: 0.2, y: 0.3 },
    });
    const moved = applyOverlayPropsPatch(zoom, { focus: { y: 0.6 } });
    if (moved.kind !== 'zoom') {
      throw new Error('expected a zoom overlay');
    }
    expect(moved.focus).toEqual({ x: 0.2, y: 0.6 });

    const callout = overlayPropsSchema.parse({
      kind: 'callout',
      region,
      pointer: { x: 0.8, y: 0.9 },
    });
    const cleared = applyOverlayPropsPatch(callout, { pointer: null });
    if (cleared.kind !== 'callout') {
      throw new Error('expected a callout overlay');
    }
    expect(cleared.pointer).toBeNull();
  });

  it('rejects a kind change', () => {
    const blur = overlayPropsSchema.parse({ kind: 'blur', region });

    expect(() =>
      applyOverlayPropsPatch(blur, { kind: 'zoom', zoom: 3 }),
    ).toThrow(/cannot change/);
  });
});
