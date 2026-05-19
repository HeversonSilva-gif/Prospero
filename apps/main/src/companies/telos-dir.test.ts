import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getCompanyDir,
  companyTelosPath,
  relativeTelosPath,
  assertSafePathSegment,
} from "./telos-dir.js";

const tmps: string[] = [];
const newTmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "telos-dir-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("telos-dir", () => {
  it("getCompanyDir creates the company directory", () => {
    const root = newTmp();
    const dir = getCompanyDir(root, "company_1");
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(root, "companies", "company_1"));
  });

  it("companyTelosPath points at telos.md inside the company directory", () => {
    expect(companyTelosPath("/fake/root", "company_1")).toBe(
      join("/fake/root", "companies", "company_1", "telos.md"),
    );
  });

  it("relativeTelosPath is a stable forward-slash relative string", () => {
    expect(relativeTelosPath("company_1")).toBe("companies/company_1/telos.md");
  });

  it("assertSafePathSegment rejects path traversal", () => {
    expect(() => assertSafePathSegment("..", "company id")).toThrow(/unsafe company id/);
    expect(() => assertSafePathSegment("a/b", "company id")).toThrow();
    expect(() => assertSafePathSegment("a\\b", "company id")).toThrow();
    expect(() => assertSafePathSegment("", "company id")).toThrow();
    expect(() => assertSafePathSegment("company_1", "company id")).not.toThrow();
  });

  it("companyTelosPath rejects an unsafe company id", () => {
    expect(() => companyTelosPath("/fake/root", "../escape")).toThrow();
  });
});
