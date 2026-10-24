import { useEffect } from 'react';
import type { SceneTree } from '@kerf/motion';
import type {
  ExportStartResult,
  RendererRequest,
  RendererResponse,
} from '../../shared/contracts';
import {
  ExportCancelledError,
  renderExportFrames,
  renderSingleFrame,
} from '../export/render-export';
import { createCompositionSandbox } from '../motion/sandbox';
import { useStudioStoreApi } from '../state/StudioProvider';

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function compositionMap(
  trees: Readonly<Record<string, SceneTree>>,
): ReadonlyMap<string, SceneTree> {
  return new Map(Object.entries(trees));
}

interface RenderFramePayload {
  readonly frame: number;
  readonly maxWidth?: number | null;
}

interface PreviewPayload {
  readonly source: string;
  readonly frame?: number;
}

/**
 * The main process cannot draw. This component owns the renderer-side half of
 * the tool bridge and answers main's frame, composition and export requests
 * using the same compositor as the preview and export dialog.
 */
export function RendererRequestHost() {
  const store = useStudioStoreApi();

  useEffect(() => {
    const unsubscribe = window.kerf.renderer.subscribe((request) => {
      void (async () => {
        try {
          const result = await handleRequest(store, request);
          const response: RendererResponse = {
            id: request.id,
            ok: true,
            result,
          };
          await window.kerf.renderer.respond(response);
        } catch (cause) {
          const response: RendererResponse = {
            id: request.id,
            ok: false,
            error: errorMessage(cause),
          };
          await window.kerf.renderer.respond(response);
        }
      })();
    });
    return unsubscribe;
  }, [store]);

  useEffect(() => {
    let timer: number | null = null;
    const push = () => {
      if (timer !== null) {
        return;
      }
      timer = window.setTimeout(() => {
        timer = null;
        const state = store.getState();
        const selectedClip = state.snapshot?.project.sequence.tracks
          .flatMap((track) => track.clips)
          .find((clip) => clip.id === state.selection.clipIds[0]);
        void window.kerf.renderer.setEditorContext({
          playheadFrame: Math.max(0, Math.round(state.playhead)),
          selectedClipIds: [...state.selection.clipIds],
          selectedAssetId:
            selectedClip && 'assetId' in selectedClip
              ? selectedClip.assetId
              : null,
        });
      }, 100);
    };
    push();
    const unsubscribe = store.subscribe(push);
    return () => {
      unsubscribe();
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [store]);

  return null;
}

async function handleRequest(
  store: ReturnType<typeof useStudioStoreApi>,
  request: RendererRequest,
): Promise<unknown> {
  const state = store.getState();
  const snapshot = state.snapshot;
  if (!snapshot) {
    throw new Error('Open a project before the assistant can render.');
  }

  if (request.kind === 'render-frame') {
    const payload = request.payload as Partial<RenderFramePayload> | null;
    if (!payload || typeof payload.frame !== 'number') {
      throw new Error('The frame request did not include a frame.');
    }
    return renderSingleFrame({
      frame: Math.max(0, Math.round(payload.frame)),
      sequence: snapshot.project.sequence,
      assets: snapshot.assets,
      compositionTrees: compositionMap(state.compositionTrees),
      maxWidth:
        typeof payload.maxWidth === 'number' && payload.maxWidth > 0
          ? payload.maxWidth
          : undefined,
    });
  }

  if (request.kind === 'preview-composition') {
    const payload = request.payload as Partial<PreviewPayload> | null;
    if (!payload || typeof payload.source !== 'string') {
      throw new Error('The composition preview did not include source.');
    }
    const sandbox = await createCompositionSandbox();
    try {
      const sceneTree = await sandbox.evaluate(
        payload.source,
        Math.max(0, Math.round(payload.frame ?? 0)),
      );
      return { sceneTree, error: null };
    } catch (cause) {
      return { sceneTree: null, error: errorMessage(cause) };
    } finally {
      sandbox.dispose();
    }
  }

  if (request.kind === 'render-export') {
    const result = request.payload as ExportStartResult | null;
    if (!result?.export?.id) {
      throw new Error('The export request did not include an export record.');
    }
    if (result.export.projectId !== snapshot.project.id) {
      throw new Error('The export belongs to a different project.');
    }
    const isCancelled = () =>
      store
        .getState()
        .exports.some(
          (record) =>
            record.id === result.export.id && record.status === 'cancelled',
        );
    try {
      await renderExportFrames({
        result,
        sequence: snapshot.project.sequence,
        assets: snapshot.assets,
        compositionTrees: compositionMap(state.compositionTrees),
        writeFrames: (frames) =>
          window.kerf.export.writeFrames(result.export.id, frames),
        isCancelled,
      });
    } catch (cause) {
      if (cause instanceof ExportCancelledError) {
        return { cancelled: true };
      }
      throw cause;
    }
    const record = await window.kerf.export.finish(result.export.id);
    return { record };
  }

  throw new Error('The renderer does not know that request.');
}
