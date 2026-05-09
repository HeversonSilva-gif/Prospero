import { describe, expect, it } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { openDatabase } from "../src/db/client.js";

describe("openDatabase", () => {
  it("creates a new file and returns an open Database", () => {
    const dir = mkdtempSync(join(tmpdir(), "da-test-"));
    try {
      const db = openDatabase(join(dir, "test.db"));
      expect(db.open).toBe(true);
      const ver = db.pragma("user_version", { simple: true });
      expect(typeof ver).toBe("number");
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
