import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { redactSensitive, rotatingAppend, safeAppend } from "./safe-log.js";

describe("redactSensitive", () => {
  it("replaces the home directory with ~ (Windows-style path)", () => {
    const out = redactSensitive("opened C:\\Users\\hever\\AppData\\db.sqlite", {
      homeDir: "C:\\Users\\hever",
    });
    expect(out).toBe("opened ~\\AppData\\db.sqlite");
  });

  it("replaces the home directory regardless of separator", () => {
    const out = redactSensitive("path /home/hever/project/file", {
      homeDir: "/home/hever",
    });
    expect(out).toBe("path ~/project/file");
  });

  it("redacts credential-shaped substrings", () => {
    const out = redactSensitive("token sk-ant-oat-FAKE_SECRET_TOKEN_VALUE", { homeDir: "" });
    expect(out).toContain("[REDACTED]");
    expect(out).not.toContain("FAKE_SECRET_TOKEN_VALUE");
  });

  it("leaves a benign line unchanged", () => {
    const benign = "spawn event fired pid=1234";
    expect(redactSensitive(benign, { homeDir: "C:\\Users\\hever" })).toBe(benign);
  });
});

describe("rotatingAppend", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "safe-log-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("appends a line with a trailing newline", () => {
    const f = join(dir, "out.log");
    rotatingAppend(f, "hello");
    expect(readFileSync(f, "utf8")).toBe("hello\n");
  });

  it("rotates to .1 once the file exceeds maxBytes", () => {
    const f = join(dir, "out.log");
    // Pre-fill past the tiny cap.
    writeFileSync(f, "x".repeat(50), "utf8");
    rotatingAppend(f, "fresh", { maxBytes: 10 });
    expect(existsSync(f + ".1")).toBe(true);
    expect(readFileSync(f, "utf8")).toBe("fresh\n");
    // The main file is now smaller than the rotated one.
    expect(statSync(f).size).toBeLessThan(statSync(f + ".1").size);
  });

  it("never throws on a bad path", () => {
    expect(() => rotatingAppend("\0:/nope/\0/bad.log", "line")).not.toThrow();
  });
});

describe("safeAppend", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "safe-log-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("redacts before writing", () => {
    const f = join(dir, "out.log");
    safeAppend(f, "key sk-ant-oat-FAKE_SECRET_TOKEN_VALUE done", { homeDir: "" });
    const content = readFileSync(f, "utf8");
    expect(content).toContain("[REDACTED]");
    expect(content).not.toContain("FAKE_SECRET_TOKEN_VALUE");
  });
});
