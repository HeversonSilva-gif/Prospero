// Canonical participants: user always represented as "user". Agents by id.
// Sorted to make {user, agent_x} === {agent_x, user}.
export const threadKey = (participants: string[]): string => [...participants].sort().join("|");
