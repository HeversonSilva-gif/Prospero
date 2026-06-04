// Per-tool output shapers (Fase 2): a shaper receives the parsed JSON of a tool
// result and returns a leaner object, re-stringified before the generic clamp.
// Populated from the offenders surfaced in tool_output_metrics — `read_thread`
// dominated real usage (avg 24k, max 100k chars), so it gets a structural
// shaper that keeps the recent conversation intact instead of the blunt clamp.
export type Shaper = (parsed: unknown, toolName: string) => unknown;
export const shapers: Map<string, Shaper> = new Map();

// How many of the newest messages to keep verbatim.
const READ_THREAD_RECENT = 15;

// Shapes a `read_thread` result ({ messages: [...] }, OLDEST-first). Keeps the
// most recent READ_THREAD_RECENT messages verbatim and drops the older ones,
// replacing them with a single head sentinel that says how many were omitted.
//
// Why drop rather than preview the old ones: the generic clamp (the backstop
// when this is still over budget) caps arrays by keeping their HEAD. With an
// oldest-first thread, previewing the old messages would leave a big array whose
// head the clamp keeps — dropping exactly the recent tail the agent needs. By
// shrinking the array to RECENT+1 here, the clamp never reorders it and the
// recent conversation survives. The agent can re-read older history with {since}.
// Anything that isn't a thread shape is returned unchanged (the format may drift).
export const shapeReadThread = (parsed: unknown): unknown => {
  if (parsed === null || typeof parsed !== "object") return parsed;
  const obj = parsed as { messages?: unknown };
  if (!Array.isArray(obj.messages)) return parsed;
  const messages = obj.messages as unknown[];
  if (messages.length <= READ_THREAD_RECENT) return parsed;

  const recent = messages.slice(-READ_THREAD_RECENT);
  const omitted = messages.length - recent.length;
  const sentinel = {
    omitted_older_messages: omitted,
    note: `${String(omitted)} older messages omitted to save tokens — call read_thread with {since:<timestamp>} to read them`,
  };
  return { ...obj, messages: [sentinel, ...recent] };
};

shapers.set("read_thread", shapeReadThread);
