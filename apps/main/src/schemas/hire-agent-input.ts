// Runtime zod schemas for the hire_agent flow. Lives in apps/main (not
// shared) because the preload bundle pulls shared inline — adding zod to
// shared would leave `require("zod")` in preload.cjs which fails to resolve
// in Electron's preload sandbox.
//
// Types are exported from packages/shared/src/types/hire-agent-input.ts
// so consumers reference the same shape; the schemas here validate it.

import { z } from "zod";

export const HIRE_AGENT_INPUT_SCHEMA = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  system_prompt: z.string().min(20),
  mode: z.enum(["supervised", "auto"]).optional(),
  reports_to: z.string().optional(),
  role_template_id: z.string().optional(),
});

export const HIRE_FROM_UI_INPUT_SCHEMA = HIRE_AGENT_INPUT_SCHEMA.extend({
  company_id: z.string().min(1),
});
