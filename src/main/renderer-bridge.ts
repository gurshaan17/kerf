import { randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { BrowserWindow } from 'electron';
import type {
  ToolCompositionPreviewRequest,
  ToolCompositionPreviewResult,
  ToolRenderFrameRequest,
  ToolRenderedFrame,
  ToolRendererBridge,
} from '@kerf/tools';
import {
  KERF_IPC,
  type RendererEditorContext,
  type RendererFrameResult,
  type RendererPreviewResult,
  type RendererRequest,
  type RendererResponse,
} from '../shared/contracts';

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

const FRAME_TIMEOUT_MS = 30_000;
const PREVIEW_TIMEOUT_MS = 12_000;
const EXPORT_TIMEOUT_MS = 30 * 60_000;

/**
 * Main-process side of the renderer request bridge. The renderer owns the
 * canvas, media elements and composition sandbox; main only asks for one
 * frame, a sandbox evaluation or a complete export pass.
 */
export class RendererBridge implements ToolRendererBridge {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly framesDir: string;
  private editor: RendererEditorContext = {
    playheadFrame: 0,
    selectedClipIds: [],
    selectedAssetId: null,
  };

  constructor(options: { readonly framesDir: string }) {
    this.framesDir = options.framesDir;
    mkdirSync(this.framesDir, { recursive: true });
    this.pruneFrames();
  }

  available(): boolean {
    const window = this.window();
    return Boolean(
      window &&
      !window.isDestroyed() &&
      !window.webContents.isDestroyed() &&
      !window.webContents.isLoading(),
    );
  }

  setEditorContext(context: RendererEditorContext): void {
    this.editor = {
      playheadFrame: Math.max(0, Math.round(context.playheadFrame)),
      selectedClipIds: [...context.selectedClipIds],
      selectedAssetId: context.selectedAssetId,
    };
  }

  editorContext(): RendererEditorContext {
    return this.editor;
  }

  respond(response: RendererResponse): void {
    const item = this.pending.get(response.id);
    if (!item) {
      return;
    }
    this.pending.delete(response.id);
    clearTimeout(item.timer);
    if (response.ok) {
      item.resolve(response.result);
    } else {
      item.reject(new Error(response.error));
    }
  }

  async renderFrame(
    request: ToolRenderFrameRequest,
  ): Promise<ToolRenderedFrame> {
    const result = await this.request(
      'render-frame',
      {
        frame: Math.max(0, Math.round(request.frame)),
        maxWidth: request.maxWidth ?? null,
      },
      FRAME_TIMEOUT_MS,
    );
    const frame = result as Partial<RendererFrameResult> | null;
    if (!frame || !(frame.bytes instanceof Uint8Array)) {
      throw new Error('The renderer did not return frame bytes.');
    }
    const path = join(this.framesDir, `frame-${randomUUID()}.png`);
    writeFileSync(path, Buffer.from(frame.bytes));
    this.pruneFrames();
    return {
      frame: Math.max(0, Math.round(request.frame)),
      width: frame.width ?? 0,
      height: frame.height ?? 0,
      mimeType: 'image/png',
      path,
    };
  }

  async previewComposition(
    request: ToolCompositionPreviewRequest,
  ): Promise<ToolCompositionPreviewResult> {
    const result = await this.request(
      'preview-composition',
      {
        source: request.source,
        frame: request.frame ?? 0,
      },
      PREVIEW_TIMEOUT_MS,
    );
    const preview = result as Partial<RendererPreviewResult> | null;
    if (!preview) {
      throw new Error('The renderer did not return a composition preview.');
    }
    return {
      valid: !preview.error && Boolean(preview.sceneTree),
      sceneTree:
        (preview.sceneTree as ToolCompositionPreviewResult['sceneTree']) ??
        null,
      error: preview.error ?? null,
    };
  }

  async renderExport(payload: unknown): Promise<void> {
    await this.request('render-export', payload, EXPORT_TIMEOUT_MS);
  }

  dispose(): void {
    for (const [id, item] of this.pending) {
      clearTimeout(item.timer);
      item.reject(new Error('The renderer bridge closed.'));
      this.pending.delete(id);
    }
  }

  private window(): BrowserWindow | null {
    return BrowserWindow.getAllWindows()[0] ?? null;
  }

  private request(
    kind: RendererRequest['kind'],
    payload: unknown,
    timeoutMs: number,
  ): Promise<unknown> {
    const window = this.window();
    if (!window || window.isDestroyed() || window.webContents.isDestroyed()) {
      return Promise.reject(new Error('The editor window is not available.'));
    }
    const id = `render_request_${randomUUID()}`;
    const request: RendererRequest = { id, kind, payload };
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new Error('The editor did not answer the render request in time.'),
        );
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      window.webContents.send(KERF_IPC.renderer.request, request);
    });
  }

  private pruneFrames(): void {
    try {
      const files = readdirSync(this.framesDir)
        .filter((name) => name.endsWith('.png'))
        .map((name) => {
          const path = join(this.framesDir, name);
          return { path, mtime: statSync(path).mtimeMs };
        })
        .sort((left, right) => right.mtime - left.mtime);
      for (const file of files.slice(40)) {
        unlinkSync(file.path);
      }
    } catch {
      // Cache cleanup is best effort.
    }
  }
}
