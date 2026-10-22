import { StudioShell } from '@kerf/ui';
import { FootageBin } from './FootageBin';
import { ProjectBrowserScreen } from './ProjectBrowserScreen';
import { useStudio } from './state/StudioProvider';

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
    <StudioShell
      projectName={project.name}
      sequenceLabel={sequenceLabel(
        sequence.width,
        sequence.height,
        sequence.frameRate.numerator,
        sequence.frameRate.denominator,
      )}
      assetCount={assets.length}
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
    />
  );
}
