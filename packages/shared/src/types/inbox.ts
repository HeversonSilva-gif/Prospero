export type InboxKind = "approval" | "completed" | "suggestion" | "error" | "security_alert";

export type InboxItem = {
  id: string;
  companyId: string;
  kind: InboxKind;
  actorId: string | null;
  title: string;
  preview: string | null;
  requiresAction: boolean;
  readAt: number | null;
  createdAt: number;
};
