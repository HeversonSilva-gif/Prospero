import { describe, expect, it, beforeEach } from "vitest";
import { useAgentsStore } from "./agents.js";
import type { Agent } from "@prospero/shared";

const sampleAgent = (overrides: Partial<Agent> = {}): Agent => ({
  id: "agent_1",
  companyId: "co_1",
  name: "CEO",
  role: "CEO",
  systemPrompt: "",
  mode: "supervised",
  alwaysOn: false,
  status: "idle",
  claudeSessionId: null,
  currentAction: null,
  allowedProjects: [],
  model: "claude-sonnet-4-6",
  capabilities: [],
  templateId: null,
  reportsTo: null,
  adapterName: "claude-oauth-local",
  pausedAt: null,
  terminatedAt: null,
  pauseReason: null,
  budgetTokensLimit: null,
  budgetUsdLimit: null,
  budgetPeriod: "daily",
  canHire: true,
  canAssign: true,
  trustTier: "novato",
  ...overrides,
});

describe("useAgentsStore delta handlers", () => {
  beforeEach(() => {
    useAgentsStore.setState({ agents: [sampleAgent()], loaded: true });
  });

  it("applyAgentStatus updates status without touching currentAction", () => {
    useAgentsStore.setState({ agents: [sampleAgent({ currentAction: "Reading a.ts" })] });
    useAgentsStore.getState().applyAgentStatus("agent_1", "working");
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.status).toBe("working");
    expect(a.currentAction).toBe("Reading a.ts");
  });

  it("applyCurrentAction updates only currentAction", () => {
    useAgentsStore.getState().applyCurrentAction("agent_1", "Reading config.json");
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.currentAction).toBe("Reading config.json");
    expect(a.status).toBe("idle");
  });

  it("applySessionId updates claudeSessionId", () => {
    useAgentsStore.getState().applySessionId("agent_1", "550e8400-e29b-41d4-a716-446655440000");
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.claudeSessionId).toBe("550e8400-e29b-41d4-a716-446655440000");
  });

  it("delta handlers are no-ops for unknown agentId", () => {
    useAgentsStore.getState().applyAgentStatus("agent_unknown", "working");
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.status).toBe("idle");
  });

  it("applyTrustTier updates trustTier without touching other fields", () => {
    useAgentsStore.setState({
      agents: [sampleAgent({ status: "working", currentAction: "Reading a.ts" })],
    });
    useAgentsStore.getState().applyTrustTier("agent_1", "confiavel");
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.trustTier).toBe("confiavel");
    expect(a.status).toBe("working");
    expect(a.currentAction).toBe("Reading a.ts");
  });

  it("applyTrustTier is a no-op for an unknown agentId", () => {
    useAgentsStore.getState().applyTrustTier("agent_unknown", "autonomo");
    const a = useAgentsStore.getState().agents[0]!;
    expect(a.trustTier).toBe("novato");
  });
});
