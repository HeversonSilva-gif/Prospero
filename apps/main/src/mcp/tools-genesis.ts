import { z } from "zod";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { BusinessPlanPayloadSchema, type BusinessPlanPayload } from "../schemas/businessPlan.js";
import type { ToolContext } from "./tools.js";

type Tool = {
  name: string;
  description: string;
  inputSchema: z.AnyZodObject;
  run: (input: unknown, ctx: ToolContext) => Promise<string>;
};

const submitBusinessPlan: Tool = {
  name: "submit_business_plan",
  description:
    "Submit ONE proposed business — concept, how it makes money, the first marketing channel (X, text), and a brand identity (name, voice, proposed @handle). Only propose what your AI team can build, run, and maintain unaided (SaaS, writing, organization, automation); list what you dropped and why. Validates + stores it and emits business_plan.proposed so the main process critiques feasibility and surfaces the proposal. Only the CEO calls this, during genesis.",
  inputSchema: z.object({ plan: z.unknown() }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { plan: rawPlan } = submitBusinessPlan.inputSchema.parse(input) as { plan: unknown };
    let plan: unknown = rawPlan;
    if (typeof plan === "string") {
      try {
        plan = JSON.parse(plan);
      } catch {
        throw new Error(
          "invalid_business_plan: plan must be a JSON object (could not parse string)",
        );
      }
    }
    const parsed = BusinessPlanPayloadSchema.safeParse(plan);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      throw new Error(`invalid_business_plan: ${JSON.stringify(detail)}`);
    }
    const payload: BusinessPlanPayload = parsed.data;

    const repo = createBusinessPlansRepository(ctx.db);
    repo.supersedeActiveForCompany(ctx.companyId);
    const created = repo.insert({
      companyId: ctx.companyId,
      proposedByAgentId: ctx.agentId,
      concept: payload.concept,
      monetization: payload.monetization,
      ...(payload.pricing !== undefined ? { pricing: payload.pricing } : {}),
      marketing: payload.marketing,
      identity: payload.identity,
      dropped: payload.dropped,
    });

    ctx.emit({ kind: "business_plan.proposed", payload: { businessPlanId: created.id } });
    return JSON.stringify({ businessPlanId: created.id });
  },
};

export const genesisToolDefinitions: Tool[] = [submitBusinessPlan];
