export const IPC = {
  PING: "ping",
  SETTINGS_GET: "settings:get",
  SETTINGS_UPDATE: "settings:update",
  AUTH_TOKEN_STATUS: "auth:token-status",
  AUTH_TOKEN_SET: "auth:token-set",
  AUTH_TOKEN_DETECT: "auth:token-detect",
  AUTH_TOKEN_CLEAR: "auth:token-clear",
  COMPANY_LIST: "company:list",
  COMPANY_CREATE_DEMO: "company:create-demo",
  AGENT_LIST: "agent:list",
  AGENT_SEND_MESSAGE: "agent:send-message",
  AGENT_KILL: "agent:kill",
  AGENT_EVENT: "agent:event",
  MESSAGE_LIST: "message:list",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
