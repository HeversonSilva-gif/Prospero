export type PermissionRequest = {
  toolUseId: string;
  agentId: string;
  toolName: string;
  toolInput: unknown;
};

export type PermissionResolution =
  | { behavior: "allow"; decidedBy?: string }
  | { behavior: "deny"; message: string; decidedBy?: string };
