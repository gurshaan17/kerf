import { describe, expect, it } from 'vitest';
import { clipSchema } from './clips';
import {
  COMMAND_TYPES,
  commandLabel,
  createCommandEnvelope,
  editCommandEnvelopeSchema,
  editCommandSchema,
} from './commands';
import type { EditCommand } from './commands';
import { newId } from './ids';
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
    expect(COMMAND_TYPES).toHaveLength(28);
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
});
