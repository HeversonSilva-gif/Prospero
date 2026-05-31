// P4.1 — the CEO's business-genesis proposal. Mirrors org-plan/goal-plan: a
// reviewable, status-tracked artifact. The plain TS shape lives here; the Zod
// payload for the submit_business_plan tool is in apps/main/src/schemas.

export type BusinessPlanStatus = "critiquing" | "proposed" | "approved" | "rejected" | "superseded";

export type DroppedIdea = { idea: string; reason: string };

export type BusinessPlanIdentity = {
  name: string; // brand name → becomes companies.name on approval
  voice: string; // brand voice/tone (channel-agnostic)
  proposedXHandle: string; // suggestion for the X account (channel-specific)
};

export type BusinessPlanMarketing = {
  initialChannel: "x"; // fixed for now (INV-1: just the first channel)
  tactics: string[]; // what we post on X
  laterChannels: string; // note about future channels
};

export type BusinessPlan = {
  id: string;
  companyId: string;
  proposedByAgentId: string;
  concept: string;
  monetization: string[];
  marketing: BusinessPlanMarketing;
  identity: BusinessPlanIdentity;
  dropped: DroppedIdea[];
  status: BusinessPlanStatus;
  userFeedback: string | null;
  proposedAt: number;
  decidedAt: number | null;
};
