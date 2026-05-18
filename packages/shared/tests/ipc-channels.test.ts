import { describe, expect, it } from "vitest";
import { IPC } from "../src/ipc-channels.js";

describe("IPC channels", () => {
  it("exposes a 'ping' channel", () => {
    expect(IPC.PING).toBe("ping");
  });

  it("channel names are unique", () => {
    const values = Object.values(IPC);
    expect(new Set(values).size).toBe(values.length);
  });

  it("channel names use lowercase-kebab-case namespacing", () => {
    for (const v of Object.values(IPC)) {
      expect(v).toMatch(/^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*$/);
    }
  });

  it("exposes M7 PR-C agent mutation channels", () => {
    expect(IPC.AGENTS_SET_MODEL).toBe("agents:set-model");
    expect(IPC.AGENTS_SET_ROLE).toBe("agents:set-role");
    expect(IPC.AGENTS_SET_SYSTEM_PROMPT).toBe("agents:set-system-prompt");
    expect(IPC.AGENTS_SET_REPORTS_TO).toBe("agents:set-reports-to");
    expect(IPC.AGENTS_STATS).toBe("agents:stats");
  });

  it("exposes the M11 learning channels", () => {
    expect(IPC.SKILLS_LIST_FOR_AGENT).toBe("skills:list-for-agent");
    expect(IPC.SKILLS_READ_BODY).toBe("skills:read-body");
    expect(IPC.MEMORIES_LIST_FOR_AGENT).toBe("memories:list-for-agent");
    expect(IPC.SESSION_SEARCH).toBe("session:search");
  });

  it("exposes the M11 skill-candidate channels", () => {
    expect(IPC.SKILL_CANDIDATES_LIST_FOR_AGENT).toBe("skill-candidates:list-for-agent");
    expect(IPC.SKILL_CANDIDATE_ACCEPT).toBe("skill-candidates:accept");
    expect(IPC.SKILL_CANDIDATE_REJECT).toBe("skill-candidates:reject");
  });

  it("exposes the M11 skill-promote-approve channel", () => {
    expect(IPC.SKILL_PROMOTE_APPROVE).toBe("skills:promote-approve");
  });

  it("exposes the M11 org-learnings channel", () => {
    expect(IPC.LEARNING_ORG).toBe("learning:org-learnings");
  });

  it("exposes the M11 trust-feedback channels", () => {
    expect(IPC.LEARNING_RATE_SKILL).toBe("learning:rate-skill");
    expect(IPC.LEARNING_RATE_MEMORY).toBe("learning:rate-memory");
  });

  it("exposes the M11 user-memory channels", () => {
    expect(IPC.MEMORY_USER_GET).toBe("memory:user-get");
    expect(IPC.MEMORY_USER_SET).toBe("memory:user-set");
    expect(IPC.MEMORY_USER_IMPORT_CC).toBe("memory:user-import-cc");
  });
});
