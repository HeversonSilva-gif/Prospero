export type AgentMode = "supervised" | "auto";
export type AgentStatus = "idle" | "thinking" | "working" | "waiting" | "error";

export type Agent = {
  id: string;
  companyId: string;
  name: string;
  role: string;
  systemPrompt: string;
  mode: AgentMode;
  alwaysOn: boolean;
  status: AgentStatus;
  claudeSessionId: string | null;
  currentAction: string | null;
};
