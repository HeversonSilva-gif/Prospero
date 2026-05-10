export type PermissionRequest = {
  toolUseId: string;
  agentId: string;
  toolName: string;
  toolInput: unknown;
};

export type PermissionResolution = { behavior: "allow" } | { behavior: "deny"; message: string };
