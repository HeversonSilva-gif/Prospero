import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { ChildProcessWireTransport, type TransportChild } from "./child-transport.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

// A fake child: two PassThrough streams plus an EventEmitter-backed exit event.
const makeFakeChild = (): {
  child: TransportChild;
  stdin: PassThrough;
  stdout: PassThrough;
  emitExit: () => void;
} => {
  const stdin = new PassThrough();
  const stdout = new PassThrough();
  const emitter = new EventEmitter();
  const child: TransportChild = {
    stdin,
    stdout,
    on: (event, listener) => {
      emitter.on(event, listener);
    },
  };
  return { child, stdin, stdout, emitExit: () => emitter.emit("exit", 0) };
};

describe("ChildProcessWireTransport", () => {
  it("delivers stdout chunks to the data handler", async () => {
    const { child, stdout } = makeFakeChild();
    const transport = new ChildProcessWireTransport(child);
    const received: string[] = [];
    transport.onData((chunk) => received.push(chunk));
    stdout.write("hello\n");
    await tick();
    expect(received).toEqual(["hello\n"]);
  });

  it("writes sent data to the child stdin", async () => {
    const { child, stdin } = makeFakeChild();
    const transport = new ChildProcessWireTransport(child);
    let written = "";
    stdin.on("data", (chunk: Buffer) => {
      written += chunk.toString();
    });
    transport.send("ping\n");
    await tick();
    expect(written).toBe("ping\n");
  });

  it("fires the close handler when the child exits", () => {
    const { child, emitExit } = makeFakeChild();
    const transport = new ChildProcessWireTransport(child);
    const onClose = vi.fn();
    transport.onClose(onClose);
    emitExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("fires the close handler at most once", () => {
    const { child, emitExit } = makeFakeChild();
    const transport = new ChildProcessWireTransport(child);
    const onClose = vi.fn();
    transport.onClose(onClose);
    emitExit();
    emitExit();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
