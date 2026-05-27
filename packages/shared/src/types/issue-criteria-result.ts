// M13 / Peça #9 — per-issue criterion result for the renderer.
// Returned by the issues:list-criteria-results IPC.

export type IssueCriterionResultStatus = "pass" | "fail" | "pending";

export interface IssueCriterionResult {
  id: string;
  text: string;
  kind: "deterministic" | "judgment";
  status: IssueCriterionResultStatus;
}
