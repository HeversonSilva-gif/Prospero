// P4.1 — Zod schema for the submit_business_plan MCP tool payload. Lives in
// apps/main (zod is a runtime dep we keep out of the preload sandbox). Plain TS
// shapes are in packages/shared/src/types/business-plan.ts.

import { z } from "zod";

// P5.2 — structured charge model (optional; the CEO fills it at genesis so the team
// can enact it in Stripe on approval). `amount` is in the smallest currency unit
// (cents); `interval` present iff the item is recurring.
export const ChargeItemSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().min(1).max(500),
  amount: z.number().int().positive().max(99_999_999),
  currency: z.string().length(3),
  interval: z.enum(["month", "year"]).optional(),
});

export const ChargeModelSchema = z.object({
  model: z.enum(["one_time", "subscription", "combo"]),
  items: z.array(ChargeItemSchema).min(1).max(8),
  rationale: z.string().min(1).max(1000),
});

export const CompetitorSchema = z.object({
  name: z.string().min(1).max(120),
  what: z.string().min(1).max(500),
  price: z.string().max(80).optional(),
});

export const ResearchSchema = z.object({
  competitors: z.array(CompetitorSchema).min(1).max(12),
  differentiation: z.string().min(1).max(1000),
});

export const BusinessPlanPayloadSchema = z.object({
  concept: z.string().min(20).max(2000),
  monetization: z.array(z.string().min(1).max(500)).min(1).max(8),
  pricing: ChargeModelSchema.optional(),
  research: ResearchSchema.optional(),
  ownerProfile: z.string().min(1).max(1500).optional(),
  marketing: z.object({
    initialChannel: z.literal("x"),
    tactics: z.array(z.string().min(1).max(300)).min(1).max(10),
    laterChannels: z.string().max(1000),
  }),
  identity: z.object({
    name: z.string().min(1).max(80),
    voice: z.string().min(1).max(500),
    proposedXHandle: z.string().min(1).max(40),
  }),
  dropped: z
    .array(z.object({ idea: z.string().min(1).max(300), reason: z.string().min(1).max(500) }))
    .max(10),
});

export type BusinessPlanPayload = z.infer<typeof BusinessPlanPayloadSchema>;

// P4.2 — 3-options schema for the Gênese redesign. The CEO now proposes 2-3 business
// options (exactly one recommended) instead of a single plan. Each option is the full
// single-plan shape extended with comparison signals and a 12-month revenue projection.

export const BusinessSignalSchema = z.object({
  market: z.number().int().min(0).max(100),
  virality: z.number().int().min(0).max(100),
  community: z.number().int().min(0).max(100),
  revenue12m: z.string().min(1),
});

export const RevenueProjectionSchema = z.object({
  month3: z.string().min(1).max(200),
  month6: z.string().min(1).max(200),
  month12: z.string().min(1).max(200),
  assumption: z.string().min(1).max(500),
});

export const BusinessPlanOptionSchema = BusinessPlanPayloadSchema.extend({
  recommended: z.boolean(),
  whyRecommended: z.string().min(1),
  signals: BusinessSignalSchema,
  projection: RevenueProjectionSchema,
});

export const BusinessPlanOptionsPayloadSchema = z
  .object({ options: z.array(BusinessPlanOptionSchema).min(2).max(3) })
  .refine((p) => p.options.filter((o) => o.recommended).length === 1, {
    message: "exactly one option must be recommended",
  });

export type BusinessSignals = z.infer<typeof BusinessSignalSchema>;
export type RevenueProjection = z.infer<typeof RevenueProjectionSchema>;
export type BusinessPlanOption = z.infer<typeof BusinessPlanOptionSchema>;
export type BusinessPlanOptionsPayload = z.infer<typeof BusinessPlanOptionsPayloadSchema>;
