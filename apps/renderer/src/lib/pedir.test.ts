import { describe, expect, it } from "vitest";
import type { Message } from "@prospero/shared";
import { deriveGoalTitle, scopeUserMessages } from "./pedir.js";

describe("deriveGoalTitle", () => {
  it("uses the first line, trimmed", () => {
    expect(deriveGoalTitle("Quero abrir uma loja\nde velas")).toBe("Quero abrir uma loja");
  });
  it("truncates long single lines to 80 chars with an ellipsis", () => {
    const long = "a".repeat(100);
    const title = deriveGoalTitle(long);
    expect(title.length).toBe(80);
    expect(title.endsWith("…")).toBe(true);
  });
  it("falls back to a default for empty input", () => {
    expect(deriveGoalTitle("   ")).toBe("Novo pedido");
  });
});

const msg = (over: Partial<Message>): Message =>
  ({
    id: "m",
    companyId: "c",
    senderKind: "user",
    senderId: null,
    content: "x",
    kind: "message",
    createdAt: 0,
    ...over,
  }) as Message;

describe("scopeUserMessages", () => {
  it("keeps only messages at/after the cutoff", () => {
    const out = scopeUserMessages(
      [msg({ id: "a", createdAt: 5 }), msg({ id: "b", createdAt: 15 })],
      10,
    );
    expect(out.map((m) => m.id)).toEqual(["b"]);
  });
  it("drops delegation messages (threadParticipants without 'user')", () => {
    const out = scopeUserMessages(
      [
        msg({ id: "chat", createdAt: 20, threadParticipants: ["user", "ceo"] }),
        msg({ id: "deleg", createdAt: 20, threadParticipants: ["ceo", "worker"] }),
      ],
      10,
    );
    expect(out.map((m) => m.id)).toEqual(["chat"]);
  });
});
