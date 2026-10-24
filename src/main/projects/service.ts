import type {
  Actor,
  Asset,
  EditCommandEnvelope,
  Project,
  Sequence,
} from '@kerf/model';
import {
  commandLabel,
  createCommandEnvelope,
  editCommandSchema,
  secondsToFrames,
} from '@kerf/model';
import { applyCommand, EditHistory } from '@kerf/engine';
import type { ApplyContext, HistoryState } from '@kerf/engine';
import type {
  EditResult,
  JobSummary,
  ProjectEvent,
  ProjectSnapshot,
  ProjectSummary,
} from '../../shared/contracts';
import type { CreateStoredProjectInput, ProjectRepository } from './repository';

export interface ApplyEditOptions {
  readonly actor?: Actor;
  readonly label?: string;
  readonly now?: number;
}

export interface ProjectServiceOptions {
  readonly repository: ProjectRepository;
  readonly now?: () => number;
  readonly jobs?: (projectId: string) => JobSummary[];
  readonly onEvent?: (event: ProjectEvent) => void;
}

interface ActiveProject {
  readonly project: Project;
  readonly assets: Asset[];
  readonly history: EditHistory;
}

function syncProject(
  project: Project,
  sequence: Sequence,
  now: number,
): Project {
  return {
    ...project,
    sequence,
    style: sequence.style,
    reference: sequence.reference,
    updatedAt: now,
  };
}

/**
 * Owns the open project and the only undo stack. Every mutation passes through
 * `applyCommand`, is appended to the SQLite edit log and written as a snapshot
 * before listeners see it.
 */
export class ProjectService {
  private readonly repository: ProjectRepository;
  private readonly now: () => number;
  private readonly jobs: (projectId: string) => JobSummary[];
  private readonly listeners = new Set<(event: ProjectEvent) => void>();
  private active: ActiveProject | null = null;

  constructor(options: ProjectServiceOptions) {
    this.repository = options.repository;
    this.now = options.now ?? Date.now;
    this.jobs = options.jobs ?? (() => []);
  }

  subscribe(listener: (event: ProjectEvent) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  list(): ProjectSummary[] {
    return this.repository.list();
  }

  create(input: CreateStoredProjectInput): ProjectSnapshot {
    const bundle = this.repository.create(input);
    this.active = {
      project: bundle.project,
      assets: bundle.assets,
      history: new EditHistory({ now: this.now }),
    };
    const snapshot = this.snapshot();
    this.emit({ type: 'project.opened', snapshot });
    return snapshot;
  }

  open(projectId: string): ProjectSnapshot {
    const bundle = this.repository.require(projectId);
    this.active = {
      project: bundle.project,
      assets: bundle.assets,
      history: new EditHistory({ now: this.now }),
    };
    const snapshot = this.snapshot();
    this.emit({ type: 'project.opened', snapshot });
    return snapshot;
  }

  close(): void {
    const projectId = this.active?.project.id;
    this.active = null;
    if (projectId) {
      this.emit({ type: 'project.closed', projectId });
    }
  }

  rename(projectId: string, name: string): ProjectSummary {
    const summary = this.repository.rename(projectId, name);
    if (this.active?.project.id === projectId) {
      const bundle = this.repository.require(projectId);
      this.active = {
        ...this.active,
        project: bundle.project,
        assets: bundle.assets,
      };
      this.emit({
        type: 'project.changed',
        snapshot: this.snapshot(),
        reason: 'metadata',
      });
    }
    return summary;
  }

  delete(projectId: string, removeFolder = true): boolean {
    if (this.active?.project.id === projectId) {
      this.close();
    }
    return this.repository.delete(projectId, { removeFolder });
  }

  isOpen(): boolean {
    return this.active !== null;
  }

  current(): ProjectSnapshot | null {
    return this.active ? this.snapshot() : null;
  }

  reloadAssets(assets?: Asset[]): ProjectSnapshot {
    const active = this.requireActive();
    const next = assets ?? this.repository.listAssets(active.project.id);
    this.active = { ...active, assets: next };
    const snapshot = this.snapshot();
    this.emit({ type: 'project.changed', snapshot, reason: 'assets' });
    return snapshot;
  }

  refresh(
    reason: 'analysis' | 'compositions' | 'assets' | 'metadata' = 'analysis',
  ): ProjectSnapshot {
    const active = this.requireActive();
    const bundle = this.repository.require(active.project.id);
    this.active = {
      ...active,
      project: bundle.project,
      assets: bundle.assets,
    };
    const snapshot = this.snapshot();
    this.emit({ type: 'project.changed', snapshot, reason });
    return snapshot;
  }

  apply(commandInput: unknown, options: ApplyEditOptions = {}): EditResult {
    const active = this.requireActive();
    const command = editCommandSchema.parse(commandInput);
    const now = options.now ?? this.now();
    const result = applyCommand(
      active.project.sequence,
      command,
      this.applyContext(active.assets, active.project.sequence),
    );
    const project = syncProject(active.project, result.sequence, now);
    const envelope = createCommandEnvelope({
      command,
      actor: options.actor ?? 'user',
      label: options.label,
      now,
    });

    this.repository.commitEdit(project, {
      id: envelope.id,
      commandId: command.type,
      actor: envelope.actor,
      label: envelope.label || commandLabel(command),
      command,
      inverse: result.inverse,
      createdAt: envelope.createdAt,
    });

    active.history.record(command, result.inverse, {
      label: envelope.label || commandLabel(command),
      actor: envelope.actor,
    });
    this.active = { ...active, project };

    const snapshot = this.snapshot();
    this.emit({ type: 'project.changed', snapshot, reason: 'edit' });
    return { snapshot, command: envelope, inverse: result.inverse };
  }

  undo(options: ApplyEditOptions = {}): EditResult | null {
    const active = this.requireActive();
    const move = active.history.undo(
      active.project.sequence,
      this.applyContext(active.assets, active.project.sequence),
    );
    if (!move) {
      return null;
    }

    const now = options.now ?? this.now();
    const project = syncProject(active.project, move.sequence, now);
    let envelope: EditCommandEnvelope | null = null;

    if (move.entry.inverse) {
      const label = `Undo ${move.entry.label}`;
      envelope = createCommandEnvelope({
        command: move.entry.inverse,
        actor: move.entry.actor,
        label,
        now,
      });
      this.repository.commitEdit(project, {
        id: envelope.id,
        commandId: move.entry.inverse.type,
        actor: envelope.actor,
        label,
        command: move.entry.inverse,
        inverse: move.entry.command,
        createdAt: envelope.createdAt,
      });
    }

    this.active = { ...active, project };
    const snapshot = this.snapshot();
    this.emit({ type: 'project.changed', snapshot, reason: 'undo' });
    return { snapshot, command: envelope, inverse: move.entry.command };
  }

  redo(options: ApplyEditOptions = {}): EditResult | null {
    const active = this.requireActive();
    const move = active.history.redo(
      active.project.sequence,
      this.applyContext(active.assets, active.project.sequence),
    );
    if (!move) {
      return null;
    }

    const now = options.now ?? this.now();
    const project = syncProject(active.project, move.sequence, now);
    const label = `Redo ${move.entry.label}`;
    const envelope = createCommandEnvelope({
      command: move.entry.command,
      actor: move.entry.actor,
      label,
      now,
    });
    this.repository.commitEdit(project, {
      id: envelope.id,
      commandId: move.entry.command.type,
      actor: envelope.actor,
      label,
      command: move.entry.command,
      inverse: move.entry.inverse,
      createdAt: envelope.createdAt,
    });

    this.active = { ...active, project };
    const snapshot = this.snapshot();
    this.emit({ type: 'project.changed', snapshot, reason: 'redo' });
    return { snapshot, command: envelope, inverse: move.entry.inverse };
  }

  history(): HistoryState {
    return this.requireActive().history.state;
  }

  private snapshot(): ProjectSnapshot {
    const active = this.requireActive();
    const summary = this.repository.getSummary(active.project.id);
    if (!summary) {
      throw new Error(`Project ${active.project.id} was not found.`);
    }
    return {
      summary,
      project: active.project,
      assets: active.assets,
      transcripts: this.repository.listTranscripts(active.project.id),
      scenes: this.repository.listScenes(active.project.id),
      beatMaps: this.repository.listBeatMaps(active.project.id),
      compositions: this.repository.listCompositions(active.project.id),
      jobs: this.jobs(active.project.id),
      history: active.history.state,
    };
  }

  private requireActive(): ActiveProject {
    if (!this.active) {
      throw new Error('No project is open.');
    }
    return this.active;
  }

  private applyContext(assets: Asset[], sequence: Sequence): ApplyContext {
    return {
      sourceDurationFrames: (assetId) => {
        const asset = assets.find((candidate) => candidate.id === assetId);
        if (!asset) {
          return undefined;
        }
        return secondsToFrames(asset.durationSeconds, sequence.frameRate);
      },
    };
  }

  private emit(event: ProjectEvent): void {
    for (const listener of this.listeners) {
      listener(event);
    }
  }
}
