import { useCallback, useEffect, useState } from 'react';
import { StudioShell } from '@kerf/ui';
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
      onOpenProject={() => void closeProject()}
    />
  );
}
