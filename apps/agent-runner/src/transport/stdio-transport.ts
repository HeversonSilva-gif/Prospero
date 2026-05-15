import type { Readable, Writable } from "node:stream";
import type { WireTransport } from "@prospero/shared";

/**
 * WireTransport over a Readable/Writable pair — `process.stdin`/`process.stdout`
 * in production, in-memory streams in tests. The wire protocol is the only
 * thing on this channel; the runner's own diagnostics go to stderr separately.
 */
export class StdioWireTransport implements WireTransport {
  private readonly output: Writable;
  private dataHandler: ((chunk: string) => void) | undefined;
  private closeHandler: (() => void) | undefined;
  private closed = false;

  constructor(input: Readable = process.stdin, output: Writable = process.stdout) {
    this.output = output;
    input.setEncoding("utf8");
    input.on("data", (chunk: string) => this.dataHandler?.(chunk));
    input.on("end", () => this.fireClose());
    input.on("close", () => this.fireClose());
  }

  send(data: string): void {
    this.output.write(data);
  }

  onData(handler: (chunk: string) => void): void {
    this.dataHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  private fireClose(): void {
    if (this.closed) return;
    this.closed = true;
    this.closeHandler?.();
  }
}
