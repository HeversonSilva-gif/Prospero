import type { AgentStatus } from "./agent.js";

export type ToolCallStatus = "pending" | "success" | "error";

export type ToolCallView = {
  id: string;
  name: string;
  input: unknown;
  status: ToolCallStatus;
  result: string | null;
};

export type SenderKind = "user" | "agent" | "system";

export type Message = {
  id: string;
  threadId: string;
  senderKind: SenderKind;
  senderId: string | null;
  content: string;
  toolCalls: ToolCallView[] | null;
  createdAt: number;
};

export type AgentEvent =
  | { kind: "session"; agentId: string; sessionId: string }
  | { kind: "status"; agentId: string; status: AgentStatus; currentAction: string | null }
  | { kind: "message-append"; agentId: string; message: Message }
  | { kind: "tool-call"; agentId: string; threadId: string; tool: ToolCallView }
  | {
      kind: "tool-result";
      agentId: string;
      threadId: string;
      toolCallId: string;
      result: string;
      error?: string;
    }
  | { kind: "error"; agentId: string; message: string };
