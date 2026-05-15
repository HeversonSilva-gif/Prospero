import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";
import { StdioWireTransport } from "../src/transport/stdio-transport.js";

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

describe("StdioWireTransport", () => {
  it("delivers input chunks to the onData handler", async () => {
    const input = new PassThrough();
    const transport = new StdioWireTransport(input, new PassThrough());
    const received: string[] = [];
    transport.onData((chunk) => received.push(chunk));
    input.write("hello\n");
    await tick();
    expect(received).toEqual(["hello\n"]);
  });

  it("writes sent data to the output stream", async () => {
    const output = new PassThrough();
    const transport = new StdioWireTransport(new PassThrough(), output);
    let written = "";
    output.on("data", (chunk: Buffer) => {
      written += chunk.toString();
    });
    transport.send("world\n");
    await tick();
    expect(written).toBe("world\n");
  });

  it("fires onClose once when the input ends", async () => {
    const input = new PassThrough();
    const transport = new StdioWireTransport(input, new PassThrough());
    let closeCount = 0;
    transport.onClose(() => {
      closeCount += 1;
    });
    input.end();
    await tick();
    expect(closeCount).toBe(1);
  });
});
