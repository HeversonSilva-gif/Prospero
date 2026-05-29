import { describe, it, expect } from "vitest";
import {
  buildIssuePrompt,
  buildRetrospectivePrompt,
  buildVerificationFailedPrompt,
} from "./prompts.js";
import type { IssueTrail, GoalTrail } from "./trail.js";

const trailWithCriteria = (): IssueTrail => ({
  issueId: "i1",
  identifier: "X-1",
  title: "Add the search bar",
  description: "Add a debounced search input above the list.",
  comments: [],
  criteria: [
    { statement: "build passes", kind: "deterministic", status: "passed", attempts: 3 },
    { statement: "design review approves", kind: "judgment", status: "passed", attempts: 1 },
  ],
});

const trailWithoutCriteria = (): IssueTrail => ({
  issueId: "i1",
  identifier: "X-1",
  title: "Add the search bar",
  description: "Add a debounced search input above the list.",
  comments: [],
  criteria: [],
});

describe("buildIssuePrompt with criteria", () => {
  it("renders a criteria section that names attempts and status when present", () => {
    const prompt = buildIssuePrompt(trailWithCriteria());
    expect(prompt).toMatch(/build passes/);
    expect(prompt).toMatch(/3 attempts|after 3|3×|attempts: 3/);
  });

  it("omits the criteria section entirely when the issue has no ISCs", () => {
    const prompt = buildIssuePrompt(trailWithoutCriteria());
    expect(prompt).not.toContain("## Criteria status");
  });
});

describe("buildRetrospectivePrompt with criteria", () => {
  it("renders the criteria summary in the retrospective", () => {
    const trail: GoalTrail = {
      title: "Ship the search feature",
      description: "Users can search the list.",
      successCriteria: "x",
      issues: [{ title: "Add the search bar", status: "done" }],
      criteria: [
        { statement: "build passes", kind: "deterministic", status: "passed", attempts: 3 },
      ],
    };
    const prompt = buildRetrospectivePrompt(trail);
    expect(prompt).toMatch(/build passes/);
    expect(prompt).toMatch(/3/);
  });
});

describe("buildVerificationFailedPrompt", () => {
  it("asks for a skill (name+description+body), not a bare memory body", () => {
    const trail = {
      goalId: "g1",
      goalTitle: "Ship X",
      goalDescription: "users can ship a release",
      failed: [
        {
          statement: "build passes",
          kind: "deterministic" as const,
          attempts: 2,
          lastDetail: "tsc error",
        },
      ],
    };
    const p = buildVerificationFailedPrompt(trail);
    expect(p).toContain("name");
    expect(p).toContain("description");
    expect(p).toContain("body");
    // Must use the SKILL contract (name+description+body) not the bare memory contract (body-only).
    // The skill contract asks for kebab-case-skill-name; memory contract does not.
    expect(p).toContain("kebab-case-skill-name");
  });

  it("names the goal and each failed criterion with attempts and last detail", () => {
    const prompt = buildVerificationFailedPrompt({
      goalId: "g1",
      goalTitle: "Ship X",
      goalDescription: "users can do Y",
      failed: [
        {
          statement: "build passes",
          kind: "deterministic",
          attempts: 3,
          lastDetail: "exit 1: tsc found 2 errors",
        },
      ],
    });
    expect(prompt).toMatch(/Ship X/);
    expect(prompt).toMatch(/build passes/);
    expect(prompt).toMatch(/3/);
    expect(prompt).toMatch(/tsc found 2 errors/);
  });

  it("uses 'failed' (no attempt count) when attempts is 0 — judgment criteria never increment", () => {
    const prompt = buildVerificationFailedPrompt({
      goalId: "g1",
      goalTitle: "Ship X",
      goalDescription: "users can do Y",
      failed: [
        {
          statement: "on brand",
          kind: "judgment",
          attempts: 0,
          lastDetail: "",
        },
      ],
    });
    expect(prompt).toContain("on brand — failed");
    expect(prompt).not.toMatch(/after 0 attempts/);
  });

  it("uses 'failed on the first attempt' when attempts is 1", () => {
    const prompt = buildVerificationFailedPrompt({
      goalId: "g1",
      goalTitle: "Ship X",
      goalDescription: "users can do Y",
      failed: [
        {
          statement: "tests pass",
          kind: "deterministic",
          attempts: 1,
          lastDetail: "exit 1",
        },
      ],
    });
    expect(prompt).toContain("failed on the first attempt");
    expect(prompt).not.toMatch(/1 attempt[^s]/);
  });
});
