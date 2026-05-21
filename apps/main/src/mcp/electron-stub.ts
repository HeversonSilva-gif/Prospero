// Inert "electron" stand-in, aliased into the MCP server bundle ONLY (see
// apps/main/tsup.config.ts). The MCP server runs as a standalone Node child with
// no Electron host, so importing the real "electron" crashes it ("Cannot find
// module 'electron'") and claude then sees zero tools. Modules shared with the
// main process (verification/deps.ts, db/path.ts) import electron for paths and
// window broadcasts; in the server those code paths are not on the critical
// path. Real paths come from env (DB_PATH); there are no windows to broadcast to.

export const app = {
  getPath: (_name: string): string => "",
  getName: (): string => "prospero",
};

export const BrowserWindow = {
  getAllWindows: (): { webContents: { send: (channel: string, payload: unknown) => void } }[] => [],
};

// Shared modules pulled into the server bundle (trust/engine → inbox-handlers,
// activity → broadcast helpers) import ipcMain. None of these handlers are
// registered or fire in the server — inert no-ops keep them compiling and loading.
export const ipcMain = {
  handle: (_channel: string, _listener: unknown): void => {},
  on: (_channel: string, _listener: unknown): void => {},
  removeHandler: (_channel: string): void => {},
  removeAllListeners: (_channel?: string): void => {},
};
