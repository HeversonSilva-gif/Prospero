import type { Message } from "@prospero/shared";

const TITLE_MAX = 80;

/** Plain-language goal title derived from the owner's first request: first
 *  non-empty line, trimmed, truncated to 80 chars. */
export const deriveGoalTitle = (request: string): string => {
  const firstLine =
    request
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l !== "") ?? "";
  if (firstLine === "") return "Novo pedido";
  if (firstLine.length <= TITLE_MAX) return firstLine;
  return firstLine.slice(0, TITLE_MAX - 1) + "…";
};

/** Messages belonging to THIS request: the CEO thread filtered to the user-facing
 *  chat (threadParticipants undefined or including "user") at/after the goal's
 *  createdAt. Keeps the conversation scoped to one request. */
export const scopeUserMessages = (messages: Message[], sinceMs: number): Message[] =>
  messages.filter(
    (m) =>
      m.createdAt >= sinceMs &&
      (m.threadParticipants === undefined || m.threadParticipants.includes("user")),
  );
