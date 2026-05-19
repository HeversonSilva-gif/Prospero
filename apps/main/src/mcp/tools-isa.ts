import { z } from "zod";
import { getIsaSection } from "@prospero/shared";
import type { ToolContext } from "./tools.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { readIsa } from "../goals/isa-store.js";

type Tool = {
  name: string;
  description: string;
  inputSchema: z.AnyZodObject;
  run: (input: unknown, ctx: ToolContext) => Promise<string>;
};

// isa_read — lets an agent read the Ideal State Artifact of a goal. Read-only,
// so it is auto-allowed (no request_permission gate). Progressive disclosure:
// pass `section` to read just one section instead of the whole document.
const isaRead: Tool = {
  name: "isa_read",
  description:
    "Read the Ideal State Artifact (ISA) of a goal: its narrative sections plus the list of verifiable criteria (ISCs). Pass `section` (e.g. 'Vision') to read only one section.",
  inputSchema: z.object({
    goal_id: z.string().min(1).max(120),
    section: z.string().min(1).max(120).optional(),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { goal_id, section } = isaRead.inputSchema.parse(input) as {
      goal_id: string;
      section?: string;
    };
    const goal = createGoalsRepository(ctx.db).getById(goal_id);
    if (goal === null || goal.companyId !== ctx.companyId) {
      throw new Error(`goal not found: ${goal_id}`);
    }
    const body = readIsa(ctx.userDataDir, goal);
    if (section !== undefined) {
      const text = getIsaSection(body, section);
      if (text === null) throw new Error(`ISA section not found: ${section}`);
      return JSON.stringify({ goalId: goal.id, section, text });
    }
    const criteria = createGoalCriteriaRepository(ctx.db).listByGoal(goal.id);
    return JSON.stringify({ goalId: goal.id, title: goal.title, body, criteria });
  },
};

export const isaToolDefinitions: Tool[] = [isaRead];
