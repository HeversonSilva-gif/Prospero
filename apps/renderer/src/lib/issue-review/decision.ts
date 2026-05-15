import type { IssueStatus } from "@dashboard-agent/shared";

export type ReviewDecision = "approve" | "request_changes" | "reject";

export const statusForDecision = (decision: ReviewDecision): IssueStatus => {
  switch (decision) {
    case "approve":
      return "done";
    case "request_changes":
      return "doing";
    case "reject":
      return "cancelled";
  }
};

export const requiresComment = (decision: ReviewDecision): boolean => decision !== "approve";

export type ValidationResult = { ok: true } | { ok: false; reason: "comment_required" };

export const validateDecision = (decision: ReviewDecision, comment: string): ValidationResult => {
  if (requiresComment(decision) && comment.trim() === "") {
    return { ok: false, reason: "comment_required" };
  }
  return { ok: true };
};
