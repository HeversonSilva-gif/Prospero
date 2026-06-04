import { z } from "zod";
import { isCeoAgent } from "@prospero/shared";
import { createOrgPlansRepository } from "../agents/org-plans-repository.js";
import { createAgentsRepository } from "../agents/repository.js";
import { sanitizeMemoryBody } from "../memory/sanitizer.js";
import { OrgPlanPayloadSchema, type OrgPlanPayload } from "../schemas/orgPlan.js";
import type { ToolContext } from "./tools.js";

type Tool = {
  name: string;
  description: string;
  inputSchema: z.AnyZodObject;
  run: (input: unknown, ctx: ToolContext) => Promise<string>;
};

const submitOrgPlan: Tool = {
  name: "submit_org_plan",
  description:
    "Submit a proposed organization design — roles (each with a full charter), agents, and the reporting hierarchy. Validates the payload (Zod + DAG + per-charter sanitizer), stores it, and emits org.proposed so the main process critiques the charters and surfaces the proposal. Only the CEO should call this.",
  inputSchema: z.object({ plan: z.unknown() }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    // C1 (Genesis/Planning audit 2026-06-04): authorize the caller. The MCP
    // server registers this tool for every agent and only --allowedTools (the
    // `delegation` capability) gates it — and `delegation` is hireable via an
    // org plan that names it. Without this check any such agent could forge the
    // org design. Only the CEO of this company may propose it. Mirrors
    // tools-isa.ts criterion_judge and tools.ts callerIsCeo.
    const caller = createAgentsRepository(ctx.db).getById(ctx.agentId);
    if (caller === null || caller.companyId !== ctx.companyId || !isCeoAgent(caller)) {
      return JSON.stringify({ ok: false, error: "only the CEO may submit an org plan" });
    }

    const { plan: rawPlan } = submitOrgPlan.inputSchema.parse(input) as { plan: unknown };

    // The model frequently passes `plan` as a stringified JSON object rather than
    // a real object (seen live: "Expected object, received string"), which made
    // the CEO retry until it gave up and nothing was proposed. Accept both:
    // parse the string, then validate.
    let plan: unknown = rawPlan;
    if (typeof plan === "string") {
      try {
        plan = JSON.parse(plan);
      } catch {
        throw new Error("invalid_org_plan: plan must be a JSON object (could not parse string)");
      }
    }

    const parsed = OrgPlanPayloadSchema.safeParse(plan);
    if (!parsed.success) {
      const detail = parsed.error.issues.map((i) => ({
        path: i.path.join("."),
        message: i.message,
      }));
      throw new Error(`invalid_org_plan: ${JSON.stringify(detail)}`);
    }
    const payload: OrgPlanPayload = parsed.data;

    // Each charter is LLM output — sanitize before it is stored (spec §11).
    for (const role of payload.roles) {
      const check = sanitizeMemoryBody(role.charter);
      if (!check.ok) {
        throw new Error(`charter for role "${role.name}" rejected by sanitizer: ${check.reason}`);
      }
    }

    const repo = createOrgPlansRepository(ctx.db);
    repo.supersedeActiveForCompany(ctx.companyId);

    const orgPlan = repo.insert({
      companyId: ctx.companyId,
      proposedByAgentId: ctx.agentId,
      summary: payload.summary,
      roles: payload.roles,
      agents: payload.agents,
    });

    // MAIN critiques the charters off this event and creates the org_proposed card
    // only after the critic decides (deep enough → card; generic → feedback to CEO).
    ctx.emit({ kind: "org.proposed", payload: { orgPlanId: orgPlan.id } });

    return JSON.stringify({ orgPlanId: orgPlan.id });
  },
};

export const orgToolDefinitions: Tool[] = [submitOrgPlan];
