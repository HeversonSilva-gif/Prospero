// Where a compaction's distilled digest is written (and from where it is
// re-injected on respawn).
//
// allowedProjects = [] means "ALL projects" (no restriction) — the CEO's normal
// scope (see packages/shared/src/types/agent.ts). A project-scoped *fold* only
// makes sense when the agent is bound to exactly one project (then the digest
// target is unambiguous). For an agent that can touch all projects (`[]`) or
// several (`[a, b]`), there is no single project to fold into, so we fold into
// an AGENT-scoped digest instead. That is what makes the CEO — the agent with
// the 98%-cache-read problem — actually compact AND get a durable digest back.
export type CompactionTarget =
  | { kind: "project"; projectId: string }
  | { kind: "agent"; agentId: string };

// exactly-one allowed project → that project's digest; otherwise ([] = all, or
// multi) → agent-scoped digest.
export const compactionTarget = (agent: {
  id: string;
  allowedProjects: string[];
}): CompactionTarget =>
  agent.allowedProjects.length === 1
    ? { kind: "project", projectId: agent.allowedProjects[0]! }
    : { kind: "agent", agentId: agent.id };
