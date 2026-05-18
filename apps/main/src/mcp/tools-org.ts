import { z } from "zod";
import { createOrgPlansRepository } from "../agents/org-plans-repository.js";
import { createInboxRepository } from "../inbox/repository.js";
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
    "Submit a proposed organization design — roles (each with a full charter), agents, and the reporting hierarchy. Validates the payload (Zod + DAG + per-charter sanitizer), stores it, and files an org_proposed inbox item for the user to review and approve. Only the CEO should call this.",
  inputSchema: z.object({ plan: z.unknown() }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { plan } = submitOrgPlan.inputSchema.parse(input) as { plan: unknown };

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
    const prior = repo.getCurrentForCompany(ctx.companyId);
    if (prior !== null) repo.markSuperseded(prior.id);

    const orgPlan = repo.insert({
      companyId: ctx.companyId,
      proposedByAgentId: ctx.agentId,
      summary: payload.summary,
      roles: payload.roles,
      agents: payload.agents,
    });

    createInboxRepository(ctx.db).create({
      companyId: ctx.companyId,
      kind: "org_proposed",
      actorId: ctx.agentId,
      title: "Organization design proposed",
      preview: payload.summary.slice(0, 200),
      requiresAction: true,
      payloadJson: JSON.stringify({ orgPlanId: orgPlan.id }),
    });

    return JSON.stringify({ orgPlanId: orgPlan.id });
  },
};

export const orgToolDefinitions: Tool[] = [submitOrgPlan];
