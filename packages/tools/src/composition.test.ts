import { describe, expect, it } from 'vitest';
import type { Composition } from '@kerf/model';
import {
  createComposition,
  createProject,
  DEFAULT_COMPOSITION_SOURCE,
} from '@kerf/model';
import type { ToolContext, ToolSnapshot } from './types';
import { toolRegistry } from './index';

interface Harness {
  readonly context: ToolContext;
  snapshot(): ToolSnapshot;
}

function harness(): Harness {
  const project = createProject({ name: 'Composition test', now: 1_000 });
  let snapshot: ToolSnapshot = {
    project,
    assets: [],
    transcripts: [],
    scenes: [],
    beatMaps: [],
    referenceProfiles: [],
    compositions: [],
  };
  const saveComposition = async (request: {
    id?: string;
    name: string;
    source: string;
    width?: number;
    height?: number;
    durationFrames?: number;
  }): Promise<Composition> => {
    const existing = request.id
      ? snapshot.compositions.find(
          (composition) => composition.id === request.id,
        )
      : null;
    const saved = existing
      ? {
          ...existing,
          name: request.name,
          source: request.source,
          width: request.width ?? existing.width,
          height: request.height ?? existing.height,
          durationFrames: request.durationFrames ?? existing.durationFrames,
          updatedAt: 3_000,
        }
      : createComposition({
          projectId: snapshot.project.id,
          name: request.name,
          source: request.source,
          width: request.width,
          height: request.height,
          durationFrames: request.durationFrames,
          now: 2_000,
        });
    snapshot = {
      ...snapshot,
      compositions: existing
        ? snapshot.compositions.map((composition) =>
            composition.id === saved.id ? saved : composition,
          )
        : [...snapshot.compositions, saved],
    };
    return saved;
  };
  return {
    snapshot: () => snapshot,
    context: {
      snapshot: () => snapshot,
      editor: () => ({
        playheadFrame: 0,
        selectedClipIds: [],
        selectedAssetId: null,
      }),
      apply: () => {
        throw new Error('not used');
      },
      applyBatch: () => {
        throw new Error('not used');
      },
      search: () => ({ results: [], vectorSearch: false }),
      renderer: () => null,
      exports: () => ({
        list: () => [],
        get: () => null,
        presets: () => [],
        start: async () => {
          throw new Error('not used');
        },
        reveal: async () => undefined,
      }),
      saveComposition,
      now: () => 2_000,
    },
  };
}

async function call(
  value: Harness,
  name: string,
  input: unknown,
): Promise<Record<string, unknown>> {
  return (await toolRegistry.call(name, input, value.context)) as Record<
    string,
    unknown
  >;
}

const VALID_SOURCE = `({
  background: '#111315',
  nodes: [
    {
      type: 'text',
      x: 10,
      y: 10,
      text: 'Lower third',
      fontSize: 5,
      color: '#ece6dc'
    }
  ]
})`;

describe('composition tools', () => {
  it('authors a valid composition and saves it to the library', async () => {
    const test = harness();
    const result = (await call(test, 'authorComposition', {
      name: 'Lower third',
      source: VALID_SOURCE,
      width: 1920,
      height: 1080,
      durationFrames: 120,
    })) as {
      valid: boolean;
      composition: { id: string; name: string; source: string };
      sceneTree: { nodes: unknown[] };
    };
    expect(result.valid).toBe(true);
    expect(result.composition.name).toBe('Lower third');
    expect(result.composition.source).toBe(VALID_SOURCE);
    expect(result.sceneTree.nodes).toHaveLength(1);
    expect(test.snapshot().compositions).toHaveLength(1);
  });

  it('uses the default source when none is supplied', async () => {
    const test = harness();
    const result = (await call(test, 'authorComposition', {
      name: 'Default composition',
    })) as { valid: boolean; composition: { source: string } };
    expect(result.valid).toBe(true);
    expect(result.composition.source).toBe(DEFAULT_COMPOSITION_SOURCE);
  });

  it('returns policy issues and repair hints for invalid code', async () => {
    const test = harness();
    const result = (await call(test, 'authorComposition', {
      name: 'Bad composition',
      source: '({ nodes: [window] })',
    })) as {
      valid: boolean;
      composition: null;
      issues: Array<{ message: string; hint: string }>;
      repairHints: string[];
    };
    expect(result.valid).toBe(false);
    expect(result.composition).toBeNull();
    expect(result.issues[0]?.message).toContain('window');
    expect(result.repairHints[0]).toContain('DOM');
    expect(test.snapshot().compositions).toHaveLength(0);
  });

  it('revises a saved composition', async () => {
    const test = harness();
    const authored = (await call(test, 'authorComposition', {
      name: 'Title',
      source: VALID_SOURCE,
    })) as { composition: { id: string } };
    const revised = (await call(test, 'reviseComposition', {
      compositionId: authored.composition.id,
      name: 'Title revised',
      source: VALID_SOURCE.replace('Lower third', 'Revised title'),
    })) as {
      valid: boolean;
      composition: { name: string; source: string; updatedAt: number };
    };
    expect(revised.valid).toBe(true);
    expect(revised.composition.name).toBe('Title revised');
    expect(revised.composition.source).toContain('Revised title');
    expect(revised.composition.updatedAt).toBe(3_000);
  });

  it('previews saved and proposed compositions', async () => {
    const test = harness();
    const authored = (await call(test, 'authorComposition', {
      name: 'Preview me',
      source: VALID_SOURCE,
    })) as { composition: { id: string } };

    const preview = (await call(test, 'previewComposition', {
      compositionId: authored.composition.id,
      frame: 12,
    })) as { valid: boolean; sceneTree: { nodes: unknown[] } };
    expect(preview.valid).toBe(true);
    expect(preview.sceneTree.nodes).toHaveLength(1);

    const invalid = (await call(test, 'previewComposition', {
      source: '({ nodes: [document.body] })',
    })) as { valid: boolean; repairHints: string[] };
    expect(invalid.valid).toBe(false);
    expect(invalid.repairHints.length).toBeGreaterThan(0);
  });
});
