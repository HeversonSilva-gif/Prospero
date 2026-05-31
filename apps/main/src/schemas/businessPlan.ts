// P4.1 — Zod schema for the submit_business_plan MCP tool payload. Lives in
// apps/main (zod is a runtime dep we keep out of the preload sandbox). Plain TS
// shapes are in packages/shared/src/types/business-plan.ts.

import { z } from "zod";

export const BusinessPlanPayloadSchema = z.object({
  concept: z.string().min(20).max(2000),
  monetization: z.array(z.string().min(1).max(500)).min(1).max(8),
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
