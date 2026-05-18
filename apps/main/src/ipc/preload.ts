import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type ApiKeyStatus,
  type AppSettings,
  type DetectResult,
  type TokenSource,
  type TokenStatus,
  type Agent,
  type AgentEvent,
  type AgentStats,
  type Company,
  type Message,
  type InboxItem,
  type PermissionResolution,
  type PermissionRequest,
  type Project,
  type ProjectPathStatus,
  type Issue,
  type IssueArtifact,
  type IssueDetail,
  type IssueComment,
  type IssueStatus,
  type IssuePriority,
  type RoleTemplate,
  type RoleDetail,
  type ActivityEventRow,
  type ActivityQueryParams,
  type CostsQueryInput,
  type CostsQueryResult,
  type CostsAggregateTodayResult,
  type CostBudgets,
  type Goal,
  type GoalStatus,
  type GoalWithPlan,
  type CreateGoalInput,
  type ExecutePlanResult,
  type Skill,
  type Memory,
  type SessionSearchHit,
  type SkillCandidate,
} from "@prospero/shared";

contextBridge.exposeInMainWorld("prospero", {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.PING),
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET) as Promise<AppSettings>,
    update: (patch: Partial<AppSettings>) =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch) as Promise<AppSettings>,
    pickWorkspace: () => ipcRenderer.invoke(IPC.SETTINGS_PICK_WORKSPACE) as Promise<string | null>,
    getExecutorMode: () =>
      ipcRenderer.invoke(IPC.SETTINGS_GET_EXECUTOR_MODE) as Promise<"atomic" | "narrated">,
    setExecutorMode: (mode: "atomic" | "narrated") =>
      ipcRenderer.invoke(IPC.SETTINGS_SET_EXECUTOR_MODE, mode) as Promise<{ ok: true }>,
  },
  auth: {
    status: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_STATUS) as Promise<TokenStatus>,
    set: (raw: string, source: TokenSource) =>
      ipcRenderer.invoke(IPC.AUTH_TOKEN_SET, { raw, source }) as Promise<TokenStatus>,
    detect: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_DETECT) as Promise<DetectResult>,
    importDetected: () =>
      ipcRenderer.invoke(IPC.AUTH_TOKEN_IMPORT_DETECTED) as Promise<TokenStatus>,
    clear: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_CLEAR) as Promise<TokenStatus>,
    apiKeyStatus: () => ipcRenderer.invoke(IPC.AUTH_API_KEY_STATUS) as Promise<ApiKeyStatus>,
    apiKeySet: (raw: string) =>
      ipcRenderer.invoke(IPC.AUTH_API_KEY_SET, { raw }) as Promise<ApiKeyStatus>,
    apiKeyClear: () => ipcRenderer.invoke(IPC.AUTH_API_KEY_CLEAR) as Promise<ApiKeyStatus>,
  },
  companies: {
    list: () => ipcRenderer.invoke(IPC.COMPANY_LIST) as Promise<Company[]>,
    createDemo: () => ipcRenderer.invoke(IPC.COMPANY_CREATE_DEMO) as Promise<Company>,
    create: (name: string) => ipcRenderer.invoke(IPC.COMPANY_CREATE, { name }) as Promise<Company>,
    delete: (id: string) => ipcRenderer.invoke(IPC.COMPANY_DELETE, { id }) as Promise<{ ok: true }>,
    exportSnapshot: (id: string) =>
      ipcRenderer.invoke(IPC.COMPANY_EXPORT, { id }) as Promise<unknown>,
    importSnapshot: (snapshot: unknown) =>
      ipcRenderer.invoke(IPC.COMPANY_IMPORT, { snapshot }) as Promise<{
        newCompanyId: string;
        newCompanyName: string;
        counts: Record<string, number>;
        warnings: string[];
      }>,
  },
  agentsMd: {
    parse: (raw: string) =>
      ipcRenderer.invoke(IPC.AGENTS_MD_PARSE, { raw }) as Promise<
        | {
            ok: true;
            data: {
              company: string;
              projects: { name: string; path: string }[];
              agents: {
                name: string;
                role: string;
                model?: string;
                capabilities?: string[];
                reports_to?: string;
                projects?: string[];
              }[];
            };
          }
        | { ok: false; error: string }
      >,
    hire: (
      companyId: string,
      payload: unknown,
      conflictModes: Record<string, "skip" | "replace">,
    ) =>
      ipcRenderer.invoke(IPC.AGENTS_MD_HIRE, { companyId, payload, conflictModes }) as Promise<{
        companyId: string;
        created: { projects: number; agents: number };
        skipped: { projects: string[]; agents: string[] };
        replaced: { agents: string[] };
        warnings: string[];
      }>,
    export: (companyId: string) =>
      ipcRenderer.invoke(IPC.AGENTS_MD_EXPORT, { companyId }) as Promise<{ text: string }>,
  },
  agents: {
    list: (companyId: string) =>
      ipcRenderer.invoke(IPC.AGENT_LIST, { companyId }) as Promise<Agent[]>,
    sendMessage: (agentId: string, content: string) =>
      ipcRenderer.invoke(IPC.AGENT_SEND_MESSAGE, { agentId, content }) as Promise<Message>,
    kill: (agentId: string) => ipcRenderer.invoke(IPC.AGENT_KILL, { agentId }) as Promise<void>,
    setAllowedProjects: (agentId: string, projectIds: string[]) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_ALLOWED_PROJECTS, { agentId, projectIds }) as Promise<void>,
    setModel: (agentId: string, model: string) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_MODEL, { agentId, model }) as Promise<{ ok: true }>,
    setRole: (agentId: string, roleTemplateId: string, opts?: { preserveModel?: boolean }) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_ROLE, {
        agentId,
        roleTemplateId,
        ...(opts ?? {}),
      }) as Promise<{ ok: true }>,
    setSystemPrompt: (agentId: string, systemPrompt: string) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_SYSTEM_PROMPT, { agentId, systemPrompt }) as Promise<{
        ok: true;
      }>,
    setReportsTo: (agentId: string, reportsTo: string | null) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_REPORTS_TO, { agentId, reportsTo }) as Promise<{
        ok: true;
      }>,
    setAdapter: (agentId: string, adapterName: string) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_ADAPTER, { agentId, adapterName }) as Promise<{
        ok: true;
      }>,
    stats: (agentId: string) =>
      ipcRenderer.invoke(IPC.AGENTS_STATS, { agentId }) as Promise<AgentStats>,
    setMode: (agentId: string, mode: "supervised" | "auto") =>
      ipcRenderer.invoke(IPC.AGENTS_SET_MODE, { agentId, mode }) as Promise<{ ok: true }>,
    setAlwaysOn: (agentId: string, alwaysOn: boolean) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_ALWAYS_ON, { agentId, alwaysOn }) as Promise<{ ok: true }>,
    setCapabilities: (agentId: string, capabilities: string[]) =>
      ipcRenderer.invoke(IPC.AGENTS_SET_CAPABILITIES, { agentId, capabilities }) as Promise<{
        ok: true;
      }>,
    pause: (agentId: string, reason?: string) =>
      ipcRenderer.invoke(IPC.AGENTS_PAUSE, { agentId, reason }) as Promise<{ ok: true }>,
    resume: (agentId: string) =>
      ipcRenderer.invoke(IPC.AGENTS_RESUME, { agentId }) as Promise<{
        ok: true;
        drained: number;
      }>,
    terminate: (agentId: string, reason?: string) =>
      ipcRenderer.invoke(IPC.AGENTS_TERMINATE, { agentId, reason }) as Promise<{ ok: true }>,
    wakeUp: (agentId: string) =>
      ipcRenderer.invoke(IPC.AGENTS_WAKE_UP, { agentId }) as Promise<{ ok: true }>,
    resetSession: (agentId: string) =>
      ipcRenderer.invoke(IPC.AGENTS_RESET_SESSION, { agentId }) as Promise<{ ok: true }>,
    hireFromUi: (payload: {
      company_id: string;
      name: string;
      role: string;
      system_prompt: string;
      mode?: "supervised" | "auto";
      reports_to?: string;
      role_template_id?: string;
      location?: "local" | "remote";
    }) => ipcRenderer.invoke(IPC.AGENTS_HIRE_FROM_UI, payload) as Promise<Agent>,
    onEvent: (cb: (event: AgentEvent) => void) => {
      const handler = (_e: unknown, event: AgentEvent) => cb(event);
      ipcRenderer.on(IPC.AGENT_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.AGENT_EVENT, handler);
    },
  },
  messages: {
    list: (companyId: string, participants: string[]) =>
      ipcRenderer.invoke(IPC.MESSAGE_LIST, { companyId, participants }) as Promise<Message[]>,
    listByAgent: (agentId: string) =>
      ipcRenderer.invoke(IPC.MESSAGE_LIST_BY_AGENT, { agentId }) as Promise<Message[]>,
  },
  inbox: {
    list: (companyId: string) =>
      ipcRenderer.invoke(IPC.INBOX_LIST, { companyId }) as Promise<InboxItem[]>,
    markRead: (id: string) => ipcRenderer.invoke(IPC.INBOX_MARK_READ, { id }) as Promise<void>,
    onUpdate: (cb: () => void) => {
      const handler = () => cb();
      ipcRenderer.on(IPC.INBOX_UPDATE, handler);
      return () => ipcRenderer.removeListener(IPC.INBOX_UPDATE, handler);
    },
  },
  permissions: {
    resolve: (toolUseId: string, resolution: PermissionResolution) =>
      ipcRenderer.invoke(IPC.PERMISSION_RESOLVE, { toolUseId, resolution }) as Promise<void>,
    onRequest: (cb: (req: PermissionRequest) => void) => {
      const handler = (_e: unknown, req: PermissionRequest) => cb(req);
      ipcRenderer.on(IPC.PERMISSION_REQUEST, handler);
      return () => ipcRenderer.removeListener(IPC.PERMISSION_REQUEST, handler);
    },
  },
  projects: {
    list: (companyId: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_LIST, { companyId }) as Promise<Project[]>,
    create: (input: { companyId: string; name: string; path: string; color: string }) =>
      ipcRenderer.invoke(IPC.PROJECTS_CREATE, input) as Promise<Project>,
    update: (input: { id: string; name?: string; path?: string; color?: string }) =>
      ipcRenderer.invoke(IPC.PROJECTS_UPDATE, input) as Promise<Project | null>,
    delete: (id: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_DELETE, { id }) as Promise<{ ok: true }>,
    openFolder: (id: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_OPEN_FOLDER, { id }) as Promise<{ opened: boolean }>,
    checkPaths: (companyId: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_CHECK_PATHS, { companyId }) as Promise<
        Record<string, ProjectPathStatus>
      >,
    setSlug: (projectId: string, slug: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_SET_SLUG, { projectId, slug }) as Promise<void>,
    setIcon: (id: string, icon: string | null) =>
      ipcRenderer.invoke(IPC.PROJECTS_SET_ICON, { id, icon }) as Promise<{ ok: true }>,
    archive: (id: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_ARCHIVE, { id }) as Promise<{ ok: true }>,
    unarchive: (id: string) =>
      ipcRenderer.invoke(IPC.PROJECTS_UNARCHIVE, { id }) as Promise<{ ok: true }>,
  },
  issues: {
    list: (payload: {
      companyId: string;
      projectId?: string;
      assigneeId?: string;
      status?: IssueStatus;
    }) => ipcRenderer.invoke(IPC.ISSUES_LIST, payload) as Promise<Issue[]>,
    get: (id: string) => ipcRenderer.invoke(IPC.ISSUES_GET, { id }) as Promise<IssueDetail | null>,
    create: (input: {
      companyId: string;
      projectId: string | null;
      title: string;
      description?: string | null;
      assigneeId?: string | null;
      priority?: IssuePriority;
      parentId?: string | null;
    }) => ipcRenderer.invoke(IPC.ISSUES_CREATE, input) as Promise<Issue>,
    update: (input: {
      id: string;
      title?: string;
      description?: string | null;
      status?: IssueStatus;
      assigneeId?: string | null;
      priority?: IssuePriority;
      parentId?: string | null;
    }) => ipcRenderer.invoke(IPC.ISSUES_UPDATE, input) as Promise<Issue | null>,
    delete: (id: string) => ipcRenderer.invoke(IPC.ISSUES_DELETE, { id }) as Promise<{ ok: true }>,
    addComment: (issueId: string, content: string) =>
      ipcRenderer.invoke(IPC.ISSUES_ADD_COMMENT, { issueId, content }) as Promise<IssueComment>,
    listArtifacts: (issueId: string) =>
      ipcRenderer.invoke(IPC.ARTIFACTS_LIST_BY_ISSUE, { issueId }) as Promise<IssueArtifact[]>,
    onChanged: (cb: (event: { kind: string; issueId: string; companyId: string }) => void) => {
      const handler = (_e: unknown, ev: { kind: string; issueId: string; companyId: string }) =>
        cb(ev);
      ipcRenderer.on(IPC.ISSUES_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC.ISSUES_CHANGED, handler);
    },
  },
  roles: {
    list: () =>
      ipcRenderer.invoke(IPC.ROLES_LIST) as Promise<Array<RoleTemplate & { agentCount: number }>>,
    get: (id: string) => ipcRenderer.invoke(IPC.ROLES_GET, { id }) as Promise<RoleDetail | null>,
    create: (input: {
      name: string;
      description: string;
      icon: string | null;
      defaultModel: string;
      defaultCapabilities: string[];
    }) => ipcRenderer.invoke(IPC.ROLES_CREATE, input) as Promise<RoleTemplate>,
    update: (input: {
      id: string;
      name?: string;
      description?: string;
      icon?: string | null;
      defaultModel?: string;
      defaultCapabilities?: string[];
    }) => ipcRenderer.invoke(IPC.ROLES_UPDATE, input) as Promise<RoleTemplate>,
    delete: (id: string) => ipcRenderer.invoke(IPC.ROLES_DELETE, { id }) as Promise<{ ok: true }>,
    clone: (id: string) => ipcRenderer.invoke(IPC.ROLES_CLONE, { id }) as Promise<RoleTemplate>,
    getCharter: (id: string) =>
      ipcRenderer.invoke(IPC.ROLES_GET_CHARTER, { id }) as Promise<{ body: string }>,
    saveCharter: (id: string, body: string) =>
      ipcRenderer.invoke(IPC.ROLES_SAVE_CHARTER, { id, body }) as Promise<{ ok: true }>,
  },
  activity: {
    query: (params: ActivityQueryParams) =>
      ipcRenderer.invoke(IPC.ACTIVITY_QUERY, params) as Promise<ActivityEventRow[]>,
    onNew: (cb: (row: ActivityEventRow) => void) => {
      const handler = (_e: unknown, row: ActivityEventRow) => cb(row);
      ipcRenderer.on(IPC.ACTIVITY_NEW, handler);
      return () => ipcRenderer.removeListener(IPC.ACTIVITY_NEW, handler);
    },
  },
  costs: {
    query: (input: CostsQueryInput) =>
      ipcRenderer.invoke(IPC.COSTS_QUERY, input) as Promise<CostsQueryResult>,
    aggregateToday: (payload: { companyId: string }) =>
      ipcRenderer.invoke(IPC.COSTS_AGGREGATE_TODAY, payload) as Promise<CostsAggregateTodayResult>,
    getBudgets: () => ipcRenderer.invoke(IPC.COSTS_GET_BUDGETS) as Promise<CostBudgets>,
    setBudgets: (patch: Partial<CostBudgets>) =>
      ipcRenderer.invoke(IPC.COSTS_SET_BUDGETS, patch) as Promise<CostBudgets>,
    onNew: (
      cb: (payload: { agentId: string; deltaTokens: number; deltaCents: number }) => void,
    ): (() => void) => {
      const handler = (
        _event: unknown,
        payload: { kind: string; agentId: string; deltaTokens: number; deltaCents: number },
      ): void => {
        if (payload.kind !== "costs-new") return;
        cb({
          agentId: payload.agentId,
          deltaTokens: payload.deltaTokens,
          deltaCents: payload.deltaCents,
        });
      };
      ipcRenderer.on(IPC.AGENT_EVENT, handler);
      return () => ipcRenderer.off(IPC.AGENT_EVENT, handler);
    },
  },
  goals: {
    list: (args: { companyId: string; status?: GoalStatus }) =>
      ipcRenderer.invoke(IPC.GOALS_LIST, args) as Promise<Goal[]>,
    get: (args: { id: string }) => ipcRenderer.invoke(IPC.GOALS_GET, args) as Promise<GoalWithPlan>,
    create: (args: CreateGoalInput) => ipcRenderer.invoke(IPC.GOALS_CREATE, args) as Promise<Goal>,
    requestPlan: (args: { goalId: string }) =>
      ipcRenderer.invoke(IPC.GOALS_REQUEST_PLAN, args) as Promise<{ ok: true }>,
    approvePlan: (args: {
      planId: string;
      includeAgentIndexes?: number[];
      includeIssueIndexes?: number[];
      mode?: "atomic" | "narrated";
    }) => ipcRenderer.invoke(IPC.GOALS_APPROVE_PLAN, args) as Promise<ExecutePlanResult>,
    requestChanges: (args: { planId: string; feedback: string }) =>
      ipcRenderer.invoke(IPC.GOALS_REQUEST_CHANGES, args) as Promise<{ ok: true }>,
    rejectPlan: (args: { planId: string; reason?: string }) =>
      ipcRenderer.invoke(IPC.GOALS_REJECT_PLAN, args) as Promise<{ ok: true }>,
    narratedResume: (args: { goalId: string }) =>
      ipcRenderer.invoke(IPC.GOALS_NARRATED_RESUME, args) as Promise<{ ok: true }>,
    narratedRollback: (args: { goalId: string }) =>
      ipcRenderer.invoke(IPC.GOALS_NARRATED_ROLLBACK, args) as Promise<{ aborted: true }>,
  },
  remote: {
    testConnection: () =>
      ipcRenderer.invoke(IPC.REMOTE_TEST_CONNECTION) as Promise<{
        ok: boolean;
        message: string;
      }>,
  },
  learning: {
    listSkills: (agentId: string) =>
      ipcRenderer.invoke(IPC.SKILLS_LIST_FOR_AGENT, { agentId }) as Promise<Skill[]>,
    readSkillBody: (skillId: string) =>
      ipcRenderer.invoke(IPC.SKILLS_READ_BODY, { skillId }) as Promise<{ body: string }>,
    listMemories: (agentId: string) =>
      ipcRenderer.invoke(IPC.MEMORIES_LIST_FOR_AGENT, { agentId }) as Promise<Memory[]>,
    searchSessions: (agentId: string, query: string, limit?: number) =>
      ipcRenderer.invoke(IPC.SESSION_SEARCH, { agentId, query, limit }) as Promise<
        SessionSearchHit[]
      >,
    listCandidates: (agentId: string) =>
      ipcRenderer.invoke(IPC.SKILL_CANDIDATES_LIST_FOR_AGENT, { agentId }) as Promise<
        SkillCandidate[]
      >,
    acceptCandidate: (input: {
      candidateId: string;
      name?: string;
      description?: string;
      body?: string;
    }) => ipcRenderer.invoke(IPC.SKILL_CANDIDATE_ACCEPT, input) as Promise<Skill>,
    rejectCandidate: (input: { candidateId: string; reason?: string }) =>
      ipcRenderer.invoke(IPC.SKILL_CANDIDATE_REJECT, input) as Promise<{ ok: true }>,
    approveSkillPromotion: (input: { skillId: string; appliesToRole: string | null }) =>
      ipcRenderer.invoke(IPC.SKILL_PROMOTE_APPROVE, input) as Promise<Skill>,
    orgLearnings: (companyId: string) =>
      ipcRenderer.invoke(IPC.LEARNING_ORG, { companyId }) as Promise<{
        topSkills: Skill[];
        recentRetrospectives: Memory[];
      }>,
    rateSkill: (skillId: string, direction: "up" | "down") =>
      ipcRenderer.invoke(IPC.LEARNING_RATE_SKILL, { skillId, direction }) as Promise<Skill>,
    rateMemory: (memoryId: string, direction: "up" | "down") =>
      ipcRenderer.invoke(IPC.LEARNING_RATE_MEMORY, { memoryId, direction }) as Promise<Memory>,
    getUserMemory: () => ipcRenderer.invoke(IPC.MEMORY_USER_GET) as Promise<{ content: string }>,
    setUserMemory: (content: string) =>
      ipcRenderer.invoke(IPC.MEMORY_USER_SET, { content }) as Promise<{ ok: true }>,
    importClaudeCodeMemory: () =>
      ipcRenderer.invoke(IPC.MEMORY_USER_IMPORT_CC) as Promise<{ content: string }>,
    promoteSkillsOnTerminate: (agentId: string, promoteSkillIds: string[]) =>
      ipcRenderer.invoke(IPC.SKILLS_PROMOTE_ON_TERMINATE, { agentId, promoteSkillIds }) as Promise<{
        promoted: number;
        softDeleted: number;
      }>,
  },
  windowControls: {
    minimize: () => ipcRenderer.invoke(IPC.WINDOW_MINIMIZE) as Promise<void>,
    maximizeToggle: () => ipcRenderer.invoke(IPC.WINDOW_MAXIMIZE_TOGGLE) as Promise<void>,
    close: () => ipcRenderer.invoke(IPC.WINDOW_CLOSE) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IPC.WINDOW_IS_MAXIMIZED) as Promise<boolean>,
    onStateChanged: (cb: (state: { isMaximized: boolean }) => void) => {
      const handler = (_e: unknown, s: { isMaximized: boolean }) => cb(s);
      ipcRenderer.on(IPC.WINDOW_STATE_CHANGED, handler);
      return () => ipcRenderer.removeListener(IPC.WINDOW_STATE_CHANGED, handler);
    },
  },
});
