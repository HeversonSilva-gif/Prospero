// RoleTemplate is the user-managed blueprint for hiring an agent. Stored in the
// `role_templates` DB table (one row per role). Capabilities are canonical IDs
// from packages/shared/src/capabilities.ts — each resolves to a set of Claude
// tool names at spawn time. The role's authored 8-section charter lives as a
// markdown file on disk; its body is fetched separately via roles:get-charter.
export type RoleTemplate = {
  id: string;
  name: string;
  description: string;
  defaultSystemPrompt: string;
  defaultCapabilities: string[];
  defaultModel: string;
  icon: string | null;
  // M12 PR-A: 1 for the 5 shipped example roles (still fully deletable; the UI
  // flags them as starting points).
  isSeedExample: boolean;
  createdAt: number;
  updatedAt: number;
};

// RoleDetail extends RoleTemplate with derived data shown in the /roles UI:
// the resolved flat list of Claude tool names and which agents currently use
// the role. Agents-using is a small slice for the right-panel listing.
export type RoleDetail = RoleTemplate & {
  resolvedTools: string[];
  agentsUsing: Array<{ id: string; name: string }>;
};
