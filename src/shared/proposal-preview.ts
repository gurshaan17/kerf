import type { ProjectSnapshot } from './contracts';

export const PROPOSAL_PREVIEW_TTL_MS = 120_000;
export const PROPOSAL_PREVIEW_MAX_BYTES = 8 * 1024 * 1024;
export const PROPOSAL_PREVIEW_MAX_ASSETS = 40;

/** Jobs/progress do not change the media or sequence being auditioned. */
export function proposalPreviewRevision(snapshot: ProjectSnapshot): string {
  return JSON.stringify([
    snapshot.project,
    snapshot.assets,
    snapshot.transcripts,
    snapshot.scenes,
    snapshot.compositions,
  ]);
}
export interface ProposalPreview {
  readonly id: string;
  readonly projectId: string;
  readonly jobId: string;
  readonly changeIds: readonly string[];
  readonly revisionKey: string;
  readonly expiresAt: number;
  readonly startFrame: number;
  readonly snapshot: ProjectSnapshot;
}
