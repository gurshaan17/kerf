import { useCallback, useEffect, useState } from 'react';
import { StudioShell } from '@kerf/ui';
import { FootageBin } from './FootageBin';
import { ProjectBrowserScreen } from './ProjectBrowserScreen';
import type { ProjectSnapshot, ProjectSummary } from '../shared/contracts';

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function sequenceLabel(snapshot: ProjectSnapshot): string {
  const { sequence } = snapshot.project;
  const fps = sequence.frameRate.numerator / sequence.frameRate.denominator;
  return `${sequence.width} × ${sequence.height} · ${Number.isInteger(fps) ? fps : fps.toFixed(2)} fps`;
}

export default function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [active, setActive] = useState<ProjectSnapshot | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshProjects = useCallback(async () => {
    const list = await window.kerf.projects.list();
    setProjects(list);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [list, current] = await Promise.all([
          window.kerf.projects.list(),
          window.kerf.projects.active(),
        ]);
        if (!cancelled) {
          setProjects(list);
          setActive(current);
          setError(null);
        }
      } catch (cause) {
        if (!cancelled) {
          setError(errorMessage(cause));
        }
      } finally {
        if (!cancelled) {
          setBusy(false);
        }
      }
    };

    void load();
    const unsubscribe = window.kerf.events.subscribe((event) => {
      if (event.type === 'project.closed') {
        setActive((current) =>
          current?.project.id === event.projectId ? null : current,
        );
        void refreshProjects().catch((cause) => setError(errorMessage(cause)));
        return;
      }

      if (event.type === 'jobs.changed') {
        setActive((current) => {
          if (!current || current.project.id !== event.job.projectId) {
            return current;
          }
          const jobs = current.jobs.some((job) => job.id === event.job.id)
            ? current.jobs.map((job) =>
                job.id === event.job.id ? event.job : job,
              )
            : [...current.jobs, event.job];
          return { ...current, jobs };
        });
        return;
      }

      setActive(event.snapshot);
      setError(null);
      void refreshProjects().catch((cause) => setError(errorMessage(cause)));
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [refreshProjects]);

  useEffect(() => {
    document.title = active
      ? `${active.project.name} — Kerf`
      : 'Kerf — Local-first video editor';
  }, [active]);

  const createProject = async (name: string) => {
    setBusy(true);
    setError(null);
    try {
      const snapshot = await window.kerf.projects.create(name);
      setActive(snapshot);
      await refreshProjects();
    } catch (cause) {
      setError(errorMessage(cause));
      throw cause;
    } finally {
      setBusy(false);
    }
  };

  const openProject = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      const snapshot = await window.kerf.projects.open(id);
      setActive(snapshot);
      await refreshProjects();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const closeProject = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.kerf.projects.close();
      setActive(null);
      await refreshProjects();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const renameProject = async (id: string, name: string) => {
    setBusy(true);
    setError(null);
    try {
      await window.kerf.projects.rename(id, name);
      await refreshProjects();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const deleteProject = async (id: string) => {
    setBusy(true);
    setError(null);
    try {
      await window.kerf.projects.delete(id, true);
      setActive((current) => (current?.project.id === id ? null : current));
      await refreshProjects();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const revealProject = (id: string) => {
    void window.kerf.projects.reveal(id).catch((cause) => {
      setError(errorMessage(cause));
    });
  };

  const importFootage = async () => {
    setBusy(true);
    setError(null);
    try {
      const imported = await window.kerf.assets.pick();
      if (imported.length > 0) {
        setActive(await window.kerf.projects.active());
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const relinkAsset = async (assetId: string) => {
    setBusy(true);
    setError(null);
    try {
      const relinked = await window.kerf.assets.relink(assetId);
      if (relinked) {
        setActive(await window.kerf.projects.active());
      }
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const cancelJob = async (jobId: string) => {
    setError(null);
    try {
      await window.kerf.jobs.cancel(jobId);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const refreshAssets = async () => {
    setBusy(true);
    setError(null);
    try {
      await window.kerf.assets.refresh();
      setActive(await window.kerf.projects.active());
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  if (!active) {
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

  return (
    <StudioShell
      projectName={active.project.name}
      sequenceLabel={sequenceLabel(active)}
      assetCount={active.assets.length}
      leftPanel={
        <FootageBin
          assets={active.assets}
          jobs={active.jobs}
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
