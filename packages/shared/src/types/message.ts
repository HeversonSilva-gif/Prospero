import type { AgentStatus } from "./agent.js";
import type { Attachment } from "./attachment.js";
import type { TrustTier } from "./trust.js";

export type ToolCallStatus = "pending" | "success" | "error";

export type ToolCallView = {
  id: string;
  name: string;
  input: unknown;
  status: ToolCallStatus;
  result: string | null;
};

export type SenderKind = "user" | "agent" | "system";

export type MessageKind = "message" | "proposal" | "question" | "confirmation" | "observation";

export type Message = {
  id: string;
  threadId: string;
  senderKind: SenderKind;
  senderId: string | null;
  content: string;
  kind: MessageKind;
  toolCalls: ToolCallView[] | null;
  createdAt: number;
  /**
   * Participants of the thread this message belongs to. Populated by
   * `messages.listByAgent`; absent when the message is broadcast individually
   * (e.g. via message-append events). Use to distinguish user-agent threads
   * (contains "user") from inter-agent delegation threads.
   */
  threadParticipants?: string[];
  attachments?: Attachment[];
};

export type AgentEvent =
  | { kind: "session-id-changed"; agentId: string; sessionId: string | null }
  | { kind: "status-changed"; agentId: string; status: AgentStatus; updatedAt: number }
  | { kind: "current-action-changed"; agentId: string; action: string | null }
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
  | { kind: "error"; agentId: string; message: string }
  | { kind: "roster-changed"; companyId: string }
  | { kind: "costs-new"; agentId: string; deltaTokens: number; deltaCents: number }
  | { kind: "rate-limited"; agentId: string; retryAfterSec: number | null; message: string }
  | { kind: "trust-tier-changed"; agentId: string; tier: TrustTier };
