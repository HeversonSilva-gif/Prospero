export type IssueStatus = "backlog" | "todo" | "doing" | "review" | "done" | "cancelled";
export type IssuePriority = "low" | "medium" | "high" | "urgent";

export type Issue = {
  id: string;
  companyId: string;
  projectId: string | null;
  parentId: string | null;
  title: string;
  description: string | null;
  assigneeId: string | null;
  status: IssueStatus;
  priority: IssuePriority;
  identifier: string | null;
  issueNumber: number | null;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
};

export type IssueComment = {
  id: string;
  issueId: string;
  senderKind: "user" | "agent";
  senderId: string | null;
  content: string;
  createdAt: number;
};

export type IssueEventKind =
  | "created"
  | "status_changed"
  | "assignee_changed"
  | "priority_changed"
  | "reparented";

export type IssueEvent = {
  id: string;
  issueId: string;
  kind: IssueEventKind;
  actorKind: "user" | "agent" | "system";
  actorId: string | null;
  payloadJson: string;
  createdAt: number;
};

export type ToolCallRef = {
  toolName: string;
  input: Record<string, unknown>;
  createdAt: number;
};

export type IssueDetail = {
  issue: Issue;
  comments: IssueComment[];
  events: IssueEvent[];
  subtasks: Issue[];
  toolHistory: ToolCallRef[];
  assignee: { id: string; name: string; role: string } | null;
  project: { id: string; name: string; color: string } | null;
};

export type IssueArtifactKind = "file_path" | "commit_sha" | "pr_url" | "snapshot" | "output_text";

export type IssueArtifact = {
  id: string;
  issueId: string;
  kind: IssueArtifactKind;
  ref: string;
  contentPreview: string | null;
  createdBy: string | null;
  createdAt: number;
};
