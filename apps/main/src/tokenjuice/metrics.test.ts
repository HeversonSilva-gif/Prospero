import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { applyMigrations } from "../db/migrations.js";
import { recordToolOutputMetrics } from "./metrics.js";
import { processToolResult } from "./index.js";

describe("metrics", () => {
  it("records a metric row", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    recordToolOutputMetrics(
      { db, companyId: "co_1", agentId: "ag_1" },
      {
        toolName: "isa_read",
        rawChars: 5000,
        reducedChars: 800,
        estTokensSaved: 1050,
        mode: "json",
        clamped: true,
      },
    );
    const row = db.prepare("SELECT * FROM tool_output_metrics").get() as {
      tool_name: string;
      clamped: number;
      est_tokens_saved: number;
    };
    expect(row.tool_name).toBe("isa_read");
    expect(row.clamped).toBe(1);
    expect(row.est_tokens_saved).toBe(1050);
  });

  it("never throws if the table is missing", () => {
    const db = new Database(":memory:"); // no migrations applied
    expect(() =>
      recordToolOutputMetrics(
        { db, companyId: "c", agentId: "a" },
        {
          toolName: "x",
          rawChars: 1,
          reducedChars: 1,
          estTokensSaved: 0,
          mode: "passthrough",
          clamped: false,
        },
      ),
    ).not.toThrow();
  });

  it("processToolResult compresses and records in one call", () => {
    const db = new Database(":memory:");
    applyMigrations(db);
    const big = JSON.stringify({
      items: Array.from({ length: 5000 }, (_, i) => ({ i, s: "z".repeat(40) })),
    });
    const text = processToolResult({
      toolName: "list_goals",
      result: big,
      ctx: { db, companyId: "c", agentId: "a" },
    });
    expect(text.length).toBeLessThan(big.length);
    expect(() => JSON.parse(text) as unknown).not.toThrow();
    const countRow = db.prepare("SELECT COUNT(*) AS n FROM tool_output_metrics").get() as {
      n: number;
    };
    expect(countRow.n).toBe(1);
  });
});
