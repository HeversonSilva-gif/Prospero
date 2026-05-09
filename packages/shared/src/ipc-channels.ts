export const IPC = {
  PING: "ping",
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  AUTH_TOKEN_STATUS: "auth:token-status",
  AUTH_TOKEN_SET: "auth:token-set",
  AUTH_TOKEN_DETECT: "auth:token-detect",
  AUTH_TOKEN_CLEAR: "auth:token-clear",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
