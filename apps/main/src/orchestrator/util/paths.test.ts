import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { shortAgentSlug, getAgentConfigDir, getAgentSandboxCwd } from "./paths.js";

describe("shortAgentSlug", () => {
  it("strips the agent_ prefix and dashes, taking the first 12 hex chars", () => {
    expect(shortAgentSlug("agent_2754ee4b-0121-4b84-a3a0-47673d37493f")).toBe("2754ee4b0121");
  });

  it("is deterministic — same id maps to the same slug", () => {
    const id = "agent_d9de0a69-f74b-4b47-9efa-caa7b0818312";
    expect(shortAgentSlug(id)).toBe(shortAgentSlug(id));
  });

  it("distinct agent uuids map to distinct slugs", () => {
    const a = shortAgentSlug("agent_2754ee4b-0121-4b84-a3a0-47673d37493f");
    const b = shortAgentSlug("agent_d9de0a69-f74b-4b47-9efa-caa7b0818312");
    expect(a).not.toBe(b);
  });

  it("handles an id without the agent_ prefix", () => {
    expect(shortAgentSlug("d9de0a69-f74b-4b47")).toBe("d9de0a69f74b");
  });

  it("produces a slug of only lowercase hex chars", () => {
    expect(shortAgentSlug("agent_2754ee4b-0121-4b84-a3a0-47673d37493f")).toMatch(
      /^[a-f0-9]{1,12}$/,
    );
  });
});

describe("sandbox layout (short sbx/<slug>)", () => {
  const UD = "/ud";
  const ID = "agent_2754ee4b-0121-4b84-a3a0-47673d37493f";

  it("config dir is <userData>/sbx/<slug>", () => {
    expect(getAgentConfigDir(UD, ID)).toBe(join(UD, "sbx", "2754ee4b0121"));
  });

  it("cwd is <userData>/sbx/<slug>/c", () => {
    expect(getAgentSandboxCwd(UD, ID)).toBe(join(UD, "sbx", "2754ee4b0121", "c"));
  });

  it("cwd is nested under the config dir (so the whole tree is one system zone)", () => {
    expect(getAgentSandboxCwd(UD, ID).startsWith(getAgentConfigDir(UD, ID))).toBe(true);
  });
});
