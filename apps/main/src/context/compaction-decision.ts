// Pure helpers for the compaction decision: what actions should follow a
// completed distill run. Extracted so unit tests can exercise the decision
// table without wiring up the full orchestrator.

/** Whether the session should be reset after a compaction attempt.
 *
 * A reset (clearSessionId + adapter.kill + seed) is only safe and meaningful
 * when the distill produced a valid digest — i.e. distillKind === "ok".
 * On a "discard" (model output unparseable / empty), we have NO new digest
 * to inject, so killing the session would throw away live context for nothing.
 */
export const shouldResetSession = (distillKind: "ok" | "discard"): boolean => distillKind === "ok";
