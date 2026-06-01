import type Database from "better-sqlite3";
import { type Agent, CEO_TEMPLATE_ID } from "@prospero/shared";
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
    // Canonical CEO marker — the role_templates id, whose rich charter is then
    // materialized into the agent's instruction bundle. Every CEO check goes
    // through isCeoAgent (which keys off this id), so the CEO is found by goal
    // planning, Pedir algo, build-args (gets the planning prompt), etc. `role`
    // stays the human-readable display.
    templateId: CEO_TEMPLATE_ID,
    systemPrompt,
    mode: "supervised",
    alwaysOn: false,
    // Match the role-ceo defaults (post-migration 0004). Without these the
    // onboarding CEO was created with EMPTY capabilities, so its delegation /
    // issues / org / goal tools were never in --allowedTools and every call hit
    // the 30-min permission gate — the CEO froze. can_hire/can_assign default to
    // 1 at the column level, so the CEO can hire and assign.
    // `web` lets the CEO research real competitors/market on the web during genesis
    // (WebFetch/WebSearch, read-only) so the business plan isn't generic.
    capabilities: ["delegation", "issues", "inbox", "chat", "fs-read", "web"],
    // The CEO runs the smartest available model — it interviews the owner during
    // onboarding and plans the whole company. Opus 4.8 (latest) per product call.
    model: "claude-opus-4-8",
  });
};
