import { z } from "zod";

// PR-F.2.2: zod schema for AGENTS.md YAML front-matter. Lives in apps/main
// (NOT in packages/shared) because zod cannot cross the preload sandbox.

export const AgentsMdProjectSchema = z.object({
  name: z.string().min(1),
  path: z.string().min(1),
});

export const AgentsMdAgentSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  model: z.string().optional(),
  capabilities: z.array(z.string()).optional(),
  reports_to: z.string().optional(),
  projects: z.array(z.string()).optional(),
});

export const AgentsMdSchema = z.object({
  company: z.string().min(1),
  projects: z.array(AgentsMdProjectSchema).default([]),
  agents: z.array(AgentsMdAgentSchema).min(1),
});

export type AgentsMdPayload = z.infer<typeof AgentsMdSchema>;
export type AgentsMdProject = z.infer<typeof AgentsMdProjectSchema>;
export type AgentsMdAgent = z.infer<typeof AgentsMdAgentSchema>;

export type ConflictMode = "skip" | "replace";

export type HireSummary = {
  companyId: string;
  created: {
    projects: number;
    agents: number;
  };
  skipped: {
    projects: string[];
    agents: string[];
  };
  replaced: {
    agents: string[];
  };
  warnings: string[];
};
