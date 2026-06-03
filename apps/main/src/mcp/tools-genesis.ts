import { z } from "zod";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import {
  BusinessPlanOptionsPayloadSchema,
  type BusinessPlanOptionsPayload,
} from "../schemas/businessPlan.js";
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
    "Submit 2–3 business options for the owner to choose from. Pass an `options` array where each entry is the full business plan shape (concept, monetization, pricing, marketing, identity, research, dropped) extended with `recommended` (boolean — mark EXACTLY ONE true), `whyRecommended` (string), `signals` ({market, virality, community} each 0–100 integer + revenue12m string), and `projection` ({month3, month6, month12, assumption} strings). Only propose what your AI team can build, run, and maintain unaided (SaaS, writing, organization, automation). Validates, stores all options, and emits business_plan.proposed so the main process critiques feasibility and surfaces the proposal. Only the CEO calls this, during genesis.",
  inputSchema: z.object({ options: z.unknown() }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { options: rawOptions } = submitBusinessPlan.inputSchema.parse(input) as {
      options: unknown;
    };
    let optionsInput: unknown = rawOptions;
    if (typeof optionsInput === "string") {
      try {
        optionsInput = JSON.parse(optionsInput);
      } catch {
        throw new Error(
          "invalid_business_plan: options must be a JSON array (could not parse string)",
        );
      }
    }

    // Wrap bare array into the expected { options: [...] } shape
    const toValidate = Array.isArray(optionsInput) ? { options: optionsInput } : optionsInput;

    const parsed = BusinessPlanOptionsPayloadSchema.safeParse(toValidate);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      throw new Error(`invalid_business_plan: ${JSON.stringify(detail)}`);
    }
    const payload: BusinessPlanOptionsPayload = parsed.data;

    // Mirror the recommended option into the legacy flat columns for backward
    // compat with the critic + approve path. chosen_index stays null at propose time.
    const recommended = payload.options.find((o) => o.recommended)!;

    const repo = createBusinessPlansRepository(ctx.db);
    repo.supersedeActiveForCompany(ctx.companyId);
    const created = repo.insert({
      companyId: ctx.companyId,
      proposedByAgentId: ctx.agentId,
      // Legacy flat columns = recommended option
      concept: recommended.concept,
      monetization: recommended.monetization,
      ...(recommended.pricing !== undefined ? { pricing: recommended.pricing } : {}),
      ...(recommended.research !== undefined ? { research: recommended.research } : {}),
      ...(recommended.ownerProfile !== undefined ? { ownerProfile: recommended.ownerProfile } : {}),
      marketing: recommended.marketing,
      identity: recommended.identity,
      dropped: recommended.dropped,
      // Full options array persisted verbatim
      options: payload.options,
    });

    ctx.emit({ kind: "business_plan.proposed", payload: { businessPlanId: created.id } });
    return JSON.stringify({ businessPlanId: created.id });
  },
};

export const genesisToolDefinitions: Tool[] = [submitBusinessPlan];
