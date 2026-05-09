export const IPC = {
  PING: "ping",
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
