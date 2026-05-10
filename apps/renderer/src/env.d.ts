/// <reference types="vite/client" />
import type {
  AppSettings,
  DetectResult,
  TokenSource,
  TokenStatus,
  Agent,
  AgentEvent,
  Company,
  Message,
  PermissionRequest,
  PermissionResolution,
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
        onEvent: (cb: (event: AgentEvent) => void) => () => void;
      };
      messages: {
        list: (companyId: string, participants: string[]) => Promise<Message[]>;
      };
      permissions: {
        resolve: (toolUseId: string, resolution: PermissionResolution) => Promise<void>;
        onRequest: (cb: (req: PermissionRequest) => void) => () => void;
      };
    };
  }
}
export {};
