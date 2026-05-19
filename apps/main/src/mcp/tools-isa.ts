import { z } from "zod";
import { getIsaSection } from "@prospero/shared";
import type { ToolContext } from "./tools.js";
import { createGoalsRepository } from "../goals/repository.js";
import { createGoalCriteriaRepository } from "../goals/criteria-repository.js";
import { readIsa } from "../goals/isa-store.js";
import { checkOneCriterion, reevaluateGoalFromState } from "../verification/index.js";
import { buildVerificationDeps } from "../verification/deps.js";

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

// criterion_check — runs the deterministic check of ONE ISC and persists the
// result. The auto-check of the Algorithm's VERIFY phase: an agent calls this
// on its issue's criteria before marking the issue done. It does not transition
// the goal — the goal gate runs later, when all issues finish (M13 PR-B1).
const criterionCheck: Tool = {
  name: "criterion_check",
  description:
    "Run the deterministic check of one verifiable criterion (ISC) — a command, an artifact check, or a metric — and get whether it passed or failed. Use this to self-verify your work before marking an issue done. Only works on deterministic criteria; judgment criteria are decided with criterion_judge.",
  inputSchema: z.object({
    criterion_id: z.string().min(1).max(120),
  }),
  run: async (input, ctx) => {
    const { criterion_id } = criterionCheck.inputSchema.parse(input) as { criterion_id: string };
    const criterion = createGoalCriteriaRepository(ctx.db).getById(criterion_id);
    if (criterion === null) throw new Error(`criterion not found: ${criterion_id}`);
    const goal = createGoalsRepository(ctx.db).getById(criterion.goalId);
    if (goal === null || goal.companyId !== ctx.companyId) {
      throw new Error(`criterion not found: ${criterion_id}`);
    }
    const result = await checkOneCriterion(ctx.db, criterion_id, buildVerificationDeps());
    return JSON.stringify({
      criterionId: result.criterionId,
      status: result.status,
      detail: result.detail,
    });
  },
};

// criterion_judge — a reviewer agent decides a judgment ISC. Records the
// verdict with the agent as verifier, then re-evaluates the goal's gate
// (the goal may now be fully verified). The agent-facing analog of the
// user's criterion-judge action (M13 PR-B1).
const criterionJudge: Tool = {
  name: "criterion_judge",
  description:
    "Decide a judgment criterion (ISC) of a goal — pass, fail, or waive it. Use this when you have been asked to review a goal's judgment criteria. Records you as the verifier and re-checks whether the goal is fully verified.",
  inputSchema: z.object({
    criterion_id: z.string().min(1).max(120),
    verdict: z.enum(["passed", "failed", "waived"]),
  }),
  // eslint-disable-next-line @typescript-eslint/require-await
  run: async (input, ctx) => {
    const { criterion_id, verdict } = criterionJudge.inputSchema.parse(input) as {
      criterion_id: string;
      verdict: "passed" | "failed" | "waived";
    };
    const criteriaRepo = createGoalCriteriaRepository(ctx.db);
    const criterion = criteriaRepo.getById(criterion_id);
    if (criterion === null) throw new Error(`criterion not found: ${criterion_id}`);
    const goal = createGoalsRepository(ctx.db).getById(criterion.goalId);
    if (goal === null || goal.companyId !== ctx.companyId) {
      throw new Error(`criterion not found: ${criterion_id}`);
    }
    if (criterion.kind !== "judgment") {
      throw new Error(`criterion ${criterion_id} is not a judgment criterion`);
    }
    criteriaRepo.setJudgment(criterion_id, verdict, ctx.agentId);
    reevaluateGoalFromState(ctx.db, criterion.goalId);
    return JSON.stringify({ criterionId: criterion_id, verdict });
  },
};

export const isaToolDefinitions: Tool[] = [isaRead, criterionCheck, criterionJudge];
