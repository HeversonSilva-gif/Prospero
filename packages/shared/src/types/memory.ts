// M11 procedural knowledge doc. The body lives on disk as a SKILL.md file
// (body_path); only the L0 description is injected into the system prompt.
export type SkillSource =
  | "agent_created"
  | "derived_from_issue"
  | "derived_from_recovery"
  | "user_authored";

export type Skill = {
  id: string;
  companyId: string;
  agentId: string | null; // null = company-shared
  name: string;
  bodyPath: string;
  description: string;
  version: number;
  appliesToRole: string | null;
  source: SkillSource;
  trust: number;
  useCount: number;
  lastUsed: number | null;
  promoted: boolean;
  createdAt: number;
  softDeleted: boolean;
};

// M11 declarative memory entry.
export type MemoryKind = "identity" | "rule" | "preference" | "retrospective";

export type Memory = {
  id: string;
  companyId: string;
  agentId: string | null; // null = company-wide
  appliesToRole: string | null;
  kind: MemoryKind;
  body: string;
  importance: number;
  trust: number;
  sourceEventId: string | null;
  pinned: boolean;
  createdAt: number;
  lastAccessed: number | null;
  accessCount: number;
  softDeleted: boolean;
};

// Pending auto-derivation suggestion. Never becomes a Skill without human review.
export type SkillCandidateTrigger = "issue_done" | "recovery";
export type SkillCandidateStatus = "pending" | "accepted" | "rejected";

export type SkillCandidate = {
  id: string;
  companyId: string;
  agentId: string;
  sourceEventId: string;
  trigger: SkillCandidateTrigger;
  proposedName: string;
  proposedDescription: string;
  proposedBody: string;
  proposedAppliesToRole: string | null;
  status: SkillCandidateStatus;
  reviewedBy: string | null;
  reviewedAt: number | null;
  rejectReason: string | null;
  createdAt: number;
};

// A single full-text match from session_search — one past message the agent
// participated in. Returned by the learning IPC + the session_search MCP tool.
export type SessionSearchHit = {
  messageId: string;
  content: string;
  createdAt: number;
  senderKind: string;
  senderId: string | null;
};
