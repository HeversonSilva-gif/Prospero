// RoleTemplate is the seeded blueprint for hiring an agent. Stored in the
// `role_templates` DB table (one row per canonical role). Capabilities are
// canonical IDs from packages/shared/src/capabilities.ts — each capability
// resolves to a set of Claude tool names at spawn time.
export type RoleTemplate = {
  id: string;
  name: string;
  description: string;
  defaultSystemPrompt: string;
  defaultCapabilities: string[];
  defaultModel: string;
  icon: string | null;
};

// RoleDetail extends RoleTemplate with derived data shown in the /roles UI:
// the resolved flat list of Claude tool names and which agents currently use
// the role. Agents-using is a small slice for the right-panel listing.
export type RoleDetail = RoleTemplate & {
  resolvedTools: string[];
  agentsUsing: Array<{ id: string; name: string }>;
};
