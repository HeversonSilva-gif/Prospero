import type { IssueArtifact, IssueArtifactKind } from "@dashboard-agent/shared";

const DIFFABLE_KINDS: ReadonlySet<IssueArtifactKind> = new Set<IssueArtifactKind>([
  "output_text",
  "snapshot",
]);

/**
 * Picks the most recent artifact whose content is reviewable as text in the
 * diff viewer. Returns null when no candidate has a non-null `contentPreview`.
 *
 * Sort key: `createdAt` desc — repository already orders by createdAt+rowid
 * desc, but we re-sort defensively in case callers pass a hand-built slice.
 */
export const pickDiffArtifact = (artifacts: readonly IssueArtifact[]): IssueArtifact | null => {
  const candidates = artifacts
    .filter((a) => DIFFABLE_KINDS.has(a.kind) && a.contentPreview !== null)
    .slice()
    .sort((a, b) => b.createdAt - a.createdAt);
  return candidates[0] ?? null;
};
