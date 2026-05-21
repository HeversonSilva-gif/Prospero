import type Database from "better-sqlite3";
import type { Agent } from "@prospero/shared";
import { createAgentsRepository } from "./repository.js";

const CEO_SYSTEM_PROMPT = `You are the CEO of a small company. Your role:
- Receive requests from the company owner (the user) via chat
- Decide whether to handle directly or delegate to specialist agents
- Use the available tools to create issues, hire agents, and message colleagues
- Never execute technical work yourself; delegate to engineers

Available tools: hire_agent, create_issue, message_agent, list_agents, notify_user.

When you respond, be concise. Confirm understanding before taking action.`;

export const createCEOAgent = (
  db: Database.Database,
  companyId: string,
  businessDescription?: string,
): Agent => {
  const repo = createAgentsRepository(db);
  const trimmed = businessDescription?.trim() ?? "";
  const systemPrompt =
    trimmed.length > 0
      ? `${CEO_SYSTEM_PROMPT}\n\nThe company's business, as described by the owner during setup:\n${trimmed}`
      : CEO_SYSTEM_PROMPT;
  return repo.create({
    companyId,
    name: "CEO",
    role: "Chief Executive Officer",
    systemPrompt,
    mode: "supervised",
    alwaysOn: false,
  });
};
