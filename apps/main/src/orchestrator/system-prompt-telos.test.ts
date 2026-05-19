import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildTelosBlock } from "./system-prompt-telos.js";
import { writeTelos } from "../companies/telos-store.js";

const tmps: string[] = [];
const newTmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "telos-block-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("buildTelosBlock", () => {
  it("returns undefined when the company has no TELOS", () => {
    const root = newTmp();
    expect(
      buildTelosBlock({ userDataDir: root, companyId: "c1", agentRole: "ceo" }),
    ).toBeUndefined();
  });

  it("gives the CEO the full TELOS body", () => {
    const root = newTmp();
    writeTelos(root, "c1", "# Company TELOS\n\n## Mission\n\nShip launch pages.");
    const block = buildTelosBlock({ userDataDir: root, companyId: "c1", agentRole: "ceo" });
    expect(block).toBeDefined();
    expect(block!).toContain("Ship launch pages.");
  });

  it("gives a non-CEO agent a 1-line pointer, not the body", () => {
    const root = newTmp();
    writeTelos(root, "c1", "# Company TELOS\n\n## Mission\n\nShip launch pages.");
    const block = buildTelosBlock({ userDataDir: root, companyId: "c1", agentRole: "engineer" });
    expect(block).toBeDefined();
    expect(block!).not.toContain("Ship launch pages.");
    expect(block!).toContain("telos_read");
  });
});
