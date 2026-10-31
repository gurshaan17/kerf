import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assetSchema,
  clipSchema,
  createAsset,
  createTranscript,
  newId,
  transcriptSchema,
  transcriptSegmentSchema,
} from '@kerf/model';
import type { TtsTake } from '../../shared/tts';
import { openDatabase } from '../db';
import { JobQueue } from '../jobs';
import { MediaImportService } from '../media';
import { ProjectRepository, ProjectService } from '../projects';
import { TtsService } from './service';

const { synthesize, probe } = vi.hoisted(() => ({
  synthesize: vi.fn(),
  probe: vi.fn(),
}));
vi.mock('./adapters', () => ({ synthesizeSpeech: synthesize }));
vi.mock('../media/ffmpeg', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../media/ffmpeg')>()),
  probeMedia: probe,
}));
beforeEach(() => {
  synthesize.mockReset();
  probe.mockReset();
  probe.mockResolvedValue({
    hasAudio: true,
    hasVideo: false,
    durationSeconds: 2,
  });
});

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kerf-tts-'));
  const database = openDatabase({ filename: join(root, 'test.db') });
  const repository = new ProjectRepository({
    database: database.connection,
    projectsRoot: join(root, 'projects'),
  });
  const jobs = new JobQueue({ database: database.connection });
  const projects = new ProjectService({
    repository,
    jobs: (id) => jobs.list(id),
  });
  const snapshot = projects.create({
    name: 'Speech test',
    frameRate: { numerator: 30, denominator: 1 },
  });
  const sourcePath = join(root, 'source.mp4');
  writeFileSync(sourcePath, 'source');
  const source = repository.saveAsset(
    assetSchema.parse({
      ...createAsset({
        projectId: snapshot.project.id,
        sourcePath,
        kind: 'video',
        status: 'ready',
        name: 'source.mp4',
        fileSize: 6,
        mtimeMs: 1,
      }),
      durationSeconds: 20,
      frameRate: { numerator: 24, denominator: 1 },
      hasVideo: true,
    }),
  );
  const segment = transcriptSegmentSchema.parse({
    id: newId('segment'),
    startFrame: 48,
    endFrame: 144,
    text: 'Open the settings panel.',
  });
  const transcript = transcriptSchema.parse({
    ...createTranscript({ assetId: source.id, segments: [segment] }),
    source: 'visual',
  });
  repository.commitNarration(transcript, null);
  projects.reloadAssets();
  const imports = new MediaImportService({ repository, jobs });
  const service = new TtsService({
    database: database.connection,
    repository,
    projects,
    jobs,
    imports,
    secrets: {
      encrypt: (value) => Buffer.from(`encrypted:${value}`),
      decrypt: (value) => value.toString().slice(10),
    },
  });
  const provider = service.saveProvider({
    kind: 'openai-compatible',
    label: 'Test speech',
    voice: 'test',
    model: 'tts',
    endpoint: 'http://127.0.0.1:9999/speech',
    credentials: 'secret-key',
  });
  const request = {
    transcriptId: transcript.id,
    segmentId: segment.id,
    expectedRevision: 0,
    providerId: provider.id,
  };
  cleanups.push(() => {
    service.dispose();
    jobs.stop();
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const addVideo = () => {
    const track = projects
      .current()!
      .project.sequence.tracks.find((t) => t.kind === 'video')!;
    projects.apply({
      type: 'clip.insert',
      clip: clipSchema.parse({
        type: 'video',
        id: newId('clip'),
        assetId: source.id,
        trackId: track.id,
        startFrame: 100,
        sourceInFrame: 30,
        durationFrames: 300,
      }),
    });
  };
  const addTake = (duration = 2, text = segment.text) => {
    const path = join(root, `${newId('asset')}.mp3`);
    writeFileSync(path, 'audio');
    const audio = repository.saveAsset(
      assetSchema.parse({
        ...createAsset({
          projectId: snapshot.project.id,
          sourcePath: path,
          kind: 'audio',
          status: 'ready',
          name: 'speech.mp3',
          fileSize: 5,
          mtimeMs: 1,
        }),
        durationSeconds: duration,
        hasAudio: true,
      }),
    );
    projects.reloadAssets();
    const take: TtsTake = {
      id: `take_${audio.id}`,
      projectId: snapshot.project.id,
      transcriptId: transcript.id,
      segmentId: segment.id,
      text,
      providerId: provider.id,
      voice: 'test',
      model: 'tts',
      speed: 1,
      assetId: audio.id,
      createdAt: Date.now(),
    };
    database.connection
      .prepare(
        'INSERT INTO tts_takes(id, project_id, transcript_id, segment_id, payload_json) VALUES (?, ?, ?, ?, ?)',
      )
      .run(
        take.id,
        take.projectId,
        take.transcriptId,
        take.segmentId,
        JSON.stringify(take),
      );
    return take;
  };
  return {
    root,
    imports,
    source,
    database,
    repository,
    projects,
    jobs,
    service,
    provider,
    request,
    transcript,
    segment,
    addVideo,
    addTake,
  };
}

describe('TTS service', () => {
  it.each([
    ['openai', 'gpt-4o-mini-tts', 'alloy'],
    ['gemini', 'gemini-3.8-flash-tts', 'Kore'],
  ] as const)(
    'saves native %s accounts with a usable default model and no secret exposure',
    (kind, model, voice) => {
      const f = fixture();
      const saved = f.service.saveProvider({
        kind,
        label: kind,
        voice,
        credentials: 'native-test-key',
      });
      expect(saved).toMatchObject({ kind, model, hasCredentials: true });
      expect(JSON.stringify(f.service.providers())).not.toContain(
        'native-test-key',
      );
      const { hasCredentials: _hasCredentials, ...settings } = saved;
      const edited = f.service.saveProvider(settings);
      expect(edited.model).toBe(model);
    },
  );
  it('rejects unsupported native models and unsupported Gemini speed before saving credentials', () => {
    const f = fixture();
    const config = {
      kind: 'gemini',
      label: 'Gemini',
      voice: 'Kore',
      credentials: 'native-test-key',
    };
    expect(() =>
      f.service.saveProvider({
        ...config,
        model: 'gemini-3.8-flash-lite-tts',
        speed: 1.2,
      }),
    ).toThrow(/speech rate 1/);
    expect(() =>
      f.service.saveProvider({ ...config, model: 'a-chat-model' }),
    ).toThrow(/supported speech model/);
  });
  it('runs a queued request, validates and imports audio, then persists the take across reopening', async () => {
    const f = fixture();
    synthesize.mockResolvedValue({
      bytes: Buffer.from('generated audio'),
      extension: 'mp3',
    });
    const importer = vi
      .spyOn(f.imports, 'importFiles')
      .mockImplementation(async (projectId, paths) => {
        expect(readFileSync(paths[0]!, 'utf8')).toBe('generated audio');
        const audio = f.repository.saveAsset(
          assetSchema.parse({
            ...createAsset({
              projectId: f.source.projectId,
              sourcePath: paths[0]!,
              kind: 'audio',
              status: 'ready',
              name: 'voice.mp3',
              fileSize: 15,
              mtimeMs: 1,
            }),
            durationSeconds: 2,
            hasAudio: true,
          }),
        );
        expect(projectId).toBe(f.source.projectId);
        f.projects.reloadAssets();
        return [audio];
      });
    const { jobId } = f.service.generate(f.request);
    f.jobs.start();
    await vi.waitFor(() => expect(f.jobs.get(jobId)?.status).toBe('succeeded'));
    expect(synthesize).toHaveBeenCalledWith(
      f.provider,
      'secret-key',
      f.segment.text,
      expect.any(AbortSignal),
    );
    expect(importer).toHaveBeenCalledOnce();
    const takes = f.service.takes(f.transcript.id);
    expect(takes).toHaveLength(1);
    expect(takes[0]).toMatchObject({
      text: f.segment.text,
      transcriptId: f.transcript.id,
      segmentId: f.segment.id,
      providerId: f.provider.id,
    });
    const audio = f.repository.findAsset(takes[0]!.assetId)!;
    expect(audio.sourcePath).toContain(join('assets', 'voiceover'));
    expect(existsSync(audio.sourcePath)).toBe(true);
    f.projects.close();
    f.projects.open(f.source.projectId);
    expect(f.service.takes(f.transcript.id)).toEqual(takes);
  });

  it.each(['provider', 'transcript'] as const)(
    'discards in-flight speech when the %s changes and preserves previous takes',
    async (change) => {
      const f = fixture();
      const previous = f.addTake();
      let resolve!: (audio: { bytes: Buffer; extension: 'mp3' }) => void;
      synthesize.mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      const importer = vi.spyOn(f.imports, 'importFiles');
      const { jobId } = f.service.generate(f.request);
      f.jobs.start();
      await vi.waitFor(() => expect(synthesize).toHaveBeenCalledOnce());
      if (change === 'provider') {
        const { hasCredentials: _hasCredentials, ...config } = f.provider;
        f.service.saveProvider({ ...config, voice: 'different-voice' });
      } else {
        f.repository.saveTranscript({
          ...f.transcript,
          revision: 1,
          segments: [{ ...f.segment, text: 'New description' }],
        });
        f.projects.refresh('analysis');
      }
      resolve({ bytes: Buffer.from('stale audio'), extension: 'mp3' });
      await vi.waitFor(() => expect(f.jobs.get(jobId)?.status).toBe('failed'));
      expect(importer).not.toHaveBeenCalled();
      expect(probe).not.toHaveBeenCalled();
      expect(f.service.takes(f.transcript.id)).toEqual([previous]);
      expect(
        readdirSync(f.repository.folderFor(f.source.projectId)! + '/assets'),
      ).not.toContain('voiceover');
    },
  );

  it('keeps credentials encrypted and absent from returned account and queued payloads', () => {
    const f = fixture();
    expect(JSON.stringify(f.service.providers())).not.toContain('secret-key');
    expect(f.provider.hasCredentials).toBe(true);
    const stored = f.database.connection
      .prepare(
        'SELECT config_json, credentials_ciphertext FROM tts_accounts WHERE id = ?',
      )
      .get(f.provider.id) as {
      config_json: string;
      credentials_ciphertext: Buffer;
    };
    expect(stored.config_json).not.toContain('secret-key');
    expect(stored.credentials_ciphertext.toString()).toBe(
      'encrypted:secret-key',
    );
    const { hasCredentials: _hasCredentials, ...config } = f.provider;
    f.service.saveProvider({ ...config, label: 'Renamed', credentials: '' });
    const retained = f.database.connection
      .prepare('SELECT credentials_ciphertext FROM tts_accounts WHERE id = ?')
      .get(f.provider.id) as { credentials_ciphertext: Buffer };
    expect(retained.credentials_ciphertext).toEqual(
      stored.credentials_ciphertext,
    );
    f.service.generate(f.request);
    expect(
      JSON.stringify(
        f.database.connection.prepare('SELECT payload_json FROM jobs').all(),
      ),
    ).not.toContain('secret-key');
  });

  it('requires credential re-entry when changing endpoint or provider kind', () => {
    const f = fixture();
    const { hasCredentials: _hasCredentials, ...config } = f.provider;
    expect(() =>
      f.service.saveProvider({
        ...config,
        endpoint: 'https://other.example/speech',
      }),
    ).toThrow(/credentials again/);
    expect(() =>
      f.service.saveProvider({ ...config, kind: 'lemonfox' }),
    ).toThrow(/credentials again/);
    expect(f.service.providers()[0]!.endpoint).toBe(config.endpoint);
  });

  it('rejects stale requests and duplicate row generation, then cancels queued speech on close', () => {
    const f = fixture();
    expect(() =>
      f.service.generate({ ...f.request, expectedRevision: 1 }),
    ).toThrow(/Narration changed/);
    const { jobId } = f.service.generate(f.request);
    expect(() => f.service.generate(f.request)).toThrow(/already queued/);
    f.projects.close();
    expect(f.jobs.list().find((j) => j.id === jobId)!.status).toBe('cancelled');
  });

  it('maps 24 fps narration to trimmed 30 fps source placement and undoes one complete batch', () => {
    const f = fixture();
    f.addVideo();
    const take = f.addTake();
    f.service.place({ takeId: take.id, expectedRevision: 0 });
    const voice = f.projects
      .current()!
      .project.sequence.tracks.flatMap((t) => t.clips)
      .find((c) => c.type === 'audio')!;
    expect(voice.startFrame).toBe(130); // timeline 100 + source 60 - trimmed 30
    expect(voice.durationFrames).toBe(60);
    expect(voice.type === 'audio' && voice.assetId).toBe(take.assetId);
    f.projects.undo();
    expect(
      f.projects
        .current()!
        .project.sequence.tracks.flatMap((t) => t.clips)
        .some((c) => c.type === 'audio'),
    ).toBe(false);
  });

  it('blocks overflow and stale text before touching the timeline', () => {
    const f = fixture();
    f.addVideo();
    const before = f.projects.current()!.project.sequence;
    const overflow = f.addTake(5);
    expect(() =>
      f.service.place({ takeId: overflow.id, expectedRevision: 0 }),
    ).toThrow(/exceeds/);
    const stale = f.addTake(2, 'An old description.');
    expect(() =>
      f.service.place({ takeId: stale.id, expectedRevision: 0 }),
    ).toThrow(/outdated/);
    expect(f.projects.current()!.project.sequence).toEqual(before);
  });

  it('updates linked audio in one undoable batch and restores the earlier clip on undo', () => {
    const f = fixture();
    f.addVideo();
    const first = f.addTake();
    f.service.place({ takeId: first.id, expectedRevision: 0 });
    const initial = f.projects
      .current()!
      .project.sequence.tracks.flatMap((t) => t.clips)
      .find((c) => c.type === 'audio')!;
    const second = f.addTake();
    f.service.place({ takeId: second.id, expectedRevision: 0 });
    let audio = f.projects
      .current()!
      .project.sequence.tracks.flatMap((t) => t.clips)
      .filter((c) => c.type === 'audio');
    expect(audio).toHaveLength(1);
    expect(audio[0]!.type === 'audio' && audio[0]!.assetId).toBe(
      second.assetId,
    );
    f.projects.undo();
    audio = f.projects
      .current()!
      .project.sequence.tracks.flatMap((t) => t.clips)
      .filter((c) => c.type === 'audio');
    expect(audio).toEqual([initial]);
  });

  it('keeps row linkage after placing the same take twice and undoing', () => {
    const f = fixture();
    f.addVideo();
    const take = f.addTake();
    f.service.place({ takeId: take.id, expectedRevision: 0 });
    f.service.place({ takeId: take.id, expectedRevision: 0 });
    f.projects.undo();
    f.service.place({ takeId: take.id, expectedRevision: 0 });
    const audio = f.projects
      .current()!
      .project.sequence.tracks.flatMap((t) => t.clips)
      .filter((c) => c.type === 'audio');
    expect(audio).toHaveLength(1);
  });
});
