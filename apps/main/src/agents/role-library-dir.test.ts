import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getRoleLibraryDir,
  roleCharterDir,
  roleCharterPath,
  assertSafeRoleId,
} from "./role-library-dir.js";

const tmp = (): string => mkdtempSync(join(tmpdir(), "prospero-roles-"));

describe("role-library-dir", () => {
  it("getRoleLibraryDir nests role-library under userData", () => {
    const dir = getRoleLibraryDir(tmp());
    expect(dir.endsWith(join("role-library"))).toBe(true);
  });

  it("roleCharterPath resolves to <userData>/role-library/<id>/charter.md", () => {
    const userData = tmp();
    const path = roleCharterPath(userData, "role-ceo");
    expect(path).toBe(join(getRoleLibraryDir(userData), "role-ceo", "charter.md"));
  });

  it("roleCharterDir creates the directory", () => {
    const dir = roleCharterDir(tmp(), "role_abc-123");
    expect(dir.endsWith(join("role-library", "role_abc-123"))).toBe(true);
  });

  it("assertSafeRoleId accepts generated ids", () => {
    expect(() => assertSafeRoleId("role-ceo")).not.toThrow();
    expect(() => assertSafeRoleId("role_3f2a9c10-aaaa-bbbb-cccc-1234567890ab")).not.toThrow();
  });

  it("assertSafeRoleId rejects path-traversal and unexpected ids", () => {
    expect(() => assertSafeRoleId("../etc")).toThrow();
    expect(() => assertSafeRoleId("role-../x")).toThrow();
    expect(() => assertSafeRoleId("nope")).toThrow();
    expect(() => assertSafeRoleId("")).toThrow();
  });
});
