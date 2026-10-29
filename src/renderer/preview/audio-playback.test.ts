import { describe, expect, it, vi } from 'vitest';
import { createAsset, createProject, createSequence } from '@kerf/model';
import { applyCommand } from '@kerf/engine';
import { insertAssetCommand } from '../timeline/clip-commands';
import { AudioPlayback } from './audio-playback';

describe('separated source audio playback', () => {
  it('plays the audio of an imported video and stops on mute, pause and removal', () => {
    const asset = {
      ...createAsset({
        projectId: createProject({ name: 'Test' }).id,
        name: 'Take.mp4',
        sourcePath: '/take.mp4',
        kind: 'video',
      }),
      hasAudio: true,
      durationSeconds: 10,
      status: 'ready' as const,
    };
    const initial = createSequence({ name: 'Playback' });
    const sequence = applyCommand(
      initial,
      insertAssetCommand(asset, initial, initial.tracks[0]!.id, 24)!,
    ).sequence;
    const element = {
      paused: true,
      seeking: false,
      currentTime: 0,
      muted: true,
      volume: 0,
      playbackRate: 1,
      play: vi.fn().mockResolvedValue(undefined),
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
    };
    const player = new AudioPlayback(
      () => element as unknown as HTMLAudioElement,
    );
    player.sync(sequence, [asset], 0);
    expect(element.play).not.toHaveBeenCalled();
    player.sync(sequence, [asset], 48, true);
    expect(element.play).toHaveBeenCalledOnce();
    expect(element.muted).toBe(false);
    expect(element.volume).toBe(1);
    expect(element.currentTime).toBe(1);
    expect(element).toHaveProperty(
      'src',
      `kerfmedia://asset/${asset.id}/source`,
    );
    player.pause();
    expect(element.pause).toHaveBeenCalledOnce();
    player.sync(
      {
        ...sequence,
        tracks: sequence.tracks.map((track) => ({ ...track, muted: true })),
      },
      [asset],
      48,
    );
    expect(element.pause).toHaveBeenCalledTimes(2);
    player.sync(sequence, [asset], 48);
    player.sync(sequence, [asset], 264);
    expect(element.removeAttribute).toHaveBeenCalledWith('src');
    player.dispose();
  });
});
