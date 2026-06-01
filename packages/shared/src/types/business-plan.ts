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

// P5.2 — the structured charge model decided já na gênese. The CEO proposes it
// inside the business plan; on approval the agents enact it in Stripe (one product
// + price per item, one payment link). `amount` is the smallest currency unit
// (cents); `interval` is present iff the item is recurring (a subscription).
export type ChargeItem = {
  name: string;
  description: string;
  amount: number;
  currency: string;
  // `| undefined` mirrors the Zod `.optional()` inference so the validated payload
  // is assignable to this type under exactOptionalPropertyTypes. Present iff recurring.
  interval?: "month" | "year" | undefined;
};

export type ChargeModel = {
  model: "one_time" | "subscription" | "combo";
  items: ChargeItem[];
  rationale: string; // why this model fits THIS business
};

// "Steal from Polsia" #2 — competitor research the CEO does on the web before proposing,
// so the plan is grounded in real rivals (not generic). `price` mirrors Zod .optional()
// (| undefined) for exactOptionalPropertyTypes.
export type Competitor = { name: string; what: string; price?: string | undefined };
export type BusinessResearch = { competitors: Competitor[]; differentiation: string };

export type BusinessPlan = {
  id: string;
  companyId: string;
  proposedByAgentId: string;
  concept: string;
  monetization: string[];
  pricing: ChargeModel | null;
  research: BusinessResearch | null;
  marketing: BusinessPlanMarketing;
  identity: BusinessPlanIdentity;
  dropped: DroppedIdea[];
  status: BusinessPlanStatus;
  userFeedback: string | null;
  proposedAt: number;
  decidedAt: number | null;
};
