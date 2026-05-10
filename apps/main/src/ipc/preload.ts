import { contextBridge, ipcRenderer } from "electron";
import {
  IPC,
  type AppSettings,
  type DetectResult,
  type TokenSource,
  type TokenStatus,
  type Agent,
  type AgentEvent,
  type Company,
  type Message,
  type InboxItem,
  type PermissionResolution,
  type PermissionRequest,
  type Project,
  type ProjectPathStatus,
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
});
