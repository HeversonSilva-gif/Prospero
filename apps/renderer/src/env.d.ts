/// <reference types="vite/client" />
import type {
  AppSettings,
  DetectResult,
  TokenSource,
  TokenStatus,
  Agent,
  AgentEvent,
  AgentStats,
  Company,
  Message,
  InboxItem,
  PermissionRequest,
  PermissionResolution,
  Project,
  ProjectPathStatus,
  Issue,
  IssueArtifact,
  IssueDetail,
  IssueComment,
  IssueStatus,
  IssuePriority,
  RoleTemplate,
  RoleDetail,
  ActivityEventRow,
  ActivityQueryParams,
} from "@dashboard-agent/shared";

declare global {
  interface Window {
    dashboardAgent: {
      ping: () => Promise<string>;
      settings: {
        get: () => Promise<AppSettings>;
        update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
        pickWorkspace: () => Promise<string | null>;
      };
      auth: {
        status: () => Promise<TokenStatus>;
        set: (raw: string, source: TokenSource) => Promise<TokenStatus>;
        detect: () => Promise<DetectResult>;
        importDetected: () => Promise<TokenStatus>;
        clear: () => Promise<TokenStatus>;
      };
      companies: {
        list: () => Promise<Company[]>;
        createDemo: () => Promise<Company>;
      };
      agents: {
        list: (companyId: string) => Promise<Agent[]>;
        sendMessage: (agentId: string, content: string) => Promise<Message>;
        kill: (agentId: string) => Promise<void>;
        setAllowedProjects: (agentId: string, projectIds: string[]) => Promise<void>;
        setModel: (agentId: string, model: string) => Promise<{ ok: true }>;
        setRole: (
          agentId: string,
          roleTemplateId: string,
          opts?: { preserveModel?: boolean },
        ) => Promise<{ ok: true }>;
        setSystemPrompt: (agentId: string, systemPrompt: string) => Promise<{ ok: true }>;
        setReportsTo: (agentId: string, reportsTo: string | null) => Promise<{ ok: true }>;
        stats: (agentId: string) => Promise<AgentStats>;
        onEvent: (cb: (event: AgentEvent) => void) => () => void;
      };
      messages: {
        list: (companyId: string, participants: string[]) => Promise<Message[]>;
        listByAgent: (agentId: string) => Promise<Message[]>;
      };
      inbox: {
        list: (companyId: string) => Promise<InboxItem[]>;
        markRead: (id: string) => Promise<void>;
        onUpdate: (cb: () => void) => () => void;
      };
      permissions: {
        resolve: (toolUseId: string, resolution: PermissionResolution) => Promise<void>;
        onRequest: (cb: (req: PermissionRequest) => void) => () => void;
      };
      projects: {
        list: (companyId: string) => Promise<Project[]>;
        create: (input: {
          companyId: string;
          name: string;
          path: string;
          color: string;
        }) => Promise<Project>;
        update: (input: {
          id: string;
          name?: string;
          path?: string;
          color?: string;
        }) => Promise<Project | null>;
        delete: (id: string) => Promise<{ ok: true }>;
        openFolder: (id: string) => Promise<{ opened: boolean }>;
        checkPaths: (companyId: string) => Promise<Record<string, ProjectPathStatus>>;
      };
      issues: {
        list: (payload: {
          companyId: string;
          projectId?: string;
          assigneeId?: string;
          status?: IssueStatus;
        }) => Promise<Issue[]>;
        get: (id: string) => Promise<IssueDetail | null>;
        create: (input: {
          companyId: string;
          projectId: string | null;
          title: string;
          description?: string | null;
          assigneeId?: string | null;
          priority?: IssuePriority;
          parentId?: string | null;
        }) => Promise<Issue>;
        update: (input: {
          id: string;
          title?: string;
          description?: string | null;
          status?: IssueStatus;
          assigneeId?: string | null;
          priority?: IssuePriority;
          parentId?: string | null;
        }) => Promise<Issue | null>;
        delete: (id: string) => Promise<{ ok: true }>;
        addComment: (issueId: string, content: string) => Promise<IssueComment>;
        listArtifacts: (issueId: string) => Promise<IssueArtifact[]>;
        onChanged: (
          cb: (event: { kind: string; issueId: string; companyId: string }) => void,
        ) => () => void;
      };
      roles: {
        list: () => Promise<Array<RoleTemplate & { agentCount: number }>>;
        get: (id: string) => Promise<RoleDetail | null>;
      };
      activity: {
        query: (params: ActivityQueryParams) => Promise<ActivityEventRow[]>;
        onNew: (cb: (row: ActivityEventRow) => void) => () => void;
      };
    };
  }
}
export {};
