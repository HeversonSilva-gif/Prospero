import { DIGEST_SECTIONS } from "@prospero/shared";

// One-shot prompt: distill a session transcript into (a) durable project
// knowledge to fold into the shared digest, and (b) the current task state to
// seed the agent's next (fresh) session. Output is strict JSON so the parser
// is robust. Keep the agent's voice OUT — these are facts, not chatter.
export const buildCompactionPrompt = (transcript: string): string => `
You are compacting an AI agent's working session to cut token cost without losing
what matters. Read the transcript and produce STRICT JSON with two keys.

"knowledge": an array of durable facts about THE PROJECT/CODEBASE that would let
a future agent skip re-reading files. Each item:
  { "section": one of ${JSON.stringify(DIGEST_SECTIONS)},
    "body": one concise sentence (a fact, no preamble),
    "source_files": repo-relative paths this fact came from }
Only include facts grounded in files actually read this session. No speculation.
If nothing durable was learned, use an empty array.

"taskState": a short plain-text summary (<= 1500 chars) of WHERE THE WORK IS:
the current goal/issue, what is done, what is next, any open decision. This seeds
the agent's next turn so it does not lose the thread. Do NOT restate project facts
here (those go in "knowledge").

Output ONLY the JSON object, nothing else.

--- TRANSCRIPT START ---
${transcript}
--- TRANSCRIPT END ---
`;
