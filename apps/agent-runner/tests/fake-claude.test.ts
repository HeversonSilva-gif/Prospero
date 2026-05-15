import { describe, expect, it } from "vitest";
import { FakeClaude } from "./fake-claude.js";

describe("FakeClaude", () => {
  it("captures what is written to stdin", () => {
    const fake = new FakeClaude();
    fake.stdin.write("a line\n");
    expect(fake.stdinWrites).toEqual(["a line\n"]);
  });

  it("emits stdout chunks pushed by the test", async () => {
    const fake = new FakeClaude();
    const got = new Promise<string>((resolve) => {
      fake.stdout.on("data", (c: Buffer) => resolve(c.toString()));
    });
    fake.emitStdout("hello\n");
    expect(await got).toBe("hello\n");
  });

  it("emits exit and marks killed when killed", async () => {
    const fake = new FakeClaude();
    const code = await new Promise<number | null>((resolve) => {
      fake.on("exit", (c: number | null) => resolve(c));
      fake.kill();
    });
    expect(code).toBe(0);
    expect(fake.killed).toBe(true);
  });
});
