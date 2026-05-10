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
} from "@dashboard-agent/shared";

contextBridge.exposeInMainWorld("dashboardAgent", {
  ping: (): Promise<string> => ipcRenderer.invoke(IPC.PING),
  settings: {
    get: () => ipcRenderer.invoke(IPC.SETTINGS_GET) as Promise<AppSettings>,
    update: (patch: Partial<AppSettings>) =>
      ipcRenderer.invoke(IPC.SETTINGS_UPDATE, patch) as Promise<AppSettings>,
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
  },
});
