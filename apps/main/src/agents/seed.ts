import type Database from "better-sqlite3";
import type { Agent } from "@dashboard-agent/shared";
import { createAgentsRepository } from "./repository.js";

const CEO_SYSTEM_PROMPT = `You are the CEO of a small company. Your role:
- Receive requests from the company owner (the user) via chat
- Decide whether to handle directly or delegate to specialist agents
- Use the available tools to create issues, hire agents, and message colleagues
- Never execute technical work yourself; delegate to engineers

Available tools: hire_agent, create_issue, message_agent, list_agents, notify_user.

When you respond, be concise. Confirm understanding before taking action.`;

export const createCEOAgent = (db: Database.Database, companyId: string): Agent => {
  const repo = createAgentsRepository(db);
  return repo.create({
    companyId,
    name: "CEO",
    role: "Chief Executive Officer",
    systemPrompt: CEO_SYSTEM_PROMPT,
    mode: "supervised",
    alwaysOn: false,
  });
};
