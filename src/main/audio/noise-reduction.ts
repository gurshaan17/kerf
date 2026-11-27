import { createHash, randomUUID } from 'node:crypto';
import { mkdir, realpath, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { Asset, NoiseReduction } from '@kerf/model';
import type { ExportAudioClip } from '../export/audio-plan';
import { findExecutable, runProcess } from '../media/ffmpeg';
import { isPathInside } from '../projects/paths';

type Strength = Exclude<NoiseReduction, 'off'>;
interface Render {
  readonly controller: AbortController;
  readonly promise: Promise<string>;
  consumers: number;
}

export class NoiseReductionService {
  private readonly renders = new Map<string, Render>();
  private readonly lifecycle = new AbortController();

  constructor(private readonly folder: (projectId: string) => string | null) {}

  async resolve(
    asset: Asset,
    strength: Strength,
    signal?: AbortSignal,
  ): Promise<string> {
    signal?.throwIfAborted();
    this.lifecycle.signal.throwIfAborted();
    const projectFolder = this.folder(asset.projectId);
    if (!projectFolder || asset.status !== 'ready' || !asset.hasAudio)
      throw new Error(
        'Choose ready media with audio to reduce background noise.',
      );
    if (asset.durationSeconds <= 0 || asset.durationSeconds > 1800)
      throw new Error(
        'Noise reduction supports source recordings up to 30 minutes.',
      );
    const info = await stat(asset.sourcePath);
    if (
      !info.isFile() ||
      info.size !== asset.fileSize ||
      Math.abs(info.mtimeMs - asset.mtimeMs) > 1
    )
      throw new Error(
        'The audio source changed. Refresh or relink it before using noise reduction.',
      );
    const sampleRate =
      asset.streams.find((stream) => stream.kind === 'audio')?.sampleRate ??
      48000;
    const key = createHash('sha256')
      .update(
        JSON.stringify([
          'afftdn-v2',
          asset.id,
          asset.sourcePath,
          asset.contentHash,
          info.size,
          info.mtimeMs,
          sampleRate,
          strength,
        ]),
      )
      .digest('hex');
    const root = await realpath(projectFolder);
    const cache = join(root, '.noise-reduction');
    await mkdir(cache, { recursive: true });
    const directory = await realpath(cache);
    if (!isPathInside(root, directory))
      throw new Error(
        'The noise reduction cache is outside the project folder.',
      );
    const output = join(directory, `${key}.wav`);
    const cached = await stat(output).catch(() => null);
    signal?.throwIfAborted();
    this.lifecycle.signal.throwIfAborted();
    if (
      cached?.isFile() &&
      cached.size > 44 &&
      (await realpath(output)) === output
    )
      return output;

    let render = this.renders.get(output);
    if (!render || render.controller.signal.aborted) {
      const controller = new AbortController();
      const work = this.render(
        asset,
        strength,
        sampleRate,
        directory,
        output,
        controller.signal,
      );
      render = { controller, promise: work, consumers: 0 };
      this.renders.set(output, render);
      const clear = () => {
        if (this.renders.get(output)?.promise === work)
          this.renders.delete(output);
      };
      void work.then(clear, clear);
    }
    render.consumers++;
    try {
      const active = AbortSignal.any(
        signal ? [signal, this.lifecycle.signal] : [this.lifecycle.signal],
      );
      return await new Promise<string>((resolve, reject) => {
        const abort = () => reject(active.reason);
        active.addEventListener('abort', abort, { once: true });
        if (active.aborted) abort();
        void render.promise
          .then(resolve, reject)
          .finally(() => active.removeEventListener('abort', abort));
      });
    } finally {
      if (--render.consumers === 0) render.controller.abort();
    }
  }

  private async render(
    asset: Asset,
    strength: Strength,
    rate: number,
    directory: string,
    output: string,
    signal: AbortSignal,
  ) {
    const temporary = join(directory, `${randomUUID()}.partial.wav`);
    const active = AbortSignal.any([signal, AbortSignal.timeout(120_000)]);
    // afftdn delays audio by two 12.5 ms hops. Feed that many tail samples
    // and remove the delay so existing trims and A/V sync keep their meaning.
    const delay = 2 * Math.floor(rate / 80);
    const attenuation = strength === 'light' ? 8 : 16;
    try {
      await runProcess(
        findExecutable('ffmpeg'),
        [
          '-hide_banner',
          '-nostdin',
          '-loglevel',
          'error',
          '-copyts',
          '-start_at_zero',
          '-i',
          asset.sourcePath,
          '-map',
          '0:a:0',
          '-vn',
          '-af',
          `aresample=${rate}:async=1:first_pts=0,apad=pad_len=${delay},afftdn=nr=${attenuation}:nf=-45,atrim=start_sample=${delay},asetpts=N/SR/TB,apad=whole_dur=${asset.durationSeconds}`,
          '-c:a',
          'pcm_s24le',
          '-rf64',
          'auto',
          temporary,
        ],
        { signal: active },
      );
      active.throwIfAborted();
      const source = await stat(asset.sourcePath);
      if (
        source.size !== asset.fileSize ||
        Math.abs(source.mtimeMs - asset.mtimeMs) > 1
      )
        throw new Error('The audio source changed during noise reduction.');
      if ((await stat(temporary)).size <= 44)
        throw new Error('The source did not produce cleaned audio.');
      active.throwIfAborted();
      await rename(temporary, output);
      return output;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async resolvePlan(
    clips: readonly ExportAudioClip[],
    signal: AbortSignal,
  ): Promise<ExportAudioClip[]> {
    const resolved: ExportAudioClip[] = [];
    for (const clip of clips) {
      const { cleanedAudio, ...input } = clip;
      resolved.push(
        cleanedAudio
          ? {
              ...input,
              path: await this.resolve(
                cleanedAudio.asset,
                cleanedAudio.strength,
                signal,
              ),
            }
          : input,
      );
    }
    return resolved;
  }

  dispose() {
    this.lifecycle.abort();
  }
}
