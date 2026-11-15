import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clipSchema, newId } from '@kerf/model';
import { VISUAL_REVIEW_LIMITS } from '@kerf/tools';
import type { StoryboardResult, VisualRepairResult } from '@kerf/tools';
import { openDatabase } from '../db';
import { ProjectRepository, ProjectService } from '../projects';
import { ToolService } from './service';

const cleanups: (() => void)[] = [];
afterEach(() => cleanups.splice(0).forEach((fn) => fn()));
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'kerf-visual-review-'));
  const database = openDatabase({ filename: join(root, 'db.sqlite') });
  const repository = new ProjectRepository({
    database: database.connection,
    projectsRoot: join(root, 'projects'),
  });
  const projects = new ProjectService({ repository });
  projects.create({ name: 'Inspect', width: 640, height: 360 });
  const path = join(root, 'frame.png');
  writeFileSync(path, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  let clock = 100;
  let available = true;
  const render = vi.fn(
    async (input: {
      frame: number;
      maxWidth?: number;
      signal?: AbortSignal;
    }) => ({
      frame: input.frame,
      width: input.maxWidth ?? 640,
      height: 360,
      mimeType: 'image/png' as const,
      path,
    }),
  );
  const tools = new ToolService({
    projects,
    repository,
    now: () => clock,
    renderer: () =>
      available
        ? {
            renderFrame: render,
            previewComposition: async () => ({
              valid: true,
              sceneTree: null,
              error: null,
            }),
          }
        : null,
    exports: {
      list: () => [],
      get: () => null,
      start: () => {
        throw new Error('unused');
      },
      cancel: () => false,
    },
  });
  const first = (await tools.call('insertText', {
    text: 'A caption',
    durationFrames: 120,
    style: { color: '#ffffff', fontSize: 32 },
  })) as { clipId: string };
  const second = (await tools.call('insertText', {
    text: 'Next',
    startFrame: 120,
    durationFrames: 120,
  })) as { clipId: string };
  await tools.call('editClip', {
    clipId: first.clipId,
    patch: {
      transform: {
        x: 0,
        y: 0,
        scale: 1.2,
        rotation: 0,
        opacity: 0.8,
        anchorX: 0.5,
        anchorY: 0.5,
      },
    },
  });
  cleanups.push(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });
  const inspect = (frames = [0, 60]) =>
    tools.call('renderStoryboard', {
      frames,
      maxWidth: 320,
    }) as Promise<StoryboardResult>;
  return {
    tools,
    projects,
    render,
    path,
    first,
    second,
    inspect,
    tick: (ms: number) => {
      clock += ms;
    },
    hide: () => {
      available = false;
    },
  };
}
const issue = (clipId: string, frame = 0) => ({
  clipId,
  frame,
  category: 'text-clipping',
  observation: 'Text touches the upper frame edge.',
  patch: { transform: { y: 10 }, style: { fontSize: 28 } },
});

describe('bounded visual refinement', () => {
  it('renders evidence, applies one atomic partial-property repair, rechecks once and undoes it', async () => {
    const f = await fixture();
    const before = f.projects.current()!.project.sequence;
    const initial = await f.inspect();
    expect(initial.status).toBe('ready');
    expect(
      initial.objects.find((object) => object.clipId === f.first.clipId),
    ).toMatchObject({
      transform: { scale: 1.2, opacity: 0.8 },
      style: { fontSize: 32, color: '#ffffff' },
    });
    expect(initial.frames.map((frame) => frame.frame)).toEqual([0, 60]);
    expect(initial.frames[0]?.clipIds).toContain(f.first.clipId);
    expect(f.projects.current()!.project.sequence).toEqual(before);
    const repair = (await f.tools.call('repairVisuals', {
      storyboardId: initial.storyboardId,
      findings: [issue(f.first.clipId)],
    })) as VisualRepairResult;
    expect(repair.status).toBe('repaired');
    const updated = f.projects
      .current()!
      .project.sequence.tracks.flatMap((t) => t.clips)
      .find((c) => c.id === f.first.clipId)!;
    expect(updated.transform).toMatchObject({
      y: 10,
      scale: 1.2,
      opacity: 0.8,
    });
    expect(updated.type === 'text' && updated.style).toMatchObject({
      fontSize: 28,
      color: '#ffffff',
    });
    await expect(
      f.tools.call('repairVisuals', {
        storyboardId: initial.storyboardId,
        findings: [issue(f.first.clipId)],
      }),
    ).rejects.toThrow('one repair');
    const recheck = (await f.tools.call('renderStoryboard', {
      recheckOf: initial.storyboardId,
    })) as StoryboardResult;
    expect(recheck.pass).toBe('recheck');
    expect(recheck.status).toBe('ready');
    expect(recheck.frames.map((frame) => frame.frame)).toEqual([0, 60]);
    expect(recheck.repairCommandId).toBe(repair.commandId);
    expect(f.render).toHaveBeenCalledTimes(4);
    await expect(
      f.tools.call('renderStoryboard', { recheckOf: initial.storyboardId }),
    ).rejects.toThrow('one recheck');
    f.projects.undo();
    expect(f.projects.current()!.project.sequence).toEqual(before);
  });
  it('samples boundaries and caption/overlay midpoints with a visible truncation flag', async () => {
    const f = await fixture();
    const result = (await f.tools.call('renderStoryboard', {
      clipIds: [f.first.clipId, f.second.clipId],
    })) as StoryboardResult;
    expect(result.frames.map((frame) => frame.frame)).toEqual([
      60, 180, 0, 119,
    ]);
    expect(result.samplingTruncated).toBe(true);
    expect(result.scope).toContain('audio');
  });
  it('rejects invented frame/object pairs, unsupported edits and stale evidence without mutation', async () => {
    const f = await fixture();
    const initial = await f.inspect();
    const before = f.projects.current()!.project.sequence;
    await expect(
      f.tools.call('repairVisuals', {
        storyboardId: initial.storyboardId,
        findings: [issue(f.second.clipId)],
      }),
    ).rejects.toThrow('exact frame');
    await expect(
      f.tools.call('repairVisuals', {
        storyboardId: initial.storyboardId,
        findings: [{ ...issue(f.first.clipId), frame: 1 }],
      }),
    ).rejects.toThrow('exact frame');
    await expect(
      f.tools.call('repairVisuals', {
        storyboardId: initial.storyboardId,
        findings: [
          { ...issue(f.first.clipId), patch: { text: 'Changed speech' } },
        ],
      }),
    ).rejects.toThrow();
    expect(f.projects.current()!.project.sequence).toEqual(before);
    await f.tools.call('editClip', {
      clipId: f.first.clipId,
      patch: { label: 'User edit' },
    });
    const changed = f.projects.current()!.project.sequence;
    await expect(
      f.tools.call('repairVisuals', {
        storyboardId: initial.storyboardId,
        findings: [issue(f.first.clipId)],
      }),
    ).rejects.toThrow('project changed');
    expect(f.projects.current()!.project.sequence).toEqual(changed);
  });
  it('closes no-op reviews and never commits part of a mixed no-op batch', async () => {
    const f = await fixture();
    const initial = await f.inspect([0, 120]);
    const before = f.projects.current()!.project.sequence;
    const result = (await f.tools.call('repairVisuals', {
      storyboardId: initial.storyboardId,
      findings: [
        issue(f.first.clipId),
        { ...issue(f.second.clipId, 120), patch: { transform: { y: 0 } } },
      ],
    })) as VisualRepairResult;
    expect(result.status).toBe('no-change');
    expect(f.projects.current()!.project.sequence).toEqual(before);
    await expect(
      f.tools.call('repairVisuals', {
        storyboardId: initial.storyboardId,
        findings: [issue(f.first.clipId)],
      }),
    ).rejects.toThrow('one repair');
  });
  it('supports inspection without repairs and bounds frames, width, lifetime and ownership', async () => {
    const f = await fixture();
    await expect(
      f.tools.call('renderStoryboard', { frames: [0], maxWidth: 961 }),
    ).rejects.toThrow();
    await expect(
      f.tools.call('renderStoryboard', { frames: [0, 1, 2, 3, 4] }),
    ).rejects.toThrow();
    await expect(f.inspect([9999])).rejects.toThrow('inside');
    const initial = await f.inspect();
    await expect(
      f.tools.call(
        'repairVisuals',
        { storyboardId: initial.storyboardId, findings: [] },
        'mcp',
      ),
    ).rejects.toThrow('tool session');
    const result = (await f.tools.call('repairVisuals', {
      storyboardId: initial.storyboardId,
      findings: [],
    })) as VisualRepairResult;
    expect(result.status).toBe('reviewed');
    const next = await f.inspect();
    f.tick(VISUAL_REVIEW_LIMITS.lifetimeMs + 1);
    await expect(
      f.tools.call('repairVisuals', {
        storyboardId: next.storyboardId,
        findings: [],
      }),
    ).rejects.toThrow('expired');
  });
  it('stops when rendering, image or time budgets are unavailable', async () => {
    const f = await fixture();
    writeFileSync(f.path, Buffer.alloc(VISUAL_REVIEW_LIMITS.imageBytes + 1));
    const tooLarge = await f.inspect();
    expect(tooLarge.status).toBe('partial');
    expect(tooLarge.frames).toEqual([]);
    expect(tooLarge.note).toContain('image budget');
    writeFileSync(f.path, Buffer.from('png'));
    f.render.mockImplementationOnce(async (input) => {
      f.tick(16_000);
      return {
        frame: input.frame,
        width: 320,
        height: 360,
        mimeType: 'image/png',
        path: f.path,
      };
    });
    const slow = await f.inspect();
    expect(slow.status).toBe('partial');
    expect(slow.note).toContain('budget');
    const initial = await f.inspect();
    f.hide();
    await expect(
      f.tools.call('repairVisuals', {
        storyboardId: initial.storyboardId,
        findings: [issue(f.first.clipId)],
      }),
    ).rejects.toThrow('renderer unavailable');
  });
  it('cancels in-flight rendering and releases the serialized tool queue', async () => {
    const f = await fixture();
    const controller = new AbortController();
    f.render.mockImplementationOnce(() => new Promise(() => undefined));
    const pending = f.tools.call(
      'renderStoryboard',
      { frames: [0] },
      'agent',
      undefined,
      { signal: controller.signal },
    );
    await vi.waitFor(() => expect(f.render).toHaveBeenCalledOnce());
    controller.abort(new Error('Stopped by user'));
    const result = (await pending) as StoryboardResult;
    expect(result.status).toBe('partial');
    expect(result.note).toContain('Stopped by user');
    expect(f.render.mock.calls[0]?.[0].signal?.aborted).toBe(true);
    await expect(f.tools.call('readTimeline', {})).resolves.toBeDefined();
    await expect(
      f.tools.call('repairVisuals', {
        storyboardId: result.storyboardId,
        findings: [issue(f.first.clipId)],
      }),
    ).rejects.toThrow('one repair');
  });
  it('does not overwrite properties controlled by keyframes', async () => {
    const f = await fixture();
    await f.tools.call('animateProperty', {
      clipId: f.first.clipId,
      property: 'y',
      keyframes: [
        { frame: 0, value: 0 },
        { frame: 60, value: 20 },
      ],
    });
    const initial = await f.inspect();
    expect(initial.objects[0]?.keyframeProperties).toContain('y');
    const before = f.projects.current()!.project.sequence;
    await expect(
      f.tools.call('repairVisuals', {
        storyboardId: initial.storyboardId,
        findings: [issue(f.first.clipId)],
      }),
    ).rejects.toThrow('animated');
    expect(f.projects.current()!.project.sequence).toEqual(before);
  });
  it('runs deterministic validation before any rendering', async () => {
    const f = await fixture();
    const track = f.projects
      .current()!
      .project.sequence.tracks.find((t) => t.kind === 'video')!;
    f.projects.apply({
      type: 'clip.insert',
      clip: clipSchema.parse({
        id: newId('clip'),
        trackId: track.id,
        type: 'video',
        assetId: newId('asset'),
        startFrame: 240,
        durationFrames: 24,
      }),
    });
    const result = await f.inspect([0]);
    expect(result.status).toBe('blocked');
    expect(result.structuralFindings).toContainEqual(
      expect.objectContaining({ code: 'missing-asset' }),
    );
    expect(f.render).not.toHaveBeenCalled();
  });
});
