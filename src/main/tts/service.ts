import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import {
  clipSchema,
  createTrack,
  fpsToNumber,
  newId,
  secondsToFrames,
  type EditCommand,
} from '@kerf/model';
import type { SqliteDatabase } from '../db';
import type { SecretStore } from '../analysis/providers';
import type { ProjectRepository, ProjectService } from '../projects';
import type { JobQueue, JobContext } from '../jobs';
import type { MediaImportService } from '../media';
import { probeMedia } from '../media/ffmpeg';
import {
  ttsGenerateSchema,
  TTS_MODELS,
  ttsProviderSchema,
  type TtsGenerateRequest,
  type TtsProvider,
  type TtsTake,
} from '../../shared/tts';
import { synthesizeSpeech } from './adapters';

interface AccountRow {
  id: string;
  config_json: string;
  credentials_ciphertext: Buffer | null;
}
interface TakeRow {
  payload_json: string;
  clip_id: string | null;
}
const payloadSchema = z
  .object({
    request: ttsGenerateSchema,
    fingerprint: z.string(),
    epoch: z.number(),
  })
  .strict();

export class TtsService {
  private epoch = 0;
  private readonly unsubscribe: () => void;
  constructor(
    private readonly options: {
      database: SqliteDatabase;
      secrets: SecretStore;
      projects: ProjectService;
      repository: ProjectRepository;
      jobs: JobQueue;
      imports: MediaImportService;
    },
  ) {
    options.jobs.registerHandler('narration.tts', (payload, context) =>
      this.run(payload, context),
    );
    this.unsubscribe = options.projects.subscribe((event) => {
      if (event.type === 'project.closed' || event.type === 'project.opened') {
        this.epoch++;
        for (const job of options.jobs.list()) {
          if (
            job.kind === 'narration.tts' &&
            (job.status === 'queued' || job.status === 'running')
          )
            options.jobs.cancel(job.id);
        }
      }
    });
  }

  dispose(): void {
    this.unsubscribe();
  }
  private account(id: string): AccountRow {
    const row = this.options.database
      .prepare('SELECT * FROM tts_accounts WHERE id = ?')
      .get(id) as AccountRow | undefined;
    if (!row) throw new Error('The TTS provider no longer exists.');
    return row;
  }
  providers(): TtsProvider[] {
    return (
      this.options.database
        .prepare('SELECT * FROM tts_accounts ORDER BY rowid')
        .all() as AccountRow[]
    ).map((row) => ({
      ...JSON.parse(row.config_json),
      id: row.id,
      hasCredentials: Boolean(row.credentials_ciphertext),
    }));
  }
  saveProvider(input: unknown): TtsProvider {
    const { credentials, ...config } = ttsProviderSchema.parse(input);
    if (config.kind === 'openai' || config.kind === 'gemini') {
      const models = TTS_MODELS[config.kind];
      config.model ||= models[0].id;
      if (!models.some((model) => model.id === config.model))
        throw new Error('Choose a supported speech model for this provider.');
    }
    if (config.kind === 'gemini' && config.speed !== 1)
      throw new Error('Gemini speech generation requires speech rate 1.');
    const id = config.id ?? `tts_${randomUUID()}`;
    const previous = config.id ? this.account(config.id) : null;
    const ciphertext = credentials?.trim()
      ? this.options.secrets.encrypt(credentials.trim())
      : (previous?.credentials_ciphertext ?? null);
    if (!ciphertext) throw new Error('Enter credentials for this provider.');
    if (config.kind === 'openai-compatible') {
      const url = new URL(config.endpoint);
      if (
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        (url.protocol !== 'https:' &&
          !(
            url.protocol === 'http:' &&
            ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
          ))
      )
        throw new Error(
          'Use an HTTPS speech endpoint, or HTTP on localhost, without URL credentials or query parameters.',
        );
    }
    if (previous) {
      const old = JSON.parse(previous.config_json) as TtsProvider;
      if (
        !credentials?.trim() &&
        (old.kind !== config.kind || old.endpoint !== config.endpoint)
      )
        throw new Error(
          'Enter credentials again when changing the provider or endpoint.',
        );
    }
    this.options.database
      .prepare(
        `INSERT INTO tts_accounts VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json, credentials_ciphertext=excluded.credentials_ciphertext`,
      )
      .run(id, JSON.stringify({ ...config, id }), ciphertext);
    return this.providers().find((provider) => provider.id === id)!;
  }
  deleteProvider(id: string): boolean {
    return (
      this.options.database
        .prepare('DELETE FROM tts_accounts WHERE id = ?')
        .run(id).changes > 0
    );
  }
  private fingerprint(id: string): string {
    const row = this.account(id);
    return createHash('sha256')
      .update(row.config_json)
      .update(row.credentials_ciphertext ?? Buffer.alloc(0))
      .digest('hex');
  }
  private context(request: TtsGenerateRequest) {
    const snapshot = this.options.projects.current();
    const transcript = snapshot?.transcripts.find(
      (t) => t.id === request.transcriptId,
    );
    const segment = transcript?.segments.find(
      (s) => s.id === request.segmentId,
    );
    const source = snapshot?.assets.find((a) => a.id === transcript?.assetId);
    if (
      !snapshot ||
      !transcript ||
      !segment ||
      !source ||
      transcript.source !== 'visual' ||
      transcript.revision !== request.expectedRevision
    )
      throw new Error(
        'Narration changed. Reload before generating or placing voice-over.',
      );
    if (!segment.text.trim() || segment.text.length > 2000)
      throw new Error('Speech requires between 1 and 2000 characters per row.');
    return { snapshot, transcript, segment, source };
  }
  generate(input: unknown): { jobId: string } {
    const request = ttsGenerateSchema.parse(input);
    const { snapshot } = this.context(request);
    const fingerprint = this.fingerprint(request.providerId);
    const pending = this.options.database
      .prepare(
        "SELECT payload_json FROM jobs WHERE project_id = ? AND kind = 'narration.tts' AND status IN ('queued', 'running')",
      )
      .all(snapshot.project.id) as { payload_json: string }[];
    const duplicate = pending.some((job) => {
      const p = payloadSchema.safeParse(JSON.parse(job.payload_json));
      return (
        p.success &&
        p.data.request.transcriptId === request.transcriptId &&
        p.data.request.segmentId === request.segmentId
      );
    });
    if (duplicate)
      throw new Error('Speech generation is already queued for this row.');
    const job = this.options.jobs.enqueue({
      projectId: snapshot.project.id,
      kind: 'narration.tts',
      payload: { request, fingerprint, epoch: this.epoch },
    });
    return { jobId: job.id };
  }
  takes(transcriptId: string): TtsTake[] {
    const snapshot = this.options.projects.current();
    if (!snapshot?.transcripts.some((t) => t.id === transcriptId))
      throw new Error('Open the project containing this narration.');
    return (
      this.options.database
        .prepare(
          'SELECT payload_json FROM tts_takes WHERE transcript_id = ? AND project_id = ? ORDER BY rowid DESC',
        )
        .all(transcriptId, snapshot.project.id) as TakeRow[]
    ).map((row) => JSON.parse(row.payload_json));
  }
  private async run(input: unknown, context: JobContext) {
    const payload = payloadSchema.parse(input);
    const { request } = payload;
    const initial = this.context(request);
    const check = () => {
      context.signal.throwIfAborted();
      if (
        payload.epoch !== this.epoch ||
        this.fingerprint(request.providerId) !== payload.fingerprint
      )
        throw new Error('Project or TTS settings changed. Generate again.');
      const latest = this.context(request);
      if (
        latest.snapshot.project.id !== initial.snapshot.project.id ||
        latest.source.sourcePath !== initial.source.sourcePath ||
        latest.source.contentHash !== initial.source.contentHash
      )
        throw new Error('The source media changed. Generate again.');
    };
    check();
    const account = this.account(request.providerId);
    const provider = this.providers().find((p) => p.id === request.providerId)!;
    const credentials = this.options.secrets.decrypt(
      account.credentials_ciphertext!,
    );
    const signal = AbortSignal.any([
      context.signal,
      AbortSignal.timeout(120000),
    ]);
    context.update(0.1, 'Generating speech');
    const audio = await synthesizeSpeech(
      provider,
      credentials,
      initial.segment.text,
      signal,
    );
    check();
    const folder = this.options.repository.folderFor(
      initial.snapshot.project.id,
    );
    if (!folder) throw new Error('The project folder is unavailable.');
    const directory = join(folder, 'assets', 'voiceover');
    await mkdir(directory, { recursive: true });
    const id = `take_${randomUUID()}`;
    const path = join(directory, `${id}.${audio.extension}`);
    let imported = false;
    try {
      await writeFile(path, audio.bytes, { flag: 'wx' });
      const probe = await probeMedia(path, { signal });
      if (
        !probe.hasAudio ||
        probe.hasVideo ||
        !Number.isFinite(probe.durationSeconds) ||
        probe.durationSeconds <= 0
      )
        throw new Error('The provider did not return valid speech audio.');
      check();
      context.update(0.8, 'Importing speech audio');
      const assets = await this.options.imports.importFiles(
        initial.snapshot.project.id,
        [path],
      );
      imported = true;
      check();
      const take: TtsTake = {
        id,
        projectId: initial.snapshot.project.id,
        transcriptId: request.transcriptId,
        segmentId: request.segmentId,
        text: initial.segment.text,
        providerId: provider.id,
        voice: provider.voice,
        model: provider.model,
        speed: provider.speed,
        assetId: assets[0]!.id,
        createdAt: Date.now(),
      };
      this.options.database
        .prepare(
          'INSERT INTO tts_takes (id, project_id, transcript_id, segment_id, payload_json) VALUES (?, ?, ?, ?, ?)',
        )
        .run(
          id,
          take.projectId,
          take.transcriptId,
          take.segmentId,
          JSON.stringify(take),
        );
      context.update(1, 'Speech ready to preview');
      return { takeId: id };
    } finally {
      if (!imported) await unlink(path).catch(() => undefined);
    }
  }
  place(input: unknown): void {
    const { takeId, expectedRevision } = z
      .object({
        takeId: z.string().min(1),
        expectedRevision: z.number().int().nonnegative(),
      })
      .strict()
      .parse(input);
    const row = this.options.database
      .prepare('SELECT * FROM tts_takes WHERE id = ?')
      .get(takeId) as TakeRow | undefined;
    if (!row) throw new Error('Speech take not found.');
    const take = JSON.parse(row.payload_json) as TtsTake;
    const { snapshot, transcript, segment, source } = this.context({
      transcriptId: take.transcriptId,
      segmentId: take.segmentId,
      expectedRevision,
      providerId: take.providerId,
    });
    if (take.projectId !== snapshot.project.id || take.text !== segment.text)
      throw new Error('This speech take is outdated. Generate it again.');
    const audio = snapshot.assets.find((a) => a.id === take.assetId);
    if (!audio || audio.status !== 'ready')
      throw new Error('Wait until audio import finishes successfully.');
    const sequence = snapshot.project.sequence;
    const sourceFps = fpsToNumber(source.frameRate ?? sequence.frameRate);
    const first = secondsToFrames(
      segment.startFrame / sourceFps,
      sequence.frameRate,
    );
    const last = secondsToFrames(
      segment.endFrame / sourceFps,
      sequence.frameRate,
    );
    const video = sequence.tracks
      .flatMap((track) => track.clips)
      .find(
        (clip) =>
          clip.type === 'video' &&
          clip.assetId === transcript.assetId &&
          clip.speed === 1 &&
          clip.timeMap.length === 0 &&
          first >= clip.sourceInFrame &&
          last <= clip.sourceInFrame + clip.durationFrames,
      );
    if (!video || video.type !== 'video')
      throw new Error(
        'Place this source range on the timeline at normal speed first.',
      );
    const duration = Math.floor(
      secondsToFrames(audio.durationSeconds, sequence.frameRate),
    );
    if (duration < 1 || duration > last - first)
      throw new Error(
        'Speech exceeds the narration interval. Shorten the text, change speech speed, or extend the interval.',
      );
    const commands: EditCommand[] = [];
    const placed = this.options.database
      .prepare(
        'SELECT clip_id FROM tts_takes WHERE transcript_id = ? AND segment_id = ? AND clip_id IS NOT NULL',
      )
      .all(take.transcriptId, take.segmentId) as { clip_id: string }[];
    const ids = new Set(placed.map((p) => p.clip_id));
    for (const track of sequence.tracks)
      for (const clip of track.clips) {
        if (ids.has(clip.id)) {
          if (track.locked)
            throw new Error(
              'Unlock the previous voice-over track before updating it.',
            );
          commands.push({ type: 'clip.remove', clipId: clip.id });
        }
      }
    const startFrame = video.startFrame + first - video.sourceInFrame;
    const reusable = sequence.tracks.find(
      (track) =>
        track.kind === 'audio' &&
        track.name === 'Voice-over' &&
        !track.locked &&
        track.clips.every(
          (clip) =>
            ids.has(clip.id) ||
            clip.startFrame + clip.durationFrames <= startFrame ||
            clip.startFrame >= startFrame + duration,
        ),
    );
    const track =
      reusable ??
      createTrack({
        kind: 'audio',
        name: 'Voice-over',
        order: Math.max(-1, ...sequence.tracks.map((t) => t.order)) + 1,
      });
    const clip = clipSchema.parse({
      id: row.clip_id ?? newId('clip'),
      type: 'audio',
      assetId: audio.id,
      trackId: track.id,
      startFrame,
      durationFrames: duration,
      label: segment.text.slice(0, 80),
    });
    if (!reusable) commands.push({ type: 'track.add', track });
    commands.push({ type: 'clip.insert', clip });
    this.options.projects.apply({
      type: 'batch',
      label: 'Add / update voice-over',
      commands,
    });
    this.options.database
      .prepare('UPDATE tts_takes SET clip_id = ? WHERE id = ?')
      .run(clip.id, take.id);
  }
}
