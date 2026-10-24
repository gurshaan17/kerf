import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import type { OpenDialogOptions } from 'electron';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import {
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  newId,
  type AssetKind,
} from '@kerf/model';
import { referencePacingTargets } from '@kerf/tools';
import type { AnalysisService } from '../analysis/service';
import type { AgentService } from '../agent/service';
import type { ExportService } from '../export';
import { buildOtioTimeline } from '../export/otio';
import type { JobQueue } from '../jobs';
import type { McpService } from '../mcp/service';
import type { MediaImportService } from '../media';
import type { ProjectRepository } from '../projects';
import type { ProjectService } from '../projects';
import type { RendererBridge } from '../renderer-bridge';
import type { ToolService } from '../tools/service';
import {
  KERF_IPC,
  type KerfEvent,
  type ReferenceLookRequest,
  type ReferenceLookResult,
  type ReferencePacingResult,
  type RendererEditorContext,
  type RendererResponse,
} from '../../shared/contracts';
import { suggestedExportName } from '../../shared/export-plan';

function exportFrameBytes(data: unknown): Uint8Array {
  const bytes =
    data instanceof Uint8Array
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : null;
  if (!bytes) {
    throw new Error('The exported frame data was not a byte buffer.');
  }
  return bytes;
}

const projectIdSchema = z.string().min(1);
const projectNameSchema = z.string().trim().min(1).max(120);
const importPathsSchema = z.array(z.string().min(1)).max(100);
const exportIdSchema = z.string().min(1);
const exportPresetSchema = z.string().min(1).optional();
const exportStartSchema = z.object({
  presetId: z.string().min(1).max(40),
  startFrame: z.number().int().nonnegative(),
  endFrame: z.number().int().nonnegative(),
  outputPath: z.string().min(1).nullable().optional(),
});
const exportFrameIndexSchema = z.number().int().nonnegative();
const analysisKindSchema = z.enum([
  'transcript',
  'scenes',
  'beats',
  'vision',
  'embeddings',
]);
const analysisRunSchema = z.object({
  assetId: z.string().min(1),
  kinds: z.array(analysisKindSchema).min(1).max(5),
});
const searchSchema = z.object({
  query: z.string().max(200),
  limit: z.number().int().min(1).max(100).optional(),
});
const providerKindSchema = z.enum([
  'openai',
  'anthropic',
  'google',
  'xai',
  'ollama',
  'openai-compatible',
]);
const providerSaveSchema = z.object({
  id: z.string().min(1).optional(),
  kind: providerKindSchema,
  label: z.string().trim().min(1).max(80),
  baseUrl: z.string().trim().max(500).nullable().optional(),
  model: z.string().trim().max(200).nullable().optional(),
  chatModel: z.string().trim().max(200).nullable().optional(),
  apiKey: z.string().max(1_000).nullable().optional(),
  clearKey: z.boolean().optional(),
  enabled: z.boolean().optional(),
  visionConsent: z.boolean().optional(),
  chatConsent: z.boolean().optional(),
});
const modelIdSchema = z.string().min(1).max(40);
const chatSendSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
});
const mcpSettingsSchema = z
  .object({
    enabled: z.boolean().optional(),
    autoStart: z.boolean().optional(),
    port: z.number().int().min(1_024).max(65_535).optional(),
  })
  .strict();
const referenceUseSchema = z
  .object({
    assetId: z.string().min(1),
    name: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
const referenceLookSchema = z
  .object({
    profileId: z.string().min(1).optional(),
    clipIds: z.array(z.string().min(1)).min(1).max(1_000).optional(),
    strength: z.number().min(0).max(1).optional(),
  })
  .strict();
const rendererResponseSchema = z.object({
  id: z.string().min(1),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().optional(),
});
const rendererEditorSchema = z.object({
  playheadFrame: z.number().int().nonnegative(),
  selectedClipIds: z.array(z.string().min(1)).max(1_000),
  selectedAssetId: z.string().min(1).nullable(),
});
const compositionSaveSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  source: z.string().min(1).max(60_000),
  width: z.number().int().min(16).max(16_384).optional(),
  height: z.number().int().min(16).max(16_384).optional(),
  durationFrames: z.number().int().positive().max(100_000).optional(),
});
const MEDIA_EXTENSIONS = [
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...IMAGE_EXTENSIONS,
];

export interface ProjectIpcOptions {
  readonly projects: ProjectService;
  readonly repository: ProjectRepository;
  readonly jobs: JobQueue;
  readonly imports: MediaImportService;
  readonly exports: ExportService;
  readonly analysis: AnalysisService;
  readonly agent: AgentService;
  readonly renderer: RendererBridge;
  readonly tools: ToolService;
  readonly mcp: McpService;
  readonly broadcast: (event: KerfEvent) => void;
}

function requireActiveProject(projects: ProjectService) {
  const active = projects.current();
  if (!active) {
    throw new Error('Open a project before working with footage.');
  }
  return active;
}

function extensionsForKind(kind: AssetKind): string[] {
  if (kind === 'video') {
    return [...VIDEO_EXTENSIONS];
  }
  if (kind === 'audio') {
    return [...AUDIO_EXTENSIONS];
  }
  if (kind === 'image') {
    return [...IMAGE_EXTENSIONS];
  }
  return [...MEDIA_EXTENSIONS];
}

export function registerProjectIpc(options: ProjectIpcOptions): () => void {
  const {
    projects,
    repository,
    jobs,
    imports,
    exports,
    analysis,
    agent,
    renderer,
    tools,
    mcp,
    broadcast,
  } = options;

  ipcMain.handle(KERF_IPC.projects.list, () => projects.list());
  ipcMain.handle(KERF_IPC.projects.active, () => projects.current());
  ipcMain.handle(KERF_IPC.projects.create, (_event, name: unknown) =>
    projects.create({ name: projectNameSchema.parse(name) }),
  );
  ipcMain.handle(KERF_IPC.projects.open, async (_event, id: unknown) => {
    const projectId = projectIdSchema.parse(id);
    const snapshot = projects.open(projectId);
    await imports.refreshAvailability(projectId);
    analysis.reindexActive();
    return projects.current() ?? snapshot;
  });
  ipcMain.handle(KERF_IPC.projects.close, () => {
    projects.close();
  });
  ipcMain.handle(
    KERF_IPC.projects.rename,
    (_event, id: unknown, name: unknown) =>
      projects.rename(projectIdSchema.parse(id), projectNameSchema.parse(name)),
  );
  ipcMain.handle(
    KERF_IPC.projects.delete,
    (_event, id: unknown, removeFolder: unknown) =>
      projects.delete(
        projectIdSchema.parse(id),
        removeFolder === undefined ? true : z.boolean().parse(removeFolder),
      ),
  );
  ipcMain.handle(KERF_IPC.projects.reveal, (_event, id: unknown) => {
    const folder = repository.folderFor(projectIdSchema.parse(id));
    if (!folder) {
      throw new Error('Project folder was not found.');
    }
    shell.showItemInFolder(folder);
  });

  ipcMain.handle(KERF_IPC.assets.list, () => {
    return projects.current()?.assets ?? [];
  });
  ipcMain.handle(KERF_IPC.assets.import, (_event, paths: unknown) => {
    const active = requireActiveProject(projects);
    return imports.importFiles(
      active.project.id,
      importPathsSchema.parse(paths),
    );
  });
  ipcMain.handle(KERF_IPC.assets.pick, async () => {
    const active = requireActiveProject(projects);
    const options: OpenDialogOptions = {
      title: 'Import footage',
      buttonLabel: 'Import',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Footage', extensions: [...MEDIA_EXTENSIONS] },
        { name: 'All files', extensions: ['*'] },
      ],
    };
    const window = BrowserWindow.getFocusedWindow();
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }
    return imports.importFiles(active.project.id, result.filePaths);
  });
  ipcMain.handle(KERF_IPC.assets.refresh, () => {
    const active = requireActiveProject(projects);
    return imports.refreshAvailability(active.project.id);
  });
  ipcMain.handle(
    KERF_IPC.assets.relink,
    async (_event, id: unknown, path: unknown) => {
      const active = requireActiveProject(projects);
      const asset = repository.findAsset(projectIdSchema.parse(id));
      if (!asset || asset.projectId !== active.project.id) {
        throw new Error('The asset is not part of the open project.');
      }

      let sourcePath: string;
      if (path === undefined || path === null) {
        const options: OpenDialogOptions = {
          title: `Relink ${asset.name}`,
          buttonLabel: 'Relink',
          defaultPath: dirname(asset.sourcePath),
          properties: ['openFile'],
          filters: [
            {
              name: `${asset.kind} files`,
              extensions: extensionsForKind(asset.kind),
            },
            { name: 'All files', extensions: ['*'] },
          ],
        };
        const window = BrowserWindow.getFocusedWindow();
        const result = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options);
        if (result.canceled || result.filePaths.length === 0) {
          return null;
        }
        sourcePath = result.filePaths[0]!;
      } else {
        sourcePath = z.string().min(1).parse(path);
      }

      return imports.relink(asset.id, sourcePath);
    },
  );

  ipcMain.handle(KERF_IPC.analysis.run, (_event, request: unknown) =>
    analysis.run(analysisRunSchema.parse(request)),
  );
  ipcMain.handle(KERF_IPC.analysis.status, () => analysis.status());
  ipcMain.handle(KERF_IPC.analysis.search, (_event, request: unknown) =>
    analysis.query(searchSchema.parse(request)),
  );
  ipcMain.handle(KERF_IPC.analysis.providers, () => analysis.listProviders());
  ipcMain.handle(KERF_IPC.analysis.saveProvider, (_event, request: unknown) =>
    analysis.saveProvider(providerSaveSchema.parse(request)),
  );
  ipcMain.handle(KERF_IPC.analysis.deleteProvider, (_event, id: unknown) =>
    analysis.deleteProvider(projectIdSchema.parse(id)),
  );
  ipcMain.handle(KERF_IPC.analysis.testProvider, (_event, id: unknown) =>
    analysis.testProvider(projectIdSchema.parse(id)),
  );
  ipcMain.handle(KERF_IPC.analysis.models, () => analysis.models());
  ipcMain.handle(KERF_IPC.analysis.downloadModel, (_event, id: unknown) =>
    analysis.downloadModel(modelIdSchema.parse(id)),
  );
  ipcMain.handle(KERF_IPC.analysis.deleteModel, (_event, id: unknown) =>
    analysis.deleteModel(modelIdSchema.parse(id)),
  );
  ipcMain.handle(KERF_IPC.motion.save, (_event, request: unknown) =>
    analysis.saveComposition(compositionSaveSchema.parse(request)),
  );
  ipcMain.handle(KERF_IPC.motion.delete, (_event, id: unknown) =>
    analysis.deleteComposition(projectIdSchema.parse(id)),
  );
  ipcMain.handle(KERF_IPC.references.use, async (_event, request: unknown) => {
    const parsed = referenceUseSchema.parse(request);
    requireActiveProject(projects);
    await tools.call('useReference', parsed, 'user');
    return requireActiveProject(projects);
  });
  ipcMain.handle(KERF_IPC.references.clear, () => {
    requireActiveProject(projects);
    projects.apply(
      { type: 'sequence.setReference', reference: null },
      { actor: 'user', label: 'Clear reference' },
    );
    return requireActiveProject(projects);
  });
  ipcMain.handle(
    KERF_IPC.references.applyLook,
    async (_event, request: unknown) => {
      const parsed = referenceLookSchema.parse(request) as ReferenceLookRequest;
      requireActiveProject(projects);
      return (await tools.call(
        'copyReferenceLook',
        { ...parsed, strength: parsed.strength ?? 1 },
        'user',
      )) as ReferenceLookResult;
    },
  );
  ipcMain.handle(KERF_IPC.references.applyPacing, () => {
    const active = requireActiveProject(projects);
    const profile = active.project.sequence.reference;
    if (!profile) {
      throw new Error('Assign a reference before placing pacing markers.');
    }
    const pacing = referencePacingTargets(
      profile,
      active.project.sequence,
    ) as ReferencePacingResult['pacing'];
    const existingFrames = new Set(
      active.project.sequence.markers.map((marker) => marker.frame),
    );
    const frames = pacing.suggestedCutFrames.filter(
      (frame) => !existingFrames.has(frame),
    );
    if (frames.length === 0) {
      return { added: 0, pacing } satisfies ReferencePacingResult;
    }
    projects.apply(
      {
        type: 'batch',
        label: 'Place reference pacing',
        commands: frames.map((frame) => ({
          type: 'marker.add',
          marker: {
            id: newId('marker'),
            frame,
            label: 'Reference pacing',
            kind: 'beat',
            color: '#c9a46a',
          },
        })),
      },
      { actor: 'user', label: 'Place reference pacing' },
    );
    return { added: frames.length, pacing } satisfies ReferencePacingResult;
  });
  ipcMain.handle(KERF_IPC.mcp.status, () => mcp.status());
  ipcMain.handle(KERF_IPC.mcp.update, (_event, settings: unknown) =>
    mcp.update(mcpSettingsSchema.parse(settings)),
  );
  ipcMain.handle(KERF_IPC.mcp.rotateToken, () => mcp.rotateToken());
  ipcMain.handle(KERF_IPC.chat.send, (_event, request: unknown) =>
    agent.start(chatSendSchema.parse(request)),
  );
  ipcMain.handle(KERF_IPC.chat.abort, () => agent.abort());
  ipcMain.handle(KERF_IPC.chat.provider, () =>
    analysis.providers.chatProviderSetting(),
  );
  ipcMain.handle(KERF_IPC.chat.setProvider, (_event, id: unknown) =>
    analysis.providers.setChatProvider(
      id === null ? null : projectIdSchema.parse(id),
    ),
  );
  ipcMain.handle(KERF_IPC.renderer.response, (_event, response: unknown) => {
    const parsed = rendererResponseSchema.parse(response) as RendererResponse;
    renderer.respond(
      parsed.ok
        ? { id: parsed.id, ok: true, result: parsed.result }
        : {
            id: parsed.id,
            ok: false,
            error: parsed.error ?? 'The renderer request failed.',
          },
    );
  });
  ipcMain.handle(KERF_IPC.renderer.editor, (_event, context: unknown) => {
    const parsed: RendererEditorContext = rendererEditorSchema.parse(context);
    renderer.setEditorContext(parsed);
    tools.setEditorContext(parsed);
  });

  ipcMain.handle(KERF_IPC.edits.apply, (_event, command: unknown) =>
    projects.apply(command),
  );
  ipcMain.handle(KERF_IPC.edits.undo, () => projects.undo());
  ipcMain.handle(KERF_IPC.edits.redo, () => projects.redo());
  ipcMain.handle(KERF_IPC.edits.history, () => projects.history());

  ipcMain.handle(KERF_IPC.jobs.list, (_event, projectId: unknown) =>
    jobs.list(
      projectId === undefined ? undefined : projectIdSchema.parse(projectId),
    ),
  );
  ipcMain.handle(KERF_IPC.jobs.cancel, (_event, id: unknown) =>
    jobs.cancel(projectIdSchema.parse(id)),
  );

  ipcMain.handle(
    KERF_IPC.export.pickPath,
    async (_event, presetId: unknown) => {
      requireActiveProject(projects);
      const parsedPreset = exportPresetSchema.parse(presetId);
      const options: Electron.SaveDialogOptions = {
        title: 'Export video',
        buttonLabel: 'Export',
        defaultPath: exports.suggestedPath(parsedPreset ?? 'sequence'),
        filters: [{ name: 'MP4 video', extensions: ['mp4'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      };
      const window = BrowserWindow.getFocusedWindow();
      const result = window
        ? await dialog.showSaveDialog(window, options)
        : await dialog.showSaveDialog(options);
      return result.canceled ? null : (result.filePath ?? null);
    },
  );
  ipcMain.handle(KERF_IPC.export.start, (_event, request: unknown) =>
    exports.start(exportStartSchema.parse(request)),
  );
  ipcMain.handle(
    KERF_IPC.export.writeFrame,
    async (_event, id: unknown, index: unknown, data: unknown) => {
      await exports.writeFrame(
        exportIdSchema.parse(id),
        exportFrameIndexSchema.parse(index),
        exportFrameBytes(data),
      );
    },
  );
  ipcMain.handle(
    KERF_IPC.export.writeFrames,
    async (_event, id: unknown, frames: unknown) => {
      if (!Array.isArray(frames)) {
        throw new Error('The exported frames were not a list.');
      }
      const parsed = frames.map((frame: unknown) => {
        if (!frame || typeof frame !== 'object') {
          throw new Error('An exported frame was not an object.');
        }
        const record = frame as {
          readonly index?: unknown;
          readonly data?: unknown;
        };
        return {
          index: exportFrameIndexSchema.parse(record.index),
          data: exportFrameBytes(record.data),
        };
      });
      await exports.writeFrames(exportIdSchema.parse(id), parsed);
    },
  );
  ipcMain.handle(KERF_IPC.export.finish, (_event, id: unknown) =>
    exports.finish(exportIdSchema.parse(id)),
  );
  ipcMain.handle(KERF_IPC.export.cancel, (_event, id: unknown) =>
    exports.cancel(exportIdSchema.parse(id)),
  );
  ipcMain.handle(KERF_IPC.export.list, (_event, projectId: unknown) =>
    exports.list(
      projectId === undefined || projectId === null
        ? undefined
        : projectIdSchema.parse(projectId),
    ),
  );
  ipcMain.handle(KERF_IPC.export.reveal, (_event, id: unknown) => {
    const record = exports.get(exportIdSchema.parse(id));
    if (!record) {
      throw new Error('The export record was not found.');
    }
    shell.showItemInFolder(record.outputPath);
  });
  ipcMain.handle(KERF_IPC.export.otio, async () => {
    const active = requireActiveProject(projects);
    const folder = repository.folderFor(active.project.id);
    if (!folder) {
      throw new Error('The project folder was not found.');
    }
    const defaultPath = join(
      folder,
      'exports',
      suggestedExportName(active.project.name, 'timeline').replace(
        /\.mp4$/i,
        '.otio',
      ),
    );
    const options: Electron.SaveDialogOptions = {
      title: 'Export timeline as OTIO',
      buttonLabel: 'Export OTIO',
      defaultPath,
      filters: [{ name: 'OpenTimelineIO', extensions: ['otio'] }],
      properties: ['createDirectory', 'showOverwriteConfirmation'],
    };
    const window = BrowserWindow.getFocusedWindow();
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return null;
    }
    const path = result.filePath.toLowerCase().endsWith('.otio')
      ? result.filePath
      : `${result.filePath}.otio`;
    writeFileSync(
      path,
      JSON.stringify(buildOtioTimeline(active.project, active.assets), null, 2),
      'utf8',
    );
    return { path };
  });

  const unsubscribe = projects.subscribe((event) => {
    broadcast(event);
  });

  return () => {
    unsubscribe();
    for (const channel of [
      ...Object.values(KERF_IPC.projects),
      ...Object.values(KERF_IPC.edits),
      ...Object.values(KERF_IPC.assets),
      ...Object.values(KERF_IPC.jobs),
      ...Object.values(KERF_IPC.export),
      ...Object.values(KERF_IPC.analysis),
      ...Object.values(KERF_IPC.motion),
      ...Object.values(KERF_IPC.mcp),
      ...Object.values(KERF_IPC.references),
      ...Object.values(KERF_IPC.chat),
      ...Object.values(KERF_IPC.renderer),
    ]) {
      ipcMain.removeHandler(channel);
    }
  };
}
