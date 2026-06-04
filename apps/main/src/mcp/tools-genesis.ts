import { z } from "zod";
import { isCeoAgent } from "@prospero/shared";
import { createBusinessPlansRepository } from "../agents/business-plans-repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { sanitizeMemoryBody } from "../memory/sanitizer.js";
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
    "Submit 2–3 business options for the owner to choose from. Pass an `options` array where each entry is the full business plan shape (concept, monetization, pricing, marketing, identity, research, ownerProfile, dropped) extended with `recommended` (boolean — mark EXACTLY ONE true), `whyRecommended` (string), `signals` ({market, virality, community} each 0–100 integer + revenue12m string), and `projection` ({month3, month6, month12, assumption} strings). `ownerProfile` is REQUIRED and must reflect the owner interview. Only propose what your AI team can build, run, and maintain unaided (SaaS, writing, organization, automation). Validates, stores all options, and emits business_plan.proposed so the main process critiques feasibility and surfaces the proposal. Only the CEO calls this, during genesis — once a business is approved the company is live; pass `rebrand: true` only when the owner explicitly asked to re-brand the existing business.",
  inputSchema: z.object({ options: z.unknown(), rebrand: z.boolean().optional() }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { options: rawOptions, rebrand } = submitBusinessPlan.inputSchema.parse(input) as {
      options: unknown;
      rebrand?: boolean;
    };

    // C1 (audit 2026-06-04) — caller authorization. This tool renames the company
    // and rewrites its brand/TELOS/pricing; only the CEO may run genesis. Mirrors
    // the criterion_judge / ISA caller gate. The MCP server registers every tool
    // for every agent, so a worker holding the `delegation` capability could
    // otherwise forge a plan.
    const caller = createAgentsRepository(ctx.db).getById(ctx.agentId);
    if (caller === null || !isCeoAgent(caller)) {
      return JSON.stringify({
        ok: false,
        error: "only the CEO may submit a business plan",
      });
    }

    // C2 (audit 2026-06-04) — genesis-state validation. Once a business plan is
    // approved the company is live and operating; re-running genesis would
    // supersede + silently re-brand it. Refuse unless the owner explicitly asked
    // to re-brand (rebrand:true). 'critiquing'/'proposed' plans are the normal
    // revise loop and are still allowed.
    const repo = createBusinessPlansRepository(ctx.db);
    if (rebrand !== true && repo.getLatestApprovedForCompany(ctx.companyId) !== null) {
      return JSON.stringify({
        ok: false,
        error:
          "this company already has an approved business plan and is live — genesis cannot run again. To deliberately re-brand the existing business, resubmit with rebrand:true.",
      });
    }
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

    // I5 (audit 2026-06-04) — sanitize the CEO's free-text before it is persisted.
    // These fields land verbatim in `companies` and then flow (via
    // gatherBusinessContext) into charter-generation and charter-critic prompts,
    // so an injection in a brand voice / concept / owner profile would hijack
    // those downstream prompts. Mirrors how submit_org_plan sanitizes each charter.
    for (const [i, opt] of payload.options.entries()) {
      const fields: Array<[string, string]> = [
        ["identity.name", opt.identity.name],
        ["identity.voice", opt.identity.voice],
        ["concept", opt.concept],
        ["ownerProfile", opt.ownerProfile],
      ];
      for (const [field, value] of fields) {
        const check = sanitizeMemoryBody(value);
        if (!check.ok) {
          return JSON.stringify({
            ok: false,
            error: `option ${i + 1} ${field} rejected by sanitizer: ${check.reason}`,
          });
        }
      }
    }

    // Mirror the recommended option into the legacy flat columns for backward
    // compat with the critic + approve path. chosen_index stays null at propose time.
    const recommended = payload.options.find((o) => o.recommended)!;

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
