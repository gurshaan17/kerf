import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { StudioShell } from '@kerf/ui';
import { ChatPanel } from './chat/ChatPanel';
import { CommandPalette } from './commands/CommandPalette';
import { ShortcutsDialog } from './commands/ShortcutsDialog';
import { useGlobalShortcuts } from './commands/use-global-shortcuts';
import { FootageBin } from './FootageBin';
import { ProjectBrowserScreen } from './ProjectBrowserScreen';
import { useStudio } from './state/StudioProvider';
import { Timeline } from './timeline/Timeline';
import { Preview } from './preview/Preview';
import { Inspector } from './inspector/Inspector';
import { ExportDialog } from './export/ExportDialog';
import { AnalysisSettingsDialog } from './analysis/AnalysisSettingsDialog';
import { SearchDialog } from './search/SearchDialog';
import { MotionDialog } from './motion/MotionDialog';
import { ReferencesDialog } from './references/ReferencesDialog';
import { AboutDialog } from './AboutDialog';
import { createCompositionSandbox } from './motion/sandbox';
import { RendererRequestHost } from './tools/RendererRequestHost';
import type { AnalysisAssetStatus } from '../shared/contracts';

function sequenceLabel(
  width: number,
  height: number,
  numerator: number,
  denominator: number,
): string {
  const fps = numerator / denominator;
  return `${width} × ${height} · ${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps`;
}

export default function App() {
  const snapshot = useStudio((state) => state.snapshot);
  const projects = useStudio((state) => state.projects);
  const busy = useStudio((state) => state.busy);
  const error = useStudio((state) => state.error);

  const createProject = useStudio((state) => state.createProject);
  const openProject = useStudio((state) => state.openProject);
  const closeProject = useStudio((state) => state.closeProject);
  const renameProject = useStudio((state) => state.renameProject);
  const deleteProject = useStudio((state) => state.deleteProject);
  const revealProject = useStudio((state) => state.revealProject);
  const importFootage = useStudio((state) => state.importFootage);
  const relinkAsset = useStudio((state) => state.relinkAsset);
  const cancelJob = useStudio((state) => state.cancelJob);
  const refreshAssets = useStudio((state) => state.refreshAssets);
  const analyze = useStudio((state) => state.analyze);
  const toasts = useStudio((state) => state.toasts);
  const dismissToast = useStudio((state) => state.dismissToast);
  const exports = useStudio((state) => state.exports);
  const setCompositionTree = useStudio((state) => state.setCompositionTree);
  const clearCompositionTrees = useStudio(
    (state) => state.clearCompositionTrees,
  );

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [motionOpen, setMotionOpen] = useState(false);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const openExport = useCallback(() => {
    setPaletteOpen(false);
    setExportOpen(true);
  }, []);
  const openSearch = useCallback(() => {
    setPaletteOpen(false);
    setSearchOpen(true);
  }, []);
  const openAnalysis = useCallback(() => {
    setPaletteOpen(false);
    setAnalysisOpen(true);
  }, []);
  const openMotion = useCallback(() => {
    setPaletteOpen(false);
    setMotionOpen(true);
  }, []);
  const openReferences = useCallback(() => {
    setPaletteOpen(false);
    setReferencesOpen(true);
  }, []);
  const openAbout = useCallback(() => {
    setPaletteOpen(false);
    setAboutOpen(true);
  }, []);
  const showShortcutsFromPalette = useCallback(() => {
    setPaletteOpen(false);
    setShortcutsOpen(true);
  }, []);
  const compositionsRef = useRef(snapshot?.compositions ?? []);
  compositionsRef.current = snapshot?.compositions ?? [];
  const compositionSignature = useMemo(
    () =>
      (snapshot?.compositions ?? [])
        .map((composition) => `${composition.id}:${composition.updatedAt}`)
        .join('|'),
    [snapshot?.compositions],
  );

  useEffect(() => {
    const compositions = compositionsRef.current;
    clearCompositionTrees(compositions.map((composition) => composition.id));
    if (compositions.length === 0) {
      return;
    }
    let cancelled = false;
    let sandbox: ReturnType<typeof createCompositionSandbox> extends Promise<
      infer Sandbox
    >
      ? Sandbox
      : never;
    void createCompositionSandbox()
      .then(async (created) => {
        sandbox = created;
        if (cancelled) {
          created.dispose();
          return;
        }
        for (const composition of compositions) {
          if (cancelled) {
            return;
          }
          try {
            const tree = await created.evaluate(composition.source);
            if (!cancelled) {
              setCompositionTree(composition.id, tree);
            }
          } catch {
            // The editor shows the detailed policy/runtime error.
          }
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      sandbox?.dispose();
    };
  }, [compositionSignature, clearCompositionTrees, setCompositionTree]);

  useGlobalShortcuts({
    onOpenPalette: openPalette,
    onOpenShortcuts: openShortcuts,
    onOpenExport: openExport,
    onOpenSearch: openSearch,
    enabled:
      Boolean(snapshot) &&
      !paletteOpen &&
      !shortcutsOpen &&
      !exportOpen &&
      !searchOpen &&
      !analysisOpen &&
      !motionOpen &&
      !referencesOpen &&
      !aboutOpen,
  });

  const analysis: AnalysisAssetStatus[] = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    const { assets, scenes, transcripts, beatMaps } = snapshot;
    return assets.map((asset) => {
      const assetScenes = scenes.filter((scene) => scene.assetId === asset.id);
      return {
        assetId: asset.id,
        transcript: transcripts.some(
          (transcript) => transcript.assetId === asset.id,
        ),
        sceneCount: assetScenes.length,
        descriptions: assetScenes.filter(
          (scene) => scene.description !== null && scene.description.length > 0,
        ).length,
        beatMap: beatMaps.some((beatMap) => beatMap.assetId === asset.id),
        embeddings: false,
      };
    });
  }, [
    snapshot?.assets,
    snapshot?.scenes,
    snapshot?.transcripts,
    snapshot?.beatMaps,
  ]);

  if (!snapshot) {
    return (
      <>
        <ProjectBrowserScreen
          projects={projects}
          busy={busy}
          error={error}
          onCreate={createProject}
          onOpen={openProject}
          onRename={renameProject}
          onDelete={deleteProject}
          onReveal={revealProject}
          onOpenAbout={openAbout}
        />
        <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
      </>
    );
  }

  const { project, assets, jobs } = snapshot;
  const { sequence } = project;
  const exporting = exports.some(
    (record) => record.status === 'rendering' || record.status === 'encoding',
  );

  return (
    <>
      <RendererRequestHost />
      <StudioShell
        projectName={project.name}
        sequenceLabel={sequenceLabel(
          sequence.width,
          sequence.height,
          sequence.frameRate.numerator,
          sequence.frameRate.denominator,
        )}
        assetCount={assets.length}
        toasts={toasts}
        onDismissToast={dismissToast}
        stage={<Preview />}
        timeline={<Timeline />}
        inspector={<Inspector />}
        leftPanel={
          <FootageBin
            assets={assets}
            jobs={jobs}
            busy={busy}
            error={error}
            onImport={importFootage}
            onRelink={relinkAsset}
            onCancelJob={cancelJob}
            onRefresh={refreshAssets}
            analysis={analysis}
            onAnalyze={analyze}
            onOpenSearch={openSearch}
            onOpenAnalysis={openAnalysis}
            onOpenMotion={openMotion}
            onOpenReferences={openReferences}
            onOpenExport={openExport}
          />
        }
        chatPanel={
          <ChatPanel
            settingsOpen={analysisOpen}
            onOpenSettings={openAnalysis}
          />
        }
        onOpenProject={() => void closeProject()}
        onOpenSettings={openAnalysis}
        onShowShortcuts={openShortcuts}
        onExport={openExport}
        onOpenAbout={openAbout}
        exporting={exporting}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowShortcuts={showShortcutsFromPalette}
        onExport={openExport}
        onOpenSearch={openSearch}
        onOpenAnalysis={openAnalysis}
        onOpenMotion={openMotion}
        onOpenReferences={openReferences}
        onOpenAbout={openAbout}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <ExportDialog open={exportOpen} onOpenChange={setExportOpen} />
      <SearchDialog open={searchOpen} onOpenChange={setSearchOpen} />
      <AnalysisSettingsDialog
        open={analysisOpen}
        onOpenChange={setAnalysisOpen}
      />
      <MotionDialog open={motionOpen} onOpenChange={setMotionOpen} />
      <ReferencesDialog
        open={referencesOpen}
        onOpenChange={setReferencesOpen}
      />
      <AboutDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </>
  );
}
