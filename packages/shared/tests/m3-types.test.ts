import { describe, expect, it } from "vitest";
import { IPC, type Agent, type Message, type InboxItem, type ToolCallView } from "../src/index.js";

describe("m3 types and channels", () => {
  it("defines orchestrator IPC channels", () => {
    expect(IPC.AGENT_LIST).toBe("agent:list");
    expect(IPC.AGENT_SEND_MESSAGE).toBe("agent:send-message");
    expect(IPC.AGENT_KILL).toBe("agent:kill");
    expect(IPC.AGENT_EVENT).toBe("agent:event");
  });

  it("defines companies/messages channels", () => {
    expect(IPC.COMPANY_CREATE_DEMO).toBe("company:create-demo");
    expect(IPC.COMPANY_LIST).toBe("company:list");
    expect(IPC.MESSAGE_LIST).toBe("message:list");
  });

  it("Agent type carries minimum fields", () => {
    const a: Agent = {
      id: "agent_1",
      companyId: "co_1",
      name: "CEO",
      role: "Chief Executive Officer",
      systemPrompt: "...",
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
    };
    expect(a.status).toBe("idle");
  });

  it("Message structurally distinguishes user/agent/system", () => {
    const u: Message = {
      id: "m1",
      threadId: "t1",
      senderKind: "user",
      senderId: null,
      content: "hi",
      kind: "message",
      toolCalls: null,
      createdAt: 1,
    };
    expect(u.senderKind).toBe("user");
  });

  it("ToolCallView captures name, input, status", () => {
    const tc: ToolCallView = {
      id: "tc1",
      name: "create_issue",
      input: { title: "x" },
      status: "success",
      result: "ok",
    };
    expect(tc.status).toBe("success");
  });

  it("InboxItem structurally constructable", () => {
    const i: InboxItem = {
      id: "i1",
      companyId: "co_1",
      kind: "completed",
      actorId: null,
      title: "done",
      preview: null,
      payloadJson: null,
      requiresAction: false,
      approvalId: null,
      readAt: null,
      createdAt: 1,
    };
    expect(i.kind).toBe("completed");
  });
});
