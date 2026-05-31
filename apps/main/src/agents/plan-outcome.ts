// Pure decision shared by the org-plan and goal-plan critics: re-engage the CEO
// (`revise`) only when the critic flagged something AND a revision attempt
// remains; otherwise surface the proposal (`surface`). "surface" = create the
// card / make it visible.
export const decidePlanOutcome = (input: {
  flaggedCount: number;
  attempts: number;
  cap: number;
}): "surface" | "revise" =>
  input.flaggedCount > 0 && input.attempts < input.cap ? "revise" : "surface";
