import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";

// Test-only stub that mimics the surface of node:child_process.ChildProcess
// the adapter uses (stdin Writable, stdout Readable, stderr Readable, on,
// kill, pid, killed, exitCode). Used when DASHBOARD_AGENT_E2E_FAKE_CLAUDE=1
// is set so the E2E suite never hits the real Anthropic API.

export class FakeClaude extends EventEmitter {
  public readonly pid = 99_999;
  public killed = false;
  public exitCode: number | null = null;

  public readonly stdin: Writable;
  public readonly stdout: Readable;
  public readonly stderr: Readable;

  constructor() {
    super();
    this.stdin = new Writable({
      write: (chunk: Buffer | string, _enc, cb) => {
        const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
        this.replyToInput(text);
        cb();
      },
    });
    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });

    setTimeout(() => {
      this.stdout.push(
        JSON.stringify({
          type: "system",
          subtype: "init",
          session_id: "00000000-0000-0000-0000-000000000001",
        }) + "\n",
      );
      this.emit("spawn");
    }, 30);
  }

  private replyToInput(jsonl: string): void {
    for (const line of jsonl.split("\n")) {
      if (line.trim() === "") continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      const text =
        (parsed as { message?: { content?: { text?: string }[] } }).message?.content?.[0]?.text ??
        "";

      setTimeout(() => {
        if (/hire/i.test(text)) {
          this.stdout.push(
            JSON.stringify({
              type: "assistant",
              message: {
                content: [
                  {
                    type: "tool_use",
                    id: "tool_h1",
                    name: "mcp__dashboard__hire_agent",
                    input: { name: "Alex", role_template_id: "role_backend_engineer" },
                  },
                ],
              },
            }) + "\n",
          );
          this.stdout.push(
            JSON.stringify({
              type: "user",
              message: {
                content: [
                  {
                    type: "tool_result",
                    tool_use_id: "tool_h1",
                    content: '{"ok":true,"agentId":"agent_alex"}',
                  },
                ],
              },
            }) + "\n",
          );
          this.stdout.push(
            JSON.stringify({
              type: "assistant",
              message: { content: [{ type: "text", text: "Hired Alex." }] },
            }) + "\n",
          );
        } else {
          this.stdout.push(
            JSON.stringify({
              type: "assistant",
              message: { content: [{ type: "text", text: "Acknowledged." }] },
            }) + "\n",
          );
        }
        this.stdout.push(JSON.stringify({ type: "result", subtype: "success" }) + "\n");
      }, 30);
    }
  }

  kill(): void {
    if (this.killed) return;
    this.killed = true;
    this.exitCode = 0;
    setImmediate(() => this.emit("exit", 0, null));
  }
}

export const isFakeClaudeEnabled = (): boolean =>
  process.env["DASHBOARD_AGENT_E2E_FAKE_CLAUDE"] === "1";
