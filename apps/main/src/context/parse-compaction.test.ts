import { describe, it, expect } from "vitest";
import { parseCompactionOutput } from "./parse-compaction.js";

describe("parseCompactionOutput", () => {
  it("parses knowledge + taskState", () => {
    const raw = JSON.stringify({
      knowledge: [
        { section: "architecture", body: "Electron monorepo.", source_files: ["package.json"] },
      ],
      taskState: "Working on BACKEND-7; tests next.",
    });
    const out = parseCompactionOutput(raw);
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.knowledge[0]?.section).toBe("architecture");
    expect(out.knowledge[0]?.sourceFiles).toEqual(["package.json"]);
    expect(out.taskState).toContain("BACKEND-7");
  });

  it("tolerates surrounding prose / code fences", () => {
    const raw = "Here:\n```json\n" + JSON.stringify({ knowledge: [], taskState: "idle" }) + "\n```";
    expect(parseCompactionOutput(raw).kind).toBe("ok");
  });

  it("drops knowledge items with an invalid section", () => {
    const raw = JSON.stringify({
      knowledge: [{ section: "nope", body: "x", source_files: [] }],
      taskState: "t",
    });
    const out = parseCompactionOutput(raw);
    if (out.kind !== "ok") throw new Error("expected ok");
    expect(out.knowledge).toHaveLength(0);
  });

  it("returns discard on unparseable input", () => {
    expect(parseCompactionOutput("not json").kind).toBe("discard");
  });
});
