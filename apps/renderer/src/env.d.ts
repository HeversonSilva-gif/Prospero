/// <reference types="vite/client" />

declare global {
  interface Window {
    dashboardAgent: {
      ping: () => string;
    };
  }
}
export {};
