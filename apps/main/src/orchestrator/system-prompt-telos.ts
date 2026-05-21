// Builds the TELOS system-prompt block (spec §7.3, §10). The CEO gets the full
// TELOS body — it is the north star it plans against. Every other agent gets a
// 1-line pointer to the telos_read tool (token discipline — §11). Returns
// undefined when the company has no TELOS, so composeSystemPrompt drops it.

import { isCeoAgent } from "@prospero/shared";
import { readTelos } from "../companies/telos-store.js";

export type BuildTelosBlockDeps = {
  userDataDir: string;
  companyId: string;
  agentRole: string;
  agentTemplateId?: string | null;
};

// The injected CEO body is capped — token discipline (§11).
const TELOS_CAP = 4000;

export const buildTelosBlock = (deps: BuildTelosBlockDeps): string | undefined => {
  const body = readTelos(deps.userDataDir, deps.companyId);
  if (body === null || body.trim() === "") return undefined;
  const isCeo = isCeoAgent({ role: deps.agentRole, templateId: deps.agentTemplateId ?? null });
  if (isCeo) {
    return `\n---\n\n# Company TELOS\n\nThis is what the company exists for — the north star every goal is accountable to:\n\n${body.trim().slice(0, TELOS_CAP)}\n`;
  }
  return `\n---\n\n# Company TELOS\n\nYour company has a TELOS — its mission, principles, and ideal state. Call the telos_read tool to read it when you need the business context.\n`;
};
