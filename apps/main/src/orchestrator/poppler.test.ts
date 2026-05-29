import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolvePopplerBinDir, __resetPopplerCache } from "./poppler.js";

const exe = process.platform === "win32" ? "pdftoppm.exe" : "pdftoppm";

describe("resolvePopplerBinDir", () => {
  beforeEach(() => __resetPopplerCache());

  it("finds pdftoppm nested at poppler-<ver>/Library/bin (poppler-windows layout)", () => {
    const root = mkdtempSync(join(tmpdir(), "pop-"));
    const bin = join(root, "resources", "poppler", "poppler-24.0", "Library", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, exe), "stub");
    expect(resolvePopplerBinDir({ devRoot: root })).toBe(bin);
  });

  it("finds pdftoppm directly in resources/poppler", () => {
    const root = mkdtempSync(join(tmpdir(), "pop-"));
    const dir = join(root, "resources", "poppler");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, exe), "stub");
    expect(resolvePopplerBinDir({ devRoot: root })).toBe(dir);
  });

  it("returns null when Poppler is not bundled", () => {
    const root = mkdtempSync(join(tmpdir(), "pop-"));
    expect(resolvePopplerBinDir({ devRoot: root, resourcesPath: join(root, "nope") })).toBeNull();
  });

  it("prefers the packaged resourcesPath over the dev root", () => {
    const root = mkdtempSync(join(tmpdir(), "pop-"));
    const res = join(root, "res");
    const bin = join(res, "poppler", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, exe), "stub");
    expect(resolvePopplerBinDir({ resourcesPath: res, devRoot: root })).toBe(bin);
  });
});
