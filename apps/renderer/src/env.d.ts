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
  CostsQueryInput,
  CostsQueryResult,
  CostsAggregateTodayResult,
  CostBudgets,
  Goal,
  GoalStatus,
  GoalWithPlan,
  CreateGoalInput,
  ExecutePlanResult,
} from "@dashboard-agent/shared";

declare global {
  interface Window {
    dashboardAgent: {
      ping: () => Promise<string>;
      settings: {
        get: () => Promise<AppSettings>;
        update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
        pickWorkspace: () => Promise<string | null>;
        getExecutorMode: () => Promise<"atomic" | "narrated">;
        setExecutorMode: (mode: "atomic" | "narrated") => Promise<{ ok: true }>;
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
        setMode: (agentId: string, mode: "supervised" | "auto") => Promise<{ ok: true }>;
        setAlwaysOn: (agentId: string, alwaysOn: boolean) => Promise<{ ok: true }>;
        setSkills: (agentId: string, skills: string[]) => Promise<{ ok: true }>;
        pause: (agentId: string, reason?: string) => Promise<{ ok: true }>;
        resume: (agentId: string) => Promise<{ ok: true; drained: number }>;
        terminate: (agentId: string, reason?: string) => Promise<{ ok: true }>;
        wakeUp: (agentId: string) => Promise<{ ok: true }>;
        resetSession: (agentId: string) => Promise<{ ok: true }>;
        hireFromUi: (payload: {
          company_id: string;
          name: string;
          role: string;
          system_prompt: string;
          mode?: "supervised" | "auto";
          reports_to?: string;
          role_template_id?: string;
        }) => Promise<Agent>;
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
      costs: {
        query: (input: CostsQueryInput) => Promise<CostsQueryResult>;
        aggregateToday: (payload: { companyId: string }) => Promise<CostsAggregateTodayResult>;
        getBudgets: () => Promise<CostBudgets>;
        setBudgets: (patch: Partial<CostBudgets>) => Promise<CostBudgets>;
        onNew: (
          cb: (payload: { agentId: string; deltaTokens: number; deltaCents: number }) => void,
        ) => () => void;
      };
      goals: {
        list: (args: { companyId: string; status?: GoalStatus }) => Promise<Goal[]>;
        get: (args: { id: string }) => Promise<GoalWithPlan>;
        create: (args: CreateGoalInput) => Promise<Goal>;
        requestPlan: (args: { goalId: string }) => Promise<{ ok: true }>;
        approvePlan: (args: {
          planId: string;
          includeAgentIndexes?: number[];
          includeIssueIndexes?: number[];
        }) => Promise<ExecutePlanResult>;
        requestChanges: (args: { planId: string; feedback: string }) => Promise<{ ok: true }>;
        rejectPlan: (args: { planId: string; reason?: string }) => Promise<{ ok: true }>;
        narratedResume: (args: { goalId: string }) => Promise<{ ok: true }>;
        narratedRollback: (args: { goalId: string }) => Promise<{ aborted: true }>;
      };
      windowControls: {
        minimize: () => Promise<void>;
        maximizeToggle: () => Promise<void>;
        close: () => Promise<void>;
        isMaximized: () => Promise<boolean>;
        onStateChanged: (cb: (state: { isMaximized: boolean }) => void) => () => void;
      };
    };
  }
}
export {};
