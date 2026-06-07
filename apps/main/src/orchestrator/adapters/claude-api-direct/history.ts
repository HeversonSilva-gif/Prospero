export type Turn = { role: "user" | "assistant"; text: string };
export type SdkMessage = { role: "user" | "assistant"; content: string };

// Keep the most-recent turns whose cumulative length fits `charBudget`, oldest-first.
// Bounded on purpose: a smaller reconstructed prefix is cheaper, and the durable
// knowledge lives in the digest (injected into the system prompt), not here.
export const reconstructMessages = (turns: Turn[], charBudget: number): SdkMessage[] => {
  const kept: Turn[] = [];
  let used = 0;
  for (let i = turns.length - 1; i >= 0; i--) {
    const t = turns[i];
    if (t === undefined) break; // noUncheckedIndexedAccess guard (i is always in range)
    if (used + t.text.length > charBudget) break;
    used += t.text.length;
    kept.unshift(t);
  }
  return kept.map((t) => ({ role: t.role, content: t.text }));
};
