import { z } from "zod";

// PR-F.2.2 / M12 PR-D4: zod schema for AGENTS.md YAML front-matter. Lives in
// apps/main (NOT in packages/shared) because zod cannot cross the preload
// sandbox.

export const AgentsMdProjectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

// M12 PR-D4: a role definition carried inside AGENTS.md so the file is
// self-contained — importing it can recreate the role, charter and all.
export const AgentsMdRoleSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  model: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  icon: z.string().optional(),
  charter: z.string().optional(),
});

export const AgentsMdAgentSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  model: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  reports_to: z.string().optional(),
  projects: z.array(z.string()).optional(),
});

// `roles` is optional so AGENTS.md files written before M12 PR-D4 still parse.
export const AgentsMdSchema = z.object({
  company: z.string().min(1),
  projects: z.array(AgentsMdProjectSchema).default([]),
  roles: z.array(AgentsMdRoleSchema).optional(),
  agents: z.array(AgentsMdAgentSchema).min(1),
});

export type AgentsMdPayload = z.infer<typeof AgentsMdSchema>;
export type AgentsMdProject = z.infer<typeof AgentsMdProjectSchema>;
export type AgentsMdRole = z.infer<typeof AgentsMdRoleSchema>;
export type AgentsMdAgent = z.infer<typeof AgentsMdAgentSchema>;

export type ConflictMode = "skip" | "replace";

export type HireSummary = {
  companyId: string;
  created: {
    projects: number;
    roles: number;
    agents: number;
  };
  skipped: {
    projects: string[];
    roles: string[];
    agents: string[];
  };
  replaced: {
    agents: string[];
  };
  warnings: string[];
};
