/// <reference types="vite/client" />
import type { AppSettings, TokenSource, TokenStatus } from "@dashboard-agent/shared";

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
    };
  }
}
export {};
