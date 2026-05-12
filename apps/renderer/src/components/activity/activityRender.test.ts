import { describe, expect, it } from "vitest";
import type { ActivityEventRow } from "@dashboard-agent/shared";
import { renderDescription, type Lookups } from "./activityRender.js";

const baseRow = (over: Partial<ActivityEventRow>): ActivityEventRow => ({
  id: "evt_1",
  companyId: "co_1",
  actorKind: "user",
  actorId: null,
  action: "agent.hired",
  entityKind: "agent",
  entityId: "ag_1",
  agentId: "ag_1",
  payload: {},
  createdAt: 0,
  ...over,
});

const lookups: Lookups = {
  agentsById: new Map([
    ["ag_1", "BackendEng"],
    ["ag_2", "CEO"],
  ]),
  currentUserName: "You",
  systemName: "System",
};

const t = ((key: string, vars?: Record<string, unknown>) => {
  if (!vars) return key;
  return `${key}|${Object.entries(vars)
    .map(([k, v]) => `${k}=${String(v)}`)
    .join(",")}`;
}) as unknown as Parameters<typeof renderDescription>[1];

describe("renderDescription", () => {
  it("agent.hired by user with name in payload", () => {
    const out = renderDescription(
      baseRow({ payload: { name: "BackendEng", role: "BackendEng" } }),
      t,
      lookups,
    );
    expect(out).toContain("activity.action.agent.hired|");
    expect(out).toContain("actor=You");
    expect(out).toContain("name=BackendEng");
  });

  it("agent.model_changed by agent actor — uses agent name", () => {
    const out = renderDescription(
      baseRow({
        actorKind: "agent",
        actorId: "ag_2",
        action: "agent.model_changed",
        entityId: "ag_1",
        agentId: "ag_1",
        payload: { from: "claude-sonnet-4-6", to: "claude-opus-4-7" },
      }),
      t,
      lookups,
    );
    expect(out).toContain("actor=CEO");
    expect(out).toContain("target=BackendEng");
    expect(out).toContain("from=claude-sonnet-4-6");
    expect(out).toContain("to=claude-opus-4-7");
  });

  it("issue.created falls back to entityId when identifier missing", () => {
    const out = renderDescription(
      baseRow({
        action: "issue.created",
        entityKind: "issue",
        entityId: "iss_1",
        agentId: null,
        payload: { title: "Fix bug", assigneeAgentId: null },
      }),
      t,
      lookups,
    );
    expect(out).toContain("activity.action.issue.created");
    expect(out).toContain("target=iss_1");
    expect(out).toContain("title=Fix bug");
  });

  it("approval.requested includes toolName", () => {
    const out = renderDescription(
      baseRow({
        actorKind: "agent",
        actorId: "ag_1",
        action: "approval.requested",
        entityKind: "approval",
        entityId: "appr_1",
        payload: { kind: "tool", toolName: "Bash" },
      }),
      t,
      lookups,
    );
    expect(out).toContain("actor=BackendEng");
    expect(out).toContain("toolName=Bash");
  });

  it("unknown agent actor → (unknown)", () => {
    const out = renderDescription(
      baseRow({
        actorKind: "agent",
        actorId: "ag_404",
        action: "agent.terminated",
        payload: {},
      }),
      t,
      lookups,
    );
    expect(out).toContain("actor=(unknown)");
  });

  it("system actor uses systemName and resolves target agent", () => {
    const out = renderDescription(
      baseRow({
        actorKind: "system",
        actorId: null,
        action: "session.started",
        entityKind: "session",
        entityId: "sess_1",
        agentId: "ag_1",
        payload: {},
      }),
      t,
      lookups,
    );
    expect(out).toContain("actor=System");
    expect(out).toContain("target=sess_1");
  });
});
