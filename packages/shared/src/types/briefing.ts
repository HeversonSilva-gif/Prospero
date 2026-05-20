// M14 PR-C — Morning Briefing shape exposed via `briefing:get`. Read-model
// over existing tables (no new shape persisted); the headline is the only
// AI-generated piece, cached on the company row.

export interface BriefingItem {
  /** Unique key for React lists; usually the source row id (inbox/goal/etc). */
  id: string;
  /** Short human label — e.g. "Verification failed — Goal 'Launch'". */
  label: string;
  /** One-line detail (truncated to 200 chars by build.ts). */
  detail: string;
  /** Deep-link route in the app (e.g. /goals/<id>, /inbox). */
  route: string;
  /** Source agent name when known; null for non-agent items. */
  agentName: string | null;
}

export interface Briefing {
  /** AI-generated one-line manchete; falls back to deterministic text on failure. */
  headline: string;
  /** Pending approvals + verification reviews + trust promotion suggestions + agent errors. */
  needsYou: BriefingItem[];
  /** Goals that reached `achieved` since the cursor. */
  verified: BriefingItem[];
  /** verification_failed inbox + agent errors since the cursor. */
  failed: BriefingItem[];
  /** Issues/goals in progress right now. */
  inProgress: BriefingItem[];
  /** skill_candidate_pending inbox items since the cursor. */
  learned: BriefingItem[];
  /** Sum of cost_events.cost_cents_estimate since the cursor (USD cents). */
  costCents: number;
  /** When this briefing object was built. */
  generatedAt: number;
  /** Cursor — last time the user pressed "Mark as reviewed". null = first time. */
  reviewedAt: number | null;
}
