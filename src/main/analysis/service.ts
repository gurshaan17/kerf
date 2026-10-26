import { join } from 'node:path';
import { z } from 'zod';
import type { Asset, FrameRate, ReferenceProfile, Scene } from '@kerf/model';
import { secondsToFrames } from '@kerf/model';
import type { DatabaseHandle } from '../db';
import { findExecutable } from '../media/ffmpeg';
import type { JobContext, JobQueue } from '../jobs';
import type { ProjectRepository, ProjectService } from '../projects';
import type { SecretStore } from './providers';
import { ProviderStore } from './providers';
import { detectBeatMap } from './beats';
import { profileReferenceAsset } from './reference';
import { detectScenes } from './scenes';
import { SearchService } from './search';
import { transcribeAsset } from './transcribe';
import { describeScenes } from './vision';
import {
  deleteModel,
  downloadModel,
  findModelPath,
  findWhisperBinary,
  installedModels,
  modelRootFor,
  WhisperUnavailableError,
} from './whisper';
import type {
  AnalysisAssetStatus,
  AnalysisKind,
  AnalysisRunRequest,
  AnalysisRunResult,
  AnalysisSkip,
  ProviderAccount,
  ProviderSaveRequest,
  ProviderTestResult,
  SearchRequest,
  SearchResponse,
  WhisperModelInfo,
  WhisperModelInstall,
  CompositionSaveRequest,
  CompositionSaveResult,
  ProjectSnapshot,
} from '../../shared/contracts';
import { createComposition, newId, referenceProfileSchema } from '@kerf/model';

const assetPayloadSchema = z.object({ assetId: z.string().min(1) });
const modelPayloadSchema = z.object({ modelId: z.string().min(1) });

const ANALYSIS_KINDS: readonly AnalysisKind[] = [
  'transcript',
  'scenes',
  'beats',
  'vision',
  'embeddings',
];

export interface AnalysisServiceOptions {
  readonly database: DatabaseHandle;
  readonly repository: ProjectRepository;
  readonly projects: ProjectService;
  readonly jobs: JobQueue;
  readonly userData: string;
  readonly ffmpeg?: string;
  readonly secrets: SecretStore;
  readonly now?: () => number;
}

export class AnalysisService {
  private readonly repository: ProjectRepository;
  private readonly projects: ProjectService;
  private readonly jobs: JobQueue;
  private readonly userData: string;
  private readonly ffmpeg: string | undefined;
  private readonly now: () => number;
  private readonly searchService: SearchService;
  private readonly providerStore: ProviderStore;

  constructor(options: AnalysisServiceOptions) {
    this.repository = options.repository;
    this.projects = options.projects;
    this.jobs = options.jobs;
    this.userData = options.userData;
    this.ffmpeg = options.ffmpeg;
    this.now = options.now ?? Date.now;
    this.searchService = new SearchService({
      database: options.database.connection,
      repository: options.repository,
      fts5Enabled: options.database.fts5Enabled,
    });
    this.providerStore = new ProviderStore({
      database: options.database.connection,
      secrets: options.secrets,
      now: this.now,
    });
    this.registerJobs();
  }

  get providers(): ProviderStore {
    return this.providerStore;
  }

  get search(): SearchService {
    return this.searchService;
  }

  modelRoot(): string {
    return modelRootFor(this.userData);
  }

  models(): WhisperModelInfo[] {
    return installedModels(this.modelRoot());
  }

  async downloadModel(modelId: string): Promise<WhisperModelInstall> {
    const job = this.jobs.enqueue({
      projectId: null,
      kind: 'model.download',
      payload: { modelId },
    });
    return { job };
  }

  deleteModel(modelId: string): boolean {
    return deleteModel(this.modelRoot(), modelId);
  }

  listProviders(): ProviderAccount[] {
    return this.providerStore.list();
  }

  saveProvider(request: ProviderSaveRequest): ProviderAccount {
    return this.providerStore.save(request);
  }

  deleteProvider(id: string): boolean {
    return this.providerStore.delete(id);
  }

  testProvider(id: string): Promise<ProviderTestResult> {
    return this.providerStore.test(id);
  }

  status(): AnalysisAssetStatus[] {
    const snapshot = this.projects.current();
    if (!snapshot) {
      return [];
    }
    return snapshot.assets.map((asset) => {
      const transcript =
        snapshot.transcripts.find(
          (candidate) => candidate.assetId === asset.id,
        ) ?? null;
      const scenes = snapshot.scenes.filter(
        (candidate) => candidate.assetId === asset.id,
      );
      const beatMap =
        snapshot.beatMaps.find((candidate) => candidate.assetId === asset.id) ??
        null;
      return {
        assetId: asset.id,
        transcript: transcript !== null,
        sceneCount: scenes.length,
        descriptions: scenes.filter(
          (scene) => scene.description !== null && scene.description.length > 0,
        ).length,
        beatMap: beatMap !== null,
        bpm: beatMap?.bpm ?? null,
        embeddings: false,
      };
    });
  }

  run(request: AnalysisRunRequest): AnalysisRunResult {
    const snapshot = this.projects.current();
    if (!snapshot) {
      throw new Error('Open a project before running analysis.');
    }
    const asset = snapshot.assets.find(
      (candidate) => candidate.id === request.assetId,
    );
    if (!asset) {
      throw new Error('That asset is not part of the open project.');
    }
    const kinds = [...new Set(request.kinds)].filter((kind) =>
      ANALYSIS_KINDS.includes(kind),
    );
    const jobs = [];
    const skipped: AnalysisSkip[] = [];
    for (const kind of kinds) {
      const skip = this.skipReason(kind, asset, snapshot);
      if (skip) {
        skipped.push({ kind, reason: skip });
        continue;
      }
      const job = this.jobs.enqueue({
        projectId: snapshot.project.id,
        kind: `analysis.${kind}`,
        payload: { assetId: asset.id },
      });
      jobs.push(job);
    }
    return { jobs, skipped };
  }

  query(request: SearchRequest): SearchResponse {
    const snapshot = this.projects.current();
    if (!snapshot) {
      throw new Error('Open a project before searching.');
    }
    return this.searchService.search(snapshot.project.id, request);
  }

  async detectBeats(assetId: string): Promise<import('@kerf/model').BeatMap> {
    const { projectId, asset, rate } = this.projectContext(assetId);
    const beatMap = await detectBeatMap({
      asset,
      ffmpeg: this.ffmpegPath(),
      rate,
      durationFrames: this.durationFrames(asset, rate),
      now: this.now,
    });
    this.repository.deleteBeatMapsForAsset(asset.id);
    this.repository.saveBeatMap(beatMap);
    this.refresh(projectId);
    return beatMap;
  }

  async profileReference(
    assetId: string,
    name?: string,
  ): Promise<ReferenceProfile> {
    const { projectId, asset, rate } = this.projectContext(assetId);
    const durationFrames = this.durationFrames(asset, rate);
    const existing = this.repository
      .listReferenceProfiles(projectId)
      .find((profile) => profile.sourceAssetId === asset.id);
    const metrics = await profileReferenceAsset({
      asset,
      ffmpeg: this.ffmpegPath(),
      rate,
      durationFrames,
    });
    const now = this.now();
    return this.repository.saveReferenceProfile(
      projectId,
      referenceProfileSchema.parse({
        id: existing?.id ?? newId('reference'),
        name: name?.trim() || existing?.name || asset.name,
        sourceAssetId: asset.id,
        palette: metrics.palette,
        mood: existing?.mood ?? [],
        notes: existing?.notes ?? '',
        sceneCount: metrics.sceneCount,
        averageShotLengthFrames: metrics.averageShotLengthFrames,
        cutsPerMinute: metrics.cutsPerMinute,
        meanLuma: metrics.meanLuma,
        meanSaturation: metrics.meanSaturation,
        meanContrast: metrics.meanContrast,
        analyzedAt: now,
        createdAt: existing?.createdAt ?? now,
      }),
    );
  }

  reindexActive(): void {
    const snapshot = this.projects.current();
    if (snapshot) {
      this.searchService.reindexProject(snapshot.project.id);
    }
  }

  saveComposition(request: CompositionSaveRequest): CompositionSaveResult {
    const snapshot = this.projects.current();
    if (!snapshot) {
      throw new Error('Open a project before creating a composition.');
    }
    const existing = request.id
      ? this.repository.findComposition(request.id)
      : null;
    if (request.id && !existing) {
      throw new Error('That composition no longer exists.');
    }
    const now = this.now();
    const composition = existing
      ? {
          ...existing,
          name: request.name.trim(),
          source: request.source,
          width: request.width ?? existing.width,
          height: request.height ?? existing.height,
          durationFrames: request.durationFrames ?? existing.durationFrames,
          updatedAt: now,
        }
      : createComposition({
          projectId: snapshot.project.id,
          name: request.name,
          source: request.source,
          width: request.width,
          height: request.height,
          durationFrames: request.durationFrames,
          now,
        });
    this.repository.saveComposition(composition);
    return {
      composition,
      snapshot: this.projects.refresh('compositions'),
    };
  }

  deleteComposition(id: string): ProjectSnapshot {
    const snapshot = this.projects.current();
    if (!snapshot) {
      throw new Error('Open a project before deleting a composition.');
    }
    const composition = this.repository.findComposition(id);
    if (composition && composition.projectId !== snapshot.project.id) {
      throw new Error('That composition belongs to another project.');
    }
    this.repository.deleteComposition(id);
    return this.projects.refresh('compositions');
  }

  private skipReason(
    kind: AnalysisKind,
    asset: Asset,
    snapshot: ProjectSnapshot,
  ): string | null {
    if (kind === 'embeddings') {
      return 'Vector search is unavailable. Lexical search is still active.';
    }
    if (kind === 'vision') {
      const provider = this.providerStore.visionProvider();
      if (!provider) {
        return 'Enable a vision provider and grant per-account consent first.';
      }
      const scenes = snapshot.scenes.filter(
        (scene) => scene.assetId === asset.id && scene.thumbnailPath,
      );
      if (scenes.length === 0) {
        return 'Detect scenes before describing keyframes.';
      }
      return null;
    }
    if (asset.kind === 'image') {
      return 'This asset has no audio or video to analyse.';
    }
    if (kind === 'transcript' || kind === 'beats') {
      if (!asset.hasAudio && asset.kind !== 'audio') {
        return 'This asset does not contain audio.';
      }
    }
    if (kind === 'transcript') {
      let binary: string | null = null;
      try {
        binary = findWhisperBinary();
      } catch {
        binary = null;
      }
      if (!binary) {
        return 'Whisper is not installed. Set KERF_WHISPER_PATH or install whisper.cpp.';
      }
      if (!findModelPath(this.modelRoot())) {
        return 'Download a Whisper model in Analysis settings.';
      }
    }
    if (kind === 'scenes' && !asset.hasVideo && asset.kind !== 'video') {
      return 'Scene detection needs a video asset.';
    }
    return null;
  }

  private registerJobs(): void {
    this.jobs.registerHandler('analysis.transcript', (payload, context) =>
      this.transcriptJob(assetPayloadSchema.parse(payload), context),
    );
    this.jobs.registerHandler('analysis.scenes', (payload, context) =>
      this.scenesJob(assetPayloadSchema.parse(payload), context),
    );
    this.jobs.registerHandler('analysis.beats', (payload, context) =>
      this.beatsJob(assetPayloadSchema.parse(payload), context),
    );
    this.jobs.registerHandler('analysis.vision', (payload, context) =>
      this.visionJob(assetPayloadSchema.parse(payload), context),
    );
    this.jobs.registerHandler('model.download', (payload, context) =>
      this.modelDownloadJob(modelPayloadSchema.parse(payload), context),
    );
  }

  private ffmpegPath(): string {
    return this.ffmpeg ?? findExecutable('ffmpeg');
  }

  private projectContext(assetId: string): {
    projectId: string;
    asset: Asset;
    rate: FrameRate;
    folder: string;
  } {
    const snapshot = this.projects.current();
    if (!snapshot) {
      throw new Error('The project was closed before analysis finished.');
    }
    const asset = snapshot.assets.find((candidate) => candidate.id === assetId);
    if (!asset) {
      throw new Error('The asset disappeared before analysis finished.');
    }
    const folder = this.repository.folderFor(snapshot.project.id);
    if (!folder) {
      throw new Error('The project folder could not be found.');
    }
    return {
      projectId: snapshot.project.id,
      asset,
      rate: asset.frameRate ?? snapshot.project.sequence.frameRate,
      folder,
    };
  }

  private durationFrames(asset: Asset, rate: FrameRate): number {
    return Math.max(1, secondsToFrames(asset.durationSeconds, rate));
  }

  private refresh(projectId: string): void {
    if (this.projects.current()?.project.id === projectId) {
      this.projects.refresh('analysis');
    }
  }

  private async transcriptJob(
    payload: { assetId: string },
    context: JobContext,
  ): Promise<{ transcriptId: string }> {
    const { projectId, asset, folder } = this.projectContext(payload.assetId);
    const binary = findWhisperBinary();
    if (!binary) {
      throw new WhisperUnavailableError('Whisper is not installed.');
    }
    const model = findModelPath(this.modelRoot());
    if (!model) {
      throw new WhisperUnavailableError('No Whisper model is installed.');
    }
    context.update(0, 'Extracting audio');
    const transcript = await transcribeAsset({
      asset,
      ffmpeg: this.ffmpegPath(),
      whisper: binary,
      model,
      workDirectory: join(folder, 'analysis', 'work'),
      signal: context.signal,
      onProgress: (progress) =>
        context.update(
          progress,
          progress < 0.2 ? 'Extracting audio' : 'Transcribing',
        ),
      now: this.now,
    });
    this.repository.deleteTranscriptsForAsset(asset.id);
    this.repository.saveTranscript(transcript);
    this.repository.saveAsset({
      ...asset,
      transcriptId: transcript.id,
      updatedAt: this.now(),
    });
    this.searchService.reindexProject(projectId);
    this.refresh(projectId);
    return { transcriptId: transcript.id };
  }

  private async scenesJob(
    payload: { assetId: string },
    context: JobContext,
  ): Promise<{ count: number }> {
    const { projectId, asset, rate, folder } = this.projectContext(
      payload.assetId,
    );
    context.update(0, 'Scanning for cuts');
    const scenes = await detectScenes({
      asset,
      ffmpeg: this.ffmpegPath(),
      rate,
      durationFrames: this.durationFrames(asset, rate),
      keyframesRoot: join(folder, 'analysis', 'keyframes'),
      signal: context.signal,
      onProgress: (progress) =>
        context.update(
          progress,
          progress < 0.35 ? 'Scanning for cuts' : 'Extracting keyframes',
        ),
      now: this.now,
    });
    this.repository.deleteScenesForAsset(asset.id);
    for (const scene of scenes) {
      this.repository.saveScene(scene);
    }
    this.searchService.reindexProject(projectId);
    this.refresh(projectId);
    return { count: scenes.length };
  }

  private async beatsJob(
    payload: { assetId: string },
    context: JobContext,
  ): Promise<{ beatMapId: string; bpm: number }> {
    const { projectId, asset, rate } = this.projectContext(payload.assetId);
    context.update(0, 'Decoding audio');
    const beatMap = await detectBeatMap({
      asset,
      ffmpeg: this.ffmpegPath(),
      rate,
      durationFrames: this.durationFrames(asset, rate),
      signal: context.signal,
      onProgress: (progress) =>
        context.update(
          progress,
          progress < 0.75 ? 'Decoding audio' : 'Finding tempo',
        ),
      now: this.now,
    });
    this.repository.deleteBeatMapsForAsset(asset.id);
    this.repository.saveBeatMap(beatMap);
    this.refresh(projectId);
    return { beatMapId: beatMap.id, bpm: beatMap.bpm };
  }

  private async visionJob(
    payload: { assetId: string },
    context: JobContext,
  ): Promise<{ described: number }> {
    const { projectId, asset } = this.projectContext(payload.assetId);
    const provider = this.providerStore.visionProvider();
    if (!provider) {
      throw new Error('No vision provider is enabled.');
    }
    const snapshot = this.projects.current();
    const scenes: Scene[] = (snapshot?.scenes ?? []).filter(
      (scene) => scene.assetId === asset.id,
    );
    context.update(0, 'Describing keyframes');
    const updated = await describeScenes({
      asset,
      scenes,
      providers: this.providerStore,
      provider,
      repository: this.repository,
      signal: context.signal,
      onProgress: (progress) =>
        context.update(progress, 'Describing keyframes'),
    });
    this.searchService.reindexProject(projectId);
    this.refresh(projectId);
    return { described: updated.length };
  }

  private async modelDownloadJob(
    payload: { modelId: string },
    context: JobContext,
  ): Promise<{ path: string }> {
    context.update(0, 'Downloading model');
    const path = await downloadModel({
      root: this.modelRoot(),
      modelId: payload.modelId,
      signal: context.signal,
      onProgress: (progress) => context.update(progress, 'Downloading model'),
    });
    return { path };
  }
}
