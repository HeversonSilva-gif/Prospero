// Type-only shapes for the hire_agent MCP tool + agents:hire-from-ui IPC.
// Runtime zod schemas live in apps/main/src/schemas/hire-agent-input.ts so
// they don't bleed into the preload bundle (which would pull zod into
// Electron's preload sandbox and fail at require time).

export interface HireAgentInput {
  name: string;
  role: string;
  system_prompt: string;
  mode?: "supervised" | "auto";
  reports_to?: string;
  role_template_id?: string;
}

export interface HireFromUiInput extends HireAgentInput {
  company_id: string;
}
