import { useCallback, useState } from 'react';
import { StudioShell } from '@kerf/ui';
import { CommandPalette } from './commands/CommandPalette';
import { ShortcutsDialog } from './commands/ShortcutsDialog';
import { useGlobalShortcuts } from './commands/use-global-shortcuts';
import { FootageBin } from './FootageBin';
import { ProjectBrowserScreen } from './ProjectBrowserScreen';
import { useStudio } from './state/StudioProvider';
import { Timeline } from './timeline/Timeline';
import { Preview } from './preview/Preview';
import { Inspector } from './inspector/Inspector';

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
  const toasts = useStudio((state) => state.toasts);
  const dismissToast = useStudio((state) => state.dismissToast);

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const openPalette = useCallback(() => setPaletteOpen(true), []);
  const openShortcuts = useCallback(() => setShortcutsOpen(true), []);
  const showShortcutsFromPalette = useCallback(() => {
    setPaletteOpen(false);
    setShortcutsOpen(true);
  }, []);
  useGlobalShortcuts({
    onOpenPalette: openPalette,
    onOpenShortcuts: openShortcuts,
    enabled: Boolean(snapshot) && !paletteOpen && !shortcutsOpen,
  });

  if (!snapshot) {
    return (
      <ProjectBrowserScreen
        projects={projects}
        busy={busy}
        error={error}
        onCreate={createProject}
        onOpen={openProject}
        onRename={renameProject}
        onDelete={deleteProject}
        onReveal={revealProject}
      />
    );
  }

  const { project, assets, jobs } = snapshot;
  const { sequence } = project;

  return (
    <>
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
          />
        }
        onOpenProject={() => void closeProject()}
        onShowShortcuts={openShortcuts}
      />
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        onShowShortcuts={showShortcutsFromPalette}
      />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
    </>
  );
}
