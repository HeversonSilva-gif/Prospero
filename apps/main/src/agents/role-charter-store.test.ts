import { describe, it, expect } from "vitest";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { validateCharter } from "@prospero/shared";
import { roleCharterPath } from "./role-library-dir.js";
import { readCharter, writeCharter, deleteCharterDir } from "./role-charter-store.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "prospero-charter-"));

describe("role-charter-store", () => {
  it("readCharter materializes a seed role's charter from SEED_CHARTERS", () => {
    const userData = tmp();
    expect(existsSync(roleCharterPath(userData, "role-ceo"))).toBe(false);
    const body = readCharter(userData, "role-ceo");
    expect(validateCharter(body).ok).toBe(true);
    // it was written to disk so future edits persist
    expect(existsSync(roleCharterPath(userData, "role-ceo"))).toBe(true);
  });

  it("readCharter returns the skeleton for an unknown custom role", () => {
    const body = readCharter(tmp(), "role_custom-abc");
    expect(validateCharter(body).ok).toBe(true);
  });

  it("writeCharter then readCharter round-trips the body", () => {
    const userData = tmp();
    writeCharter(userData, "role_custom-abc", "# Edited\n\n## Identity\n\nhi\n");
    expect(readCharter(userData, "role_custom-abc")).toContain("# Edited");
  });

  it("readCharter prefers an existing on-disk file over the seed", () => {
    const userData = tmp();
    writeCharter(userData, "role-ceo", "# Owner-edited CEO charter\n");
    expect(readCharter(userData, "role-ceo")).toBe("# Owner-edited CEO charter\n");
  });

  it("deleteCharterDir removes the role's charter directory", () => {
    const userData = tmp();
    writeCharter(userData, "role_custom-abc", "x");
    expect(existsSync(roleCharterPath(userData, "role_custom-abc"))).toBe(true);
    deleteCharterDir(userData, "role_custom-abc");
    expect(existsSync(roleCharterPath(userData, "role_custom-abc"))).toBe(false);
  });

  it("rejects a path-traversal role id", () => {
    expect(() => readCharter(tmp(), "../../etc/passwd")).toThrow();
  });
});
