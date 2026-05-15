import type { Goal, GoalPlan } from "@prospero/shared";

const fmtReportsTo = (r: number | "CEO"): string => (r === "CEO" ? "CEO" : `#${r}`);

const fmtAssignee = (a: number | "CEO"): string => (a === "CEO" ? "CEO" : `#${a}`);

// Builds the [GOAL_EXECUTE_REQUEST] turn payload enqueued for the CEO when
// narrated execution starts. The CEO uses the listed MCP tools to instantiate
// the plan one step at a time.
export const formatGoalExecuteRequest = (goal: Goal, plan: GoalPlan): string => {
  const agentsLines = plan.agentsToHire
    .map(
      (a) =>
        `  #${a.index} ${a.name} (${a.roleTemplateId}, ${a.model}) — reportsTo: ${fmtReportsTo(a.reportsToIndex)}`,
    )
    .join("\n");

  const issuesLines = plan.issuesToCreate
    .map((i) => {
      const deps =
        i.dependsOnIndexes.length > 0
          ? ` — dependsOn: ${i.dependsOnIndexes.map((d) => `#${d}`).join(", ")}`
          : "";
      return `  #${i.index} [${i.priority}] ${i.title} — assignee: ${fmtAssignee(i.assigneeIndex)}${deps}`;
    })
    .join("\n");

  return `[GOAL_EXECUTE_REQUEST]
goalId=${goal.id}
planId=${plan.id}
mode=narrated

Execute your proposed plan v${plan.version} for "${goal.title}" by emitting MCP calls in sequence. Available tools for this loop:
- hire_agent_for_plan({ planIndex }) — instantiate plan.agentsToHire[N]
- create_issue_for_plan({ planIndex }) — instantiate plan.issuesToCreate[N]
- comment_on_issue({ issueId, comment }) — add narration to an issue you created
- finalize_goal_execution({ goalId, abort? }) — close the loop when done OR abort to roll back

Convention:
1. Hire agents in topological order (respect reportsToIndex chain).
2. Create issues in topological order (respect dependsOnIndexes).
3. After each create_issue_for_plan, optionally add a brief comment_on_issue explaining the rationale.
4. When ALL hires and issues are processed, call finalize_goal_execution({ goalId: "${goal.id}" }).
5. If you hit an unrecoverable error, call finalize_goal_execution({ goalId: "${goal.id}", abort: true }) to roll back.

Plan summary:
${plan.summary}

Agents to hire (${plan.agentsToHire.length}):
${agentsLines}

Issues to create (${plan.issuesToCreate.length}):
${issuesLines}
`;
};
