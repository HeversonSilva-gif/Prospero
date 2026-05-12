import { z } from "zod";

// MCP `hire_agent` tool: company_id comes from request context, not payload.
export const HIRE_AGENT_INPUT_SCHEMA = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  system_prompt: z.string().min(20),
  mode: z.enum(["supervised", "auto"]).optional(),
  reports_to: z.string().optional(),
  role_template_id: z.string().optional(),
});

export type HireAgentInput = z.infer<typeof HIRE_AGENT_INPUT_SCHEMA>;

// UI `agents:hire-from-ui` IPC: payload carries company_id explicitly.
export const HIRE_FROM_UI_INPUT_SCHEMA = HIRE_AGENT_INPUT_SCHEMA.extend({
  company_id: z.string().min(1),
});

export type HireFromUiInput = z.infer<typeof HIRE_FROM_UI_INPUT_SCHEMA>;
