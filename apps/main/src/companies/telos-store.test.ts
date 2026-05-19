import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readTelos, writeTelos, telosExists } from "./telos-store.js";

const tmps: string[] = [];
const newTmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "telos-store-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("telos-store", () => {
  it("readTelos returns null when no telos.md exists", () => {
    const root = newTmp();
    expect(readTelos(root, "company_1")).toBeNull();
    expect(telosExists(root, "company_1")).toBe(false);
  });

  it("writeTelos then readTelos round-trips the body", () => {
    const root = newTmp();
    writeTelos(root, "company_1", "# Company TELOS\n\n## Mission\n\nShip.");
    expect(readTelos(root, "company_1")).toBe("# Company TELOS\n\n## Mission\n\nShip.");
    expect(telosExists(root, "company_1")).toBe(true);
  });

  it("writeTelos creates the company directory if absent", () => {
    const root = newTmp();
    expect(() => writeTelos(root, "company_2", "x")).not.toThrow();
    expect(readTelos(root, "company_2")).toBe("x");
  });
});
