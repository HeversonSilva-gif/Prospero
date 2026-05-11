// RoleTemplate is the seeded blueprint for hiring an agent. Stored in the
// `role_templates` DB table (one row per canonical role). Skills are canonical
// IDs from packages/shared/src/skills.ts — each skill resolves to a set of
// Claude tool names at spawn time.
export type RoleTemplate = {
  id: string;
  name: string;
  description: string;
  defaultSystemPrompt: string;
  defaultSkills: string[];
  defaultModel: string;
  icon: string | null;
};

// RoleDetail extends RoleTemplate with derived data shown in the /skills UI:
// the resolved flat list of Claude tool names and which agents currently use
// the role. Agents-using is a small slice for the right-panel listing.
export type RoleDetail = RoleTemplate & {
  resolvedTools: string[];
  agentsUsing: Array<{ id: string; name: string }>;
};
