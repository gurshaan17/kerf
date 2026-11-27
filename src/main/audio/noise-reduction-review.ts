import { findClip } from '@kerf/engine';
import { framesToSeconds } from '@kerf/model';
import type { NoiseReductionRequest } from '../../shared/noise-reduction';
import type { ProjectService } from '../projects';
import type { NoiseReductionService } from './noise-reduction';

const REVIEW_TTL = 5 * 60_000;
interface Review {
  readonly input: NoiseReductionRequest;
  readonly fingerprint: string;
  readonly controller: AbortController;
  readonly expiresAt: number;
  ready: boolean;
  applying: boolean;
}

export class NoiseReductionReviews {
  private readonly reviews = new Map<string, Review>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly projects: ProjectService,
    private readonly processor: NoiseReductionService,
  ) {
    this.unsubscribe = projects.subscribe((event) => {
      if (event.type === 'project.opened' || event.type === 'project.closed')
        this.clear();
    });
  }

  private source(clipId: string) {
    const snapshot = this.projects.current();
    if (!snapshot)
      throw new Error('Open a project to reduce background noise.');
    const sequence = snapshot.project.sequence;
    const location = findClip(sequence, clipId);
    const clip = location?.clip;
    if (
      !clip ||
      (clip.type !== 'audio' && clip.type !== 'video') ||
      clip.speed !== 1 ||
      clip.timeMap.length
    )
      throw new Error('Select one normal-speed clip with source audio.');
    if (
      location.track.locked ||
      clip.locked ||
      location.track.muted ||
      (clip.volume === 0 && !clip.keyframes.volume.length)
    )
      throw new Error(
        'Select an unlocked, audible clip. For split video and audio, select the audio clip.',
      );
    const asset = snapshot.assets.find((item) => item.id === clip.assetId);
    if (!asset?.hasAudio || asset.status !== 'ready')
      throw new Error('Select ready media with source audio.');
    const startSeconds = framesToSeconds(
      clip.sourceInFrame,
      sequence.frameRate,
    );
    const endSeconds = Math.min(
      asset.durationSeconds,
      framesToSeconds(
        clip.sourceInFrame + clip.durationFrames,
        sequence.frameRate,
      ),
    );
    if (endSeconds <= startSeconds)
      throw new Error('The clip has no audio in its current range.');
    const fingerprint = JSON.stringify([
      snapshot.project.id,
      clip,
      sequence.frameRate,
      asset.sourcePath,
      asset.contentHash,
      asset.fileSize,
      asset.mtimeMs,
    ]);
    return { asset, clip, fingerprint, startSeconds, endSeconds };
  }

  async prepare(input: NoiseReductionRequest) {
    for (const [id, review] of this.reviews) {
      if (review.expiresAt <= Date.now()) this.cancel(id);
    }
    if (this.reviews.has(input.requestId) || this.reviews.size >= 24)
      throw new Error(
        'Another noise reduction preview is already in progress.',
      );
    const { asset, fingerprint, startSeconds, endSeconds } = this.source(
      input.clipId,
    );
    const controller = new AbortController();
    const review = {
      input,
      fingerprint,
      controller,
      expiresAt: Date.now() + REVIEW_TTL,
      ready: false,
      applying: false,
    };
    this.reviews.set(input.requestId, review);
    try {
      await this.processor.resolve(asset, input.strength, controller.signal);
      controller.signal.throwIfAborted();
      if (this.source(input.clipId).fingerprint !== fingerprint)
        throw new Error('The clip changed. Prepare another preview.');
      review.ready = true;
      return { startSeconds, endSeconds };
    } catch (cause) {
      this.cancel(input.requestId);
      throw cause;
    }
  }

  async apply(id: string) {
    const review = this.reviews.get(id);
    if (!review?.ready || review.applying || review.expiresAt <= Date.now())
      throw new Error('Prepare a new noise reduction preview before applying.');
    review.applying = true;
    const { clipId, strength } = review.input;
    try {
      const { asset, fingerprint } = this.source(clipId);
      if (fingerprint !== review.fingerprint)
        throw new Error('The clip changed. Prepare another preview.');
      await this.processor.resolve(asset, strength, review.controller.signal);
      review.controller.signal.throwIfAborted();
      const current = this.source(clipId);
      if (current.fingerprint !== review.fingerprint)
        throw new Error('The clip changed. Prepare another preview.');
      if (current.clip.noiseReduction !== strength)
        this.projects.apply(
          { type: 'clip.update', clipId, patch: { noiseReduction: strength } },
          { label: 'Reduce background noise' },
        );
      this.cancel(id);
    } finally {
      review.applying = false;
    }
  }

  cancel(id: string) {
    this.reviews.get(id)?.controller.abort();
    this.reviews.delete(id);
  }

  private clear() {
    for (const id of this.reviews.keys()) this.cancel(id);
  }

  dispose() {
    this.unsubscribe();
    this.clear();
  }
}
