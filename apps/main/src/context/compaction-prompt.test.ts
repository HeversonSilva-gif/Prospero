import { describe, it, expect } from "vitest";
import { buildCompactionPrompt } from "./compaction-prompt.js";

describe("buildCompactionPrompt", () => {
  it("asks for the JSON split and includes the transcript", () => {
    const p = buildCompactionPrompt("AGENT read foo.ts ... did X");
    expect(p).toContain("did X");
    expect(p).toContain('"knowledge"');
    expect(p).toContain('"taskState"');
    expect(p.toLowerCase()).toContain("source_files");
  });
});
