import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
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
  type IssueDetail,
  type IssueComment,
  type IssueStatus,
  type IssuePriority,
  type RoleTemplate,
  type RoleDetail,
} from "@dashboard-agent/shared";

contextBridge.exposeInMainWorld("dashboardAgent", {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.PING),
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET) as Promise<AppSettings>,
    update: (patch: Partial<AppSettings>) =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch) as Promise<AppSettings>,
    pickWorkspace: () => ipcRenderer.invoke(IPC.SETTINGS_PICK_WORKSPACE) as Promise<string | null>,
  },
  auth: {
    status: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_STATUS) as Promise<TokenStatus>,
    set: (raw: string, source: TokenSource) =>
      ipcRenderer.invoke(IPC.AUTH_TOKEN_SET, { raw, source }) as Promise<TokenStatus>,
    detect: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_DETECT) as Promise<DetectResult>,
    importDetected: () =>
      ipcRenderer.invoke(IPC.AUTH_TOKEN_IMPORT_DETECTED) as Promise<TokenStatus>,
    clear: () => ipcRenderer.invoke(IPC.AUTH_TOKEN_CLEAR) as Promise<TokenStatus>,
  },
  companies: {
    list: () => ipcRenderer.invoke(IPC.COMPANY_LIST) as Promise<Company[]>,
    createDemo: () => ipcRenderer.invoke(IPC.COMPANY_CREATE_DEMO) as Promise<Company>,
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
    stats: (agentId: string) =>
      ipcRenderer.invoke(IPC.AGENTS_STATS, { agentId }) as Promise<AgentStats>,
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
  },
});
