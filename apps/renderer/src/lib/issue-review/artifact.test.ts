import { describe, expect, it } from "vitest";
import type { IssueArtifact, IssueArtifactKind } from "@dashboard-agent/shared";
import { pickDiffArtifact } from "./artifact.js";

const make = (
  overrides: Partial<IssueArtifact> & { kind: IssueArtifactKind; createdAt: number },
): IssueArtifact => ({
  id: `art_${overrides.createdAt}`,
  issueId: "i1",
  ref: "ref",
  contentPreview: "preview",
  createdBy: null,
  ...overrides,
});

describe("pickDiffArtifact", () => {
  it("returns null for empty list", () => {
    expect(pickDiffArtifact([])).toBeNull();
  });

  it("ignores file_path/commit_sha/pr_url even with content", () => {
    expect(
      pickDiffArtifact([
        make({ kind: "file_path", createdAt: 10 }),
        make({ kind: "commit_sha", createdAt: 20 }),
        make({ kind: "pr_url", createdAt: 30 }),
      ]),
    ).toBeNull();
  });

  it("ignores diffable kinds when contentPreview is null", () => {
    expect(
      pickDiffArtifact([make({ kind: "output_text", createdAt: 10, contentPreview: null })]),
    ).toBeNull();
  });

  it("picks the most recent diffable artifact", () => {
    const older = make({ kind: "output_text", createdAt: 100, contentPreview: "old" });
    const newer = make({ kind: "snapshot", createdAt: 200, contentPreview: "new" });
    expect(pickDiffArtifact([older, newer])?.id).toBe(newer.id);
    expect(pickDiffArtifact([newer, older])?.id).toBe(newer.id);
  });

  it("prefers diffable over non-diffable even when non-diffable is newer", () => {
    const diffable = make({ kind: "output_text", createdAt: 100 });
    const newerNonDiffable = make({ kind: "pr_url", createdAt: 200 });
    expect(pickDiffArtifact([diffable, newerNonDiffable])?.id).toBe(diffable.id);
  });
});
