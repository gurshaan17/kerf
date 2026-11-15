import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { createAgentToolSet, visualReviewActivity } from './service';
import type { ToolService } from '../tools/service';

type Adapter = {
  execute(
    input: unknown,
    options: {
      toolCallId: string;
      messages: unknown[];
      abortSignal?: AbortSignal;
    },
  ): Promise<unknown>;
  toModelOutput(input: { output: unknown }): unknown;
};
const options = { toolCallId: 'visual', messages: [] };

describe('agent visual refinement', () => {
  it('delivers actual storyboard bytes and enforces one repair/recheck per turn', async () => {
    const root = mkdtempSync(join(tmpdir(), 'kerf-agent-storyboard-'));
    const path = join(root, 'frame.png');
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    writeFileSync(path, bytes);
    const storyboard = {
      storyboardId: 'visual_fixture',
      projectId: 'project',
      revision: 'r1',
      frameRate: { numerator: 24, denominator: 1 },
      status: 'ready',
      pass: 'initial',
      frames: [
        {
          frame: 0,
          width: 640,
          height: 360,
          mimeType: 'image/png',
          path,
          clipIds: ['clp_abcdefghijkl'],
        },
      ],
      structuralFindings: [],
      findings: [],
      samplingTruncated: false,
      scope: 'Sampled frames only',
      note: 'Inspect delivered images',
    };
    const call = vi.fn<ToolService['call']>(async (name) =>
      name === 'renderStoryboard'
        ? storyboard
        : {
            storyboardId: storyboard.storyboardId,
            status: 'repaired',
            findings: [],
            recheckRequired: true,
          },
    );
    const tools = createAgentToolSet({ call }, { sourceImages: true });
    const render = tools['renderStoryboard'] as unknown as Adapter;
    const repair = tools['repairVisuals'] as unknown as Adapter;
    const edit = tools['editClip'] as unknown as Adapter;
    try {
      const initial = await render.execute({ frames: [0] }, options);
      const content = JSON.stringify(render.toModelOutput({ output: initial }));
      expect(content).toContain(bytes.toString('base64'));
      expect(content).toContain('deliveredFrames');
      expect(
        visualReviewActivity('renderStoryboard', initial)?.previews[0]?.dataUrl,
      ).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
      await repair.execute(
        { storyboardId: storyboard.storyboardId, findings: [] },
        options,
      );
      await expect(
        repair.execute(
          { storyboardId: storyboard.storyboardId, findings: [] },
          options,
        ),
      ).rejects.toThrow('one evidence-linked');
      await expect(edit.execute({}, options)).rejects.toThrow(
        'bounded visual review',
      );
      await expect(
        (tools['renderFrame'] as unknown as Adapter).execute(
          { frame: 0 },
          options,
        ),
      ).rejects.toThrow('bounded storyboard');
      await expect(
        (tools['readSourceFilmstrip'] as unknown as Adapter).execute(
          {},
          options,
        ),
      ).rejects.toThrow('bounded storyboard');
      await expect(render.execute({ frames: [0] }, options)).rejects.toThrow(
        'one initial',
      );
      await render.execute({ recheckOf: storyboard.storyboardId }, options);
      await expect(
        render.execute({ recheckOf: storyboard.storyboardId }, options),
      ).rejects.toThrow('one initial');
      expect(call).toHaveBeenCalledTimes(3);
      expect(call.mock.calls[0]?.[4]?.checkAccess).toBeTypeOf('function');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it('stops when provider image consent is missing or revoked', async () => {
    let consent = false;
    const call = vi.fn<ToolService['call']>(async () => ({
      status: 'ready',
      storyboardId: 'visual_fixture',
      frames: [],
    }));
    const tools = createAgentToolSet({ call }, { sourceImages: () => consent });
    const render = tools['renderStoryboard'] as unknown as Adapter;
    await expect(render.execute({ frames: [0] }, options)).rejects.toThrow(
      'vision consent',
    );
    expect(call).not.toHaveBeenCalled();
    consent = true;
    const output = await render.execute({ frames: [0] }, options);
    consent = false;
    expect(() => render.toModelOutput({ output })).toThrow(
      'Vision consent changed',
    );
    expect(() => call.mock.calls[0]?.[4]?.checkAccess?.()).toThrow('consent');
  });
});
