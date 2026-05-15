import type { WireTransport } from "@prospero/shared";

/**
 * The minimal slice of a spawned child this transport drives. A real
 * node:child_process.ChildProcess is structurally assignable to it.
 */
export type TransportChild = {
  readonly stdin: NodeJS.WritableStream | null;
  readonly stdout: NodeJS.ReadableStream | null;
  on(event: "exit", listener: (code: number | null) => void): void;
};

/**
 * WireTransport over a spawned child's stdio — the host side of the SSH/docker
 * pipe. Mirrors the runner's StdioWireTransport but reads the child's stdout
 * and writes its stdin instead of the process's own. Close fires on child exit.
 */
export class ChildProcessWireTransport implements WireTransport {
  private readonly child: TransportChild;
  private dataHandler: ((chunk: string) => void) | undefined;
  private closeHandler: (() => void) | undefined;
  private closed = false;

  constructor(child: TransportChild) {
    this.child = child;
    child.stdout?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => this.dataHandler?.(chunk));
    child.on("exit", () => this.fireClose());
  }

  send(data: string): void {
    this.child.stdin?.write(data);
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
