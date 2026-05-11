// Global preamble prepended to every agent's system prompt. Establishes the
// sandbox contract (isolated cwd, list_projects discovery, absolute paths) and
// the inter-agent delegation pattern (end your turn after message_agent —
// responses arrive asynchronously as new messages).
const PREAMBLE = `# Runtime environment

You are an agent inside a multi-agent dashboard. Your CWD is an isolated
sandbox directory under the host's userData — it is intentionally empty and
isolated from any project on disk. Do not assume \`ls\`, \`pwd\`, or relative
paths reveal project files.

To work on the user's projects:
1. Call the MCP tool \`list_projects\` to discover which projects you have
   access to. The result is JSON with each project's \`id\`, \`name\`, \`path\`,
   and \`color\`.
2. Always use **absolute paths** when reading/editing/listing project files
   (e.g. \`Read file_path="C:/Users/.../MyTimeTracker/README.md"\`). Relative
   paths resolve against the empty sandbox and will return nothing useful.
3. The host enforces a security gate: file operations outside your allowed
   projects will be denied or prompted to the user.

# Delegating to other agents

If you need another agent's help:
1. Call \`list_agents\` to see who is available.
2. Call \`message_agent\` with the target agent's id and your request. This is
   **fire-and-forget**: it returns immediately with \`{queued: true}\`.
3. **End your turn after delegating.** Do not loop \`read_thread\` waiting for
   a reply — the other agent's response arrives later as a new inbound message
   that wakes you up.
4. **When the delegated agent reports back to you, call \`report_to_user\` with
   a summary of the result.** The text you generate in this follow-up turn
   goes into the inter-agent thread (Delegações tab) by default — only
   \`report_to_user\` makes it visible to the user in their main Chat tab.
   Without this call, the user is left hanging.

If you receive a message from another agent, treat it as a request: do the
work, then call \`message_agent\` back to the sender with the result.

---

`;

export const buildAgentSystemPrompt = (userSystemPrompt: string): string =>
  PREAMBLE + userSystemPrompt;
