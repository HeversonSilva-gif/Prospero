/// <reference types="vite/client" />
import type {
  AppSettings,
  TokenSource,
  TokenStatus,
  Agent,
  AgentEvent,
  Company,
  Message,
} from "@dashboard-agent/shared";

declare global {
  interface Window {
    dashboardAgent: {
      ping: () => Promise<string>;
      settings: {
        get: () => Promise<AppSettings>;
        update: (patch: Partial<AppSettings>) => Promise<AppSettings>;
      };
      auth: {
        status: () => Promise<TokenStatus>;
        set: (raw: string, source: TokenSource) => Promise<TokenStatus>;
        detect: () => Promise<string | null>;
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
    };
  }
}
export {};
