import { MediaAudioGain } from './media-audio-gain';
import { clipAudioGain } from '@kerf/model';
import type { Asset, Sequence } from '@kerf/model';
import { fpsToNumber } from '@kerf/model';
import { clipsAtFrame, sourceFrameAt } from '@kerf/engine';
import { assetMediaUrl } from '@kerf/canvas';

/** Separate elements keep audio edits independent of the visual decoder. */
export class AudioPlayback {
  private readonly gains = new MediaAudioGain();
  private readonly elements = new Map<string, HTMLAudioElement>();

  constructor(
    private readonly createAudio: () => HTMLAudioElement = () =>
      document.createElement('audio'),
  ) {}

  sync(
    sequence: Sequence,
    assets: readonly Asset[],
    frame: number,
    force = false,
  ): void {
    const active = new Set<string>();
    const fps = fpsToNumber(sequence.frameRate);
    for (const track of sequence.tracks) {
      if (!['audio', 'video'].includes(track.kind) || track.muted) continue;
      for (const clip of clipsAtFrame(track, frame)) {
        if (clip.type !== 'audio' && clip.type !== 'video') continue;
        if (clip.volume <= 0 && !clip.keyframes.volume.length) continue;
        const asset = assets.find((asset) => asset.id === clip.assetId);
        if (!asset?.hasAudio || asset.status !== 'ready') continue;
        active.add(clip.id);
        let audio = this.elements.get(clip.id);
        if (!audio) {
          audio = this.createAudio();
          audio.preload = 'auto';
          audio.crossOrigin = 'anonymous';
          audio.src = assetMediaUrl(
            asset,
            asset.cache.proxyPath ? 'proxy' : 'source',
          );
          this.elements.set(clip.id, audio);
          audio.load();
        }
        const seconds = sourceFrameAt(clip, frame) / fps;
        const drift = audio.currentTime - seconds;
        if (force || audio.paused || Math.abs(drift) > 0.75) {
          if (Math.abs(drift) > 0.001) audio.currentTime = seconds;
          audio.playbackRate = clip.speed;
        } else if (!audio.seeking) {
          audio.playbackRate = Math.max(
            0.0625,
            Math.min(
              16,
              clip.speed * (1 + Math.max(-0.05, Math.min(0.05, -drift * 0.5))),
            ),
          );
        }
        const local = frame - clip.startFrame;
        this.gains.set(
          audio,
          clipAudioGain(clip, local),
          clipAudioGain(clip, local + 1),
          1 / fps,
          force,
        );
        audio.muted = false;
        audio.preservesPitch = true;
        if (audio.paused) void audio.play().catch(() => undefined);
      }
    }
    for (const [id, audio] of this.elements) {
      if (!active.has(id)) {
        audio.pause();
        this.gains.remove(audio);
        audio.removeAttribute('src');
        audio.load();
        this.elements.delete(id);
      }
    }
  }

  pause(): void {
    for (const audio of this.elements.values()) audio.pause();
  }

  dispose(): void {
    this.pause();
    for (const audio of this.elements.values()) {
      audio.removeAttribute('src');
      audio.load();
    }
    this.elements.clear();
    this.gains.dispose();
  }
}
