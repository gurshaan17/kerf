import { createHash, randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { fpsToNumber } from '@kerf/model';
import type { AudibleClip, EditCommand } from '@kerf/model';
import { speechDuckingCommand } from '@kerf/engine';
import type {
  AudioFinishPlan,
  AudioGainRequest,
  AudioDuckRequest,
  AudioMeasurement,
  MeasureAudioRequest,
  ToolContext,
} from '@kerf/tools';
import type { ProjectSnapshot, ProjectEvent } from '../../shared/contracts';
import { findExecutable, runProcess } from '../media/ffmpeg';
import { buildExportAudioPlan } from '../export/audio-plan';
import { audioFilter } from '../export/args';
import type { NoiseReductionService } from './noise-reduction';

interface Options {
  projects: {
    current(): ProjectSnapshot | null;
    subscribe?(listener: (event: ProjectEvent) => void): () => void;
  };
  ffmpegPath?: string;
  run?: typeof runProcess;
  noiseReduction?: Pick<NoiseReductionService, 'resolvePlan'>;
  now?: () => number;
}
interface StoredPlan {
  sources: readonly string[];
  plan: AudioFinishPlan;
  command: EditCommand;
  expires: number;
}
const TTL = 5 * 60_000;
export class AudioFinishingService {
  private readonly measurements = new Map<
    string,
    { value: AudioMeasurement; expires: number }
  >();
  private readonly plans = new Map<string, StoredPlan>();
  private readonly running = new Map<
    string,
    { projectId: string; controller: AbortController }
  >();
  private readonly unsubscribe?: () => void;
  constructor(private readonly options: Options) {
    this.unsubscribe = options.projects.subscribe?.((event) => {
      if (event.type === 'project.opened' || event.type === 'project.closed') {
        for (const run of this.running.values())
          if (
            event.type === 'project.closed' ||
            run.projectId !== event.snapshot.project.id
          )
            run.controller.abort();
      }
    });
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private current() {
    const snapshot = this.options.projects.current();
    if (!snapshot) throw new Error('Open a project before finishing audio.');
    return snapshot;
  }
  private prune() {
    for (const [id, entry] of this.measurements)
      if (entry.expires <= this.now()) this.measurements.delete(id);
    for (const [id, entry] of this.plans)
      if (entry.expires <= this.now()) this.plans.delete(id);
    while (this.measurements.size > 32)
      this.measurements.delete(this.measurements.keys().next().value!);
    while (this.plans.size > 32)
      this.plans.delete(this.plans.keys().next().value!);
  }
  private revision(snapshot: ProjectSnapshot, clipIds: readonly string[]) {
    const used = new Set(
      snapshot.project.sequence.tracks
        .flatMap((t) => t.clips)
        .filter((c) => clipIds.includes(c.id))
        .flatMap((c) => ('assetId' in c ? [c.assetId] : [])),
    );
    const sources = snapshot.assets
      .filter((a) => used.has(a.id))
      .map((a) => {
        const stat = statSync(a.sourcePath);
        if (
          a.fileSize &&
          (stat.size !== a.fileSize || Math.abs(stat.mtimeMs - a.mtimeMs) > 1)
        )
          throw new Error(
            'Audio source changed. Refresh or relink it before finishing.',
          );
        return [a.id, a.contentHash, stat.size, stat.mtimeMs];
      });
    return createHash('sha256')
      .update(JSON.stringify([snapshot.project, sources, snapshot.transcripts]))
      .digest('hex');
  }
  private clips(
    snapshot: ProjectSnapshot,
    ids: readonly string[],
    edit = false,
  ): AudibleClip[] {
    if (!ids.length || ids.length > 20 || new Set(ids).size !== ids.length)
      throw new Error('Select one to twenty unique audio-bearing clips.');
    return ids.map((id) => {
      const track = snapshot.project.sequence.tracks.find((t) =>
        t.clips.some((c) => c.id === id),
      );
      const clip = track?.clips.find((c) => c.id === id);
      if (
        !clip ||
        (clip.type !== 'audio' && clip.type !== 'video') ||
        !snapshot.assets.some(
          (a) => a.id === clip.assetId && a.hasAudio && a.status === 'ready',
        )
      )
        throw new Error('Select ready clips with source audio.');
      if (clip.speed !== 1 || clip.timeMap.length)
        throw new Error(
          'Audio finishing currently requires normal-speed clips without time remapping.',
        );
      if (edit && (track?.locked || clip.locked || track?.muted))
        throw new Error('Unlock and unmute the scoped audio before finishing.');
      return clip;
    });
  }
  async measure(
    input: MeasureAudioRequest,
    signal?: AbortSignal,
  ): Promise<AudioMeasurement> {
    this.prune();
    const snapshot = this.current();
    const clips = this.clips(snapshot, input.clipIds);
    const revision = this.revision(snapshot, input.clipIds);
    const key = JSON.stringify([revision, [...input.clipIds].sort()]);
    const cached = [...this.measurements.values()].find(
      (m) =>
        JSON.stringify([m.value.revision, [...m.value.clipIds].sort()]) === key,
    );
    if (cached) return cached.value;
    const startFrame = Math.min(...clips.map((c) => c.startFrame));
    const endFrame = Math.max(
      ...clips.map((c) => c.startFrame + c.durationFrames),
    );
    const duration =
      (endFrame - startFrame) /
      fpsToNumber(snapshot.project.sequence.frameRate);
    if (duration > 600)
      throw new Error('Measure a scoped window up to ten minutes at a time.');
    const sequence = {
      ...snapshot.project.sequence,
      tracks: snapshot.project.sequence.tracks.map((t) => ({
        ...t,
        clips: t.clips.filter((c) => input.clipIds.includes(c.id)),
      })),
    };
    const plannedAudio = buildExportAudioPlan(
      sequence,
      snapshot.assets,
      startFrame,
      endFrame,
    );
    const requestId = input.requestId ?? randomUUID();
    if (this.running.has(requestId))
      throw new Error('That audio measurement is already running.');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) controller.abort();
    this.running.set(requestId, { projectId: snapshot.project.id, controller });
    const timeout = setTimeout(abort, 60_000);
    let integratedLufs: number | null = null;
    let truePeakDbtp: number | null = null;
    try {
      if (
        !this.options.noiseReduction &&
        plannedAudio.some((clip) => clip.cleanedAudio)
      )
        throw new Error('Noise reduction is unavailable for this measurement.');
      const audio = this.options.noiseReduction
        ? await this.options.noiseReduction.resolvePlan(
            plannedAudio,
            controller.signal,
          )
        : plannedAudio;
      if (audio.length) {
        const args = ['-hide_banner', '-nostdin', '-v', 'info'];
        for (const clip of audio)
          args.push(
            '-ss',
            String(clip.sourceStartSeconds),
            '-t',
            String(clip.sourceDurationSeconds),
            '-i',
            clip.path,
          );
        const filters = audio.map((clip, i) => audioFilter(clip, i));
        filters.push(
          `${audio.map((_, i) => `[a${i}]`).join('')}amix=inputs=${audio.length}:normalize=0,apad,atrim=0:${duration},loudnorm=I=-16:TP=-1:LRA=11:print_format=json[out]`,
        );
        const graph = filters.join(';');
        if (graph.length > 100_000)
          throw new Error(
            'Audio automation is too complex to measure. Scope fewer clips.',
          );
        args.push('-filter_complex', graph, '-map', '[out]', '-f', 'null', '-');
        const result = await (this.options.run ?? runProcess)(
          this.options.ffmpegPath ?? findExecutable('ffmpeg'),
          args,
          { signal: controller.signal },
        );
        const json = result.stderr.match(/\{\s*"input_i"[\s\S]*?\}/)?.[0];
        if (!json)
          throw new Error('FFmpeg did not return loudness measurements.');
        const values = JSON.parse(json) as {
          input_i?: string;
          input_tp?: string;
        };
        const number = (value: string | undefined) => {
          if (value === '-inf') return null;
          const parsed = Number(value);
          if (!Number.isFinite(parsed))
            throw new Error('FFmpeg returned invalid audio measurements.');
          return parsed;
        };
        integratedLufs = number(values.input_i);
        truePeakDbtp = number(values.input_tp);
      }
      controller.signal.throwIfAborted();
      const current = this.current();
      if (
        current.project.id !== snapshot.project.id ||
        this.revision(current, input.clipIds) !== revision
      )
        throw new Error(
          'The scoped audio changed while measuring. Measure it again explicitly.',
        );
      const status =
        integratedLufs !== null
          ? 'measured'
          : truePeakDbtp === null || truePeakDbtp < -100
            ? 'silence'
            : 'insufficient';
      const value: AudioMeasurement = {
        id: `audio_measure_${randomUUID()}`,
        projectId: snapshot.project.id,
        clipIds: [...input.clipIds],
        revision,
        startFrame,
        endFrame,
        integratedLufs,
        truePeakDbtp,
        status,
        units: { loudness: 'LUFS', truePeak: 'dBTP' },
        note:
          status === 'silence'
            ? 'The selected mix is silent or muted.'
            : status === 'insufficient'
              ? 'The selection is too short or quiet for integrated loudness. Measure a longer range.'
              : 'Selected processed audio mix before export master limiting. Gain and fades are estimated; remeasure after applying.',
      };
      this.measurements.set(value.id, { value, expires: this.now() + TTL });
      this.prune();
      return value;
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      this.running.delete(requestId);
    }
  }
  cancel(requestId: string) {
    const run = this.running.get(requestId);
    if (run && run.projectId === this.options.projects.current()?.project.id)
      run.controller.abort();
  }
  private store(
    plan: AudioFinishPlan,
    command: EditCommand,
    checkCommand?: (command: EditCommand) => void,
    sources: readonly string[] = plan.clipIds,
  ) {
    if (plan.status === 'ready') checkCommand?.(command);
    this.plans.set(plan.id, {
      plan,
      command,
      sources,
      expires: this.now() + TTL,
    });
    this.prune();
    return plan;
  }
  planGain(
    input: AudioGainRequest,
    checkCommand?: (command: EditCommand) => void,
    origin?: AudioFinishPlan['origin'],
  ): AudioFinishPlan {
    this.prune();
    const measured = this.measurements.get(input.measurementId)?.value;
    const snapshot = this.current();
    if (!measured || measured.projectId !== snapshot.project.id)
      throw new Error(
        'This measurement expired or belongs to another project. Measure the selection again.',
      );
    if (measured.revision !== this.revision(snapshot, measured.clipIds))
      throw new Error(
        'Audio changed since measurement. Measure it again before planning gain.',
      );
    if (
      measured.status !== 'measured' ||
      measured.integratedLufs === null ||
      measured.truePeakDbtp === null
    )
      throw new Error(measured.note);
    const clips = this.clips(snapshot, measured.clipIds, true);
    if (clips.some((c) => c.keyframes.volume.length))
      throw new Error(
        'Volume automation already exists. Preserve it or clear it explicitly before gain finishing.',
      );
    const gainDb = input.targetLufs - measured.integratedLufs;
    const factor = 10 ** (gainDb / 20);
    const estimatedPeakDbtp = measured.truePeakDbtp + gainDb;
    const warnings = [
      'Fades can reduce final loudness. Re-measure after Apply. No limiter is added; export retains its existing master limiter.',
    ];
    let attainable = true;
    if (estimatedPeakDbtp > input.peakCeilingDbtp + 0.01) {
      attainable = false;
      warnings.push(
        'The requested loudness would exceed the peak ceiling. Choose a lower loudness target.',
      );
    }
    if (clips.some((c) => c.volume * factor > 4)) {
      attainable = false;
      warnings.push(
        'The target exceeds the clip gain range. Choose a lower loudness target.',
      );
    }
    const fps = fpsToNumber(snapshot.project.sequence.frameRate);
    const changes = clips.map((c) => ({
      clipId: c.id,
      beforeVolume: c.volume,
      afterVolume: c.volume * factor,
      fadeInFrames: Math.max(
        c.fade.inFrames,
        Math.min(
          Math.ceil((input.fadeMs * fps) / 1000),
          Math.floor(c.durationFrames / 2),
        ),
      ),
      fadeOutFrames: Math.max(
        c.fade.outFrames,
        Math.min(
          Math.ceil((input.fadeMs * fps) / 1000),
          Math.floor(c.durationFrames / 2),
        ),
      ),
    }));
    const commands: EditCommand[] = attainable
      ? changes.map((c) => ({
          type: 'clip.update',
          clipId: clips.find((clip) => clip.id === c.clipId)!.id,
          patch: {
            volume: c.afterVolume,
            fade: { inFrames: c.fadeInFrames, outFrames: c.fadeOutFrames },
          },
        }))
      : [];
    return this.store(
      {
        id: `audio_plan_${randomUUID()}`,
        projectId: snapshot.project.id,
        kind: 'gain',
        clipIds: measured.clipIds,
        revision: measured.revision,
        status: attainable ? 'ready' : 'unattainable',
        warnings,
        gainDb,
        targetLufs: input.targetLufs,
        estimatedPeakDbtp,
        peakCeilingDbtp: input.peakCeilingDbtp,
        changes,
        origin,
      },
      { type: 'batch', label: 'Apply reviewed audio gain and fades', commands },
      checkCommand,
    );
  }
  planDucking(
    input: AudioDuckRequest,
    checkCommand?: (command: EditCommand) => void,
    origin?: AudioFinishPlan['origin'],
  ): AudioFinishPlan {
    const snapshot = this.current();
    this.clips(snapshot, input.backgroundClipIds, true);
    this.clips(snapshot, input.speechClipIds);
    const duck = speechDuckingCommand(
      snapshot.project.sequence,
      snapshot.assets,
      snapshot.transcripts,
      input,
    );
    const clips = this.clips(snapshot, input.backgroundClipIds);
    const changed = new Set(duck.backgroundClipIds);
    const counts = new Map(
      duck.command.type === 'batch'
        ? duck.command.commands.flatMap((c) =>
            c.type === 'clip.setKeyframes'
              ? [[c.clipId, c.keyframes.length] as const]
              : [],
          )
        : [],
    );
    return this.store(
      {
        id: `audio_plan_${randomUUID()}`,
        projectId: snapshot.project.id,
        kind: 'duck',
        clipIds: duck.backgroundClipIds,
        revision: this.revision(snapshot, [
          ...input.speechClipIds,
          ...input.backgroundClipIds,
        ]),
        status: changed.size ? 'ready' : 'unattainable',
        warnings: changed.size
          ? [
              `${duck.intervalCount} indexed speech intervals; background at ${Math.round(input.gain * 100)}% of its current gain during speech; attack ${duck.attackFrames} frames, release ${duck.releaseFrames} frames. Existing source speech is preserved.`,
            ]
          : ['No overlapping background spans to duck.'],
        changes: clips
          .filter((c) => changed.has(c.id))
          .map((c) => ({
            clipId: c.id,
            beforeVolume: c.volume,
            afterVolume: c.volume,
            keyframeCount: counts.get(c.id) ?? 0,
          })),
        origin,
      },
      duck.command,
      checkCommand,
      [...input.speechClipIds, ...input.backgroundClipIds],
    );
  }
  read(id: string): AudioFinishPlan {
    this.prune();
    const entry = this.plans.get(id);
    const snapshot = this.current();
    if (!entry || entry.plan.projectId !== snapshot.project.id)
      throw new Error(
        'That audio finishing plan expired or belongs to another project.',
      );
    if (entry.plan.status === 'applied' || entry.plan.status === 'unattainable')
      return entry.plan;
    try {
      if (this.revision(snapshot, entry.sources) === entry.plan.revision)
        return entry.plan;
    } catch {
      /* Expose stale sources in the review instead of remeasuring. */
    }
    return {
      ...entry.plan,
      status: 'stale',
      warnings: [
        ...entry.plan.warnings,
        'The project, source or speech index changed. Create a new plan explicitly.',
      ],
    };
  }
  reviews(conversationId?: string | null) {
    this.prune();
    const project = this.options.projects.current()?.project.id;
    return [...this.plans.values()]
      .filter(
        (p) =>
          p.plan.projectId === project &&
          (conversationId === undefined ||
            !p.plan.origin ||
            p.plan.origin.conversationId === conversationId),
      )
      .map((p) => this.read(p.plan.id));
  }
  confirm(id: string, context: ToolContext) {
    const plan = this.read(id);
    if (plan.status !== 'ready')
      throw new Error(
        plan.status === 'applied'
          ? 'This audio plan was already applied.'
          : 'This audio plan is stale or unattainable. Create a new plan.',
      );
    const entry = this.plans.get(id)!;
    const result = context.apply(entry.command, {
      label:
        plan.kind === 'gain'
          ? 'Apply reviewed audio gain and fades'
          : 'Apply reviewed speech ducking',
    });
    entry.plan = { ...entry.plan, status: 'applied' };
    return result;
  }
  receipt(id: string, receipt: NonNullable<AudioFinishPlan['receipt']>) {
    const entry = this.plans.get(id);
    if (entry) entry.plan = { ...entry.plan, receipt };
  }
  dispose() {
    this.unsubscribe?.();
    for (const run of this.running.values()) run.controller.abort();
    this.measurements.clear();
    this.plans.clear();
  }
}
