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

// P4.2 — 3-options genesis. Signal scores 0-100 for each dimension; revenue12m
// is a human-readable range string (e.g. "R$ 2–6 mil/mês").
export type BusinessSignals = {
  market: number; // 0-100
  virality: number; // 0-100
  community: number; // 0-100
  revenue12m: string; // e.g. "R$ 2–6 mil/mês"
};

// Month-by-month revenue projection attached to a single option.
export type RevenueProjection = {
  month3: string; // e.g. "R$ 300–800"
  month6: string;
  month12: string;
  assumption: string; // single-sentence caveat
};

// One candidate business path proposed by the CEO in the 3-options genesis flow.
// Extends all single-plan fields (inline rather than extending to keep things
// self-contained) plus the option-specific metadata.
export type BusinessPlanOption = {
  // Core plan fields (mirror BusinessPlan flat columns)
  concept: string;
  monetization: string[];
  pricing: ChargeModel | null;
  research: BusinessResearch | null;
  ownerProfile: string | null;
  marketing: BusinessPlanMarketing;
  identity: BusinessPlanIdentity;
  dropped: DroppedIdea[];
  // Option-specific
  recommended: boolean;
  whyRecommended: string; // non-empty only when recommended === true
  signals: BusinessSignals;
  projection: RevenueProjection;
};

export type BusinessPlan = {
  id: string;
  companyId: string;
  proposedByAgentId: string;
  concept: string;
  monetization: string[];
  pricing: ChargeModel | null;
  research: BusinessResearch | null;
  ownerProfile: string | null;
  marketing: BusinessPlanMarketing;
  identity: BusinessPlanIdentity;
  dropped: DroppedIdea[];
  status: BusinessPlanStatus;
  userFeedback: string | null;
  proposedAt: number;
  decidedAt: number | null;
  // P4.2 — 3-options genesis. Null for plans created before this feature.
  // `options` is the full array proposed by the CEO; `chosenIndex` (0-based)
  // is set when the owner approves one of the options. The existing flat
  // columns above always reflect the chosen (or single) option.
  options: unknown[] | null;
  chosenIndex: number | null;
};
