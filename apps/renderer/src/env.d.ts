/// <reference types="vite/client" />

declare global {
  interface Window {
    dashboardAgent: {
      ping: () => Promise<string>;
    };
  }
}
export {};
