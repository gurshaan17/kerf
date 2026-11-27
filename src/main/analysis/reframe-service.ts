import { createHash } from 'node:crypto';
import { statSync, rmSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import {
  buildReframedSequence,
  reframeSource,
  trackReframe,
} from '@kerf/engine';
import type { ReframeSize, TrackedReframePoint } from '@kerf/engine';
import {
  EMPTY_ASSET_CACHE,
  framesToSeconds,
  newId,
  projectSchema,
  secondsToFrames,
} from '@kerf/model';
import type {
  ReframeCreate,
  ReframePrepare,
  ReframeTrack,
} from '../../shared/reframe';
import type { SqliteDatabase } from '../db';
import type { ProjectRepository, ProjectService } from '../projects';
import { findExecutable, runProcess } from '../media/ffmpeg';

const SAMPLE_RATE = 4;
const WIDTH = 160;
const HEIGHT = 90;
const SAMPLE_BYTES = WIDTH * HEIGHT;
const REVIEW_TTL = 10 * 60_000;
interface Review {
  readonly clipId: string;
  readonly fingerprint: string;
  readonly controller: AbortController;
  readonly expiresAt: number;
  source?: ReframeSize;
  tracking?: boolean;
  cached?: { key: string; points: readonly TrackedReframePoint[] };
}

export class ReframeService {
  private readonly reviews = new Map<string, Review>();
  private readonly unsubscribe: () => void;

  constructor(
    private readonly options: {
      projects: ProjectService;
      repository: ProjectRepository;
      database: SqliteDatabase;
    },
  ) {
    this.unsubscribe = options.projects.subscribe((event) => {
      if (event.type === 'project.closed' || event.type === 'project.opened')
        this.clear();
    });
  }

  private source(clipId: string) {
    const snapshot = this.options.projects.current();
    if (!snapshot) throw new Error('Open a project to reframe a clip.');
    const sequence = snapshot.project.sequence;
    const { video } = reframeSource(sequence, clipId);
    const asset = snapshot.assets.find((item) => item.id === video.assetId);
    if (
      !asset?.hasVideo ||
      asset.status !== 'ready' ||
      sequence.reference?.sourceAssetId === asset.id
    )
      throw new Error('Choose a ready video source from the timeline.');
    const duration = framesToSeconds(video.durationFrames, sequence.frameRate);
    const start = framesToSeconds(video.sourceInFrame, sequence.frameRate);
    if (duration > 120)
      throw new Error(
        'Reframing supports clips up to two minutes. Trim the clip first.',
      );
    if (
      start + duration >
      asset.durationSeconds + framesToSeconds(1, sequence.frameRate)
    )
      throw new Error('The clip extends beyond the source media.');
    const stat = statSync(asset.sourcePath, { throwIfNoEntry: false });
    if (
      !stat ||
      stat.size !== asset.fileSize ||
      Math.abs(stat.mtimeMs - asset.mtimeMs) > 1
    )
      throw new Error(
        'The video source changed. Refresh or relink it before reframing.',
      );
    const fingerprint = createHash('sha256')
      .update(
        JSON.stringify([
          snapshot.project,
          asset.id,
          asset.sourcePath,
          asset.contentHash,
          stat.size,
          stat.mtimeMs,
          snapshot.scenes
            .filter((scene) => scene.assetId === asset.id)
            .map((scene) => scene.startFrame),
        ]),
      )
      .digest('hex');
    return { snapshot, sequence, asset, video, start, duration, fingerprint };
  }

  async prepare(input: ReframePrepare) {
    for (const [id, review] of this.reviews)
      if (review.expiresAt <= Date.now()) this.cancel(id);
    if (this.reviews.has(input.reviewId) || this.reviews.size >= 8)
      throw new Error('Close an existing reframe review first.');
    const current = this.source(input.clipId);
    const controller = new AbortController();
    const review: Review = {
      clipId: input.clipId,
      fingerprint: current.fingerprint,
      controller,
      expiresAt: Date.now() + REVIEW_TTL,
    };
    this.reviews.set(input.reviewId, review);
    try {
      const { stderr } = await runProcess(
        findExecutable('ffmpeg'),
        [
          '-hide_banner',
          '-nostdin',
          '-ss',
          String(current.start),
          '-i',
          current.asset.sourcePath,
          '-map',
          '0:v:0',
          '-frames:v',
          '1',
          '-vf',
          'showinfo',
          '-an',
          '-f',
          'null',
          '-',
        ],
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(15_000),
          ]),
        },
      );
      const dimensions = stderr.match(/\bsar:(\d+)\/(\d+)\s+s:(\d+)x(\d+)/);
      if (!dimensions)
        throw new Error('Could not read the displayed video size.');
      const sar = Number(dimensions[1]) / Number(dimensions[2]);
      const source = {
        width:
          Number(dimensions[3]) * (sar > 0 && Number.isFinite(sar) ? sar : 1),
        height: Number(dimensions[4]),
      };
      controller.signal.throwIfAborted();
      this.assertCurrent(review);
      review.source = source;
      return {
        source,
        sourceStartSeconds: current.start,
        durationFrames: current.video.durationFrames,
      };
    } catch (cause) {
      this.cancel(input.reviewId);
      throw cause;
    }
  }

  private ready(id: string) {
    const review = this.reviews.get(id);
    if (!review?.source || review.expiresAt <= Date.now())
      throw new Error('Open a new reframe review.');
    return { review, source: review.source };
  }

  private assertCurrent(review: Review) {
    const current = this.source(review.clipId);
    if (current.fingerprint !== review.fingerprint)
      throw new Error(
        'The project or video changed. Reopen the reframing preview.',
      );
    return current;
  }

  async track(input: ReframeTrack) {
    const { review, source } = this.ready(input.reviewId);
    const current = this.assertCurrent(review);
    buildReframedSequence(
      current.sequence,
      review.clipId,
      source,
      'vertical',
      input.anchors,
    );
    const key = JSON.stringify(input.anchors);
    if (review.cached?.key === key) return review.cached.points;
    if (review.tracking) throw new Error('Tracking is already in progress.');
    review.tracking = true;
    const signal = AbortSignal.any([
      review.controller.signal,
      AbortSignal.timeout(45_000),
    ]);
    let work: string | undefined;
    try {
      work = await mkdtemp(join(tmpdir(), 'kerf-reframe-'));
      const output = join(work, 'samples.raw');
      await runProcess(
        findExecutable('ffmpeg'),
        [
          '-hide_banner',
          '-nostdin',
          '-loglevel',
          'error',
          '-ss',
          String(current.start),
          '-i',
          current.asset.sourcePath,
          '-map',
          '0:v:0',
          '-t',
          String(current.duration),
          '-frames:v',
          String(Math.ceil(current.duration * SAMPLE_RATE)),
          '-an',
          '-vf',
          `setpts=PTS-STARTPTS,fps=${SAMPLE_RATE}:start_time=0,scale=${WIDTH}:${HEIGHT}:flags=area,format=gray`,
          '-pix_fmt',
          'gray',
          '-f',
          'rawvideo',
          output,
        ],
        { signal },
      );
      const pixels = await readFile(output);
      signal.throwIfAborted();
      if (!pixels.length || pixels.length % SAMPLE_BYTES !== 0)
        throw new Error('The clip was too short to track.');
      const sceneRate = current.asset.frameRate ?? current.sequence.frameRate;
      const cuts = new Set(
        current.snapshot.scenes
          .filter((scene) => scene.assetId === current.asset.id)
          .map((scene) =>
            Math.ceil(
              (framesToSeconds(scene.startFrame, sceneRate) - current.start) *
                SAMPLE_RATE,
            ),
          )
          .filter((sample) => sample > 0),
      );
      const samples = Array.from(
        { length: pixels.length / SAMPLE_BYTES },
        (_, index) => ({
          frame: secondsToFrames(
            index / SAMPLE_RATE,
            current.sequence.frameRate,
          ),
          pixels: pixels.subarray(
            index * SAMPLE_BYTES,
            (index + 1) * SAMPLE_BYTES,
          ),
          cut: cuts.has(index),
        }),
      ).filter(
        (sample, index, frames) =>
          sample.frame < current.video.durationFrames &&
          (index === 0 || sample.frame > frames[index - 1]!.frame),
      );
      const points = new Map<number, TrackedReframePoint>();
      for (const point of trackReframe(samples, input.anchors, WIDTH, HEIGHT)) {
        if (points.size % 8 === 0) {
          await setImmediate();
          signal.throwIfAborted();
        }
        points.set(point.frame, point);
      }
      for (const anchor of input.anchors)
        points.set(anchor.frame, {
          ...anchor,
          status: 'manual',
          shotStart: points.get(anchor.frame)?.shotStart,
        });
      this.assertCurrent(review);
      const sorted = [...points.values()].sort((a, b) => a.frame - b.frame);
      const ordered = sorted.map((point, index) =>
        sorted[index + 1]?.shotStart ? { ...point, hold: true } : point,
      );
      review.cached = { key, points: ordered };
      return ordered;
    } finally {
      review.tracking = false;
      if (work) await rm(work, { recursive: true, force: true });
    }
  }

  create(input: ReframeCreate) {
    const { database, repository, projects } = this.options;
    const key = `reframe-output:${input.reviewId}`;
    const signature = JSON.stringify([input.format, input.points]);
    const existing = database
      .prepare('SELECT value_json FROM app_settings WHERE key = ?')
      .get(key) as { value_json: string } | undefined;
    if (existing) {
      const saved = JSON.parse(existing.value_json) as {
        projectId: string;
        parentId: string;
        signature: string;
      };
      const output = repository.getSummary(saved.projectId);
      if (
        !output ||
        projects.current()?.project.id !== saved.parentId ||
        saved.signature !== signature
      )
        throw new Error(
          'This review already created a version. Open a new review to create another.',
        );
      return { projectId: output.id, name: output.name };
    }
    const { review, source } = this.ready(input.reviewId);
    const current = this.assertCurrent(review);
    const sequence = buildReframedSequence(
      current.sequence,
      review.clipId,
      source,
      input.format,
      input.points,
    );
    const name = `${current.snapshot.project.name} · ${input.format === 'vertical' ? 'Vertical' : 'Square'}`;
    const assetId = newId('asset');
    let folder: string | null = null;
    try {
      return database.transaction(() => {
        const { project } = repository.create({
          name,
          sequence: {
            ...sequence,
            name,
            id: newId('sequence'),
            tracks: sequence.tracks.map((track) => {
              const trackId = newId('track');
              return {
                ...track,
                id: trackId,
                clips: track.clips.map((clip) => ({
                  ...clip,
                  id: newId('clip'),
                  trackId,
                  assetId,
                })),
              };
            }),
            markers: sequence.markers.map((marker) => ({
              ...marker,
              id: newId('marker'),
            })),
          },
        });
        folder = repository.folderFor(project.id);
        const transcript = current.snapshot.transcripts.find(
          (item) => item.assetId === current.asset.id,
        );
        const transcriptId = transcript ? newId('transcript') : null;
        repository.saveAsset({
          ...current.asset,
          id: assetId,
          projectId: project.id,
          cache: EMPTY_ASSET_CACHE,
          transcriptId,
        });
        if (transcript && transcriptId)
          repository.saveTranscript({
            ...transcript,
            id: transcriptId,
            assetId,
            undoStates: [],
            redoStates: [],
          });
        repository.saveProject(
          projectSchema.parse({
            ...project,
            reframeOrigin: {
              version: 1,
              parentProjectId: current.snapshot.project.id,
              sourceAssetId: current.asset.id,
              sourceClipId: review.clipId,
              format: input.format,
              reviewId: input.reviewId,
            },
          }),
        );
        database
          .prepare(
            'INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)',
          )
          .run(
            key,
            JSON.stringify({
              projectId: project.id,
              parentId: current.snapshot.project.id,
              signature,
            }),
            Date.now(),
          );
        return { projectId: project.id, name };
      })();
    } catch (cause) {
      if (folder) rmSync(folder, { recursive: true, force: true });
      throw cause;
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
