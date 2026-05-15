import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { resolveWorkspaceCwd } from "../src/settings/workspace.js";

describe("resolveWorkspaceCwd", () => {
  it("returns provided path when set, creates dir if missing", () => {
    const tmp = mkdtempSync(join(tmpdir(), "ws-test-"));
    const target = join(tmp, "nested", "ws");
    expect(existsSync(target)).toBe(false);
    const out = resolveWorkspaceCwd(target);
    expect(out).toBe(target);
    expect(existsSync(target)).toBe(true);
    rmSync(tmp, { recursive: true, force: true });
  });

  it("returns default when null + creates default dir", () => {
    const out = resolveWorkspaceCwd(null);
    expect(out).toBe(join(homedir(), "Prospero-Workspace"));
    expect(existsSync(out)).toBe(true);
  });

  it("returns default when empty string", () => {
    const out = resolveWorkspaceCwd("");
    expect(out).toBe(join(homedir(), "Prospero-Workspace"));
  });
});
