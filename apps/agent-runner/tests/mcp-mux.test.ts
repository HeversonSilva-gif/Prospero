import { describe, expect, it } from "vitest";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { createMcpListener } from "../src/mcp-mux.js";

type Notification = { method: string; params: unknown };

// Poll until a predicate holds — TCP socket events go through libuv I/O, so a
// single microtask/immediate tick is not enough to observe them.
const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 100; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("waitFor: timed out");
};

describe("createMcpListener", () => {
  it("emits mcp-open on connect and mcp-data per line from the bridge", async () => {
    const notifications: Notification[] = [];
    const listener = await createMcpListener("agent_1", {
      notify: (method, params) => notifications.push({ method, params }),
    });
    const client: Socket = connect(listener.port, "127.0.0.1");
    await once(client, "connect");
    client.write('{"jsonrpc":"2.0","id":1}\n');
    await waitFor(() => notifications.some((n) => n.method === "mcp-data"));
    expect(notifications).toContainEqual({ method: "mcp-open", params: { agentId: "agent_1" } });
    expect(notifications).toContainEqual({
      method: "mcp-data",
      params: { agentId: "agent_1", line: '{"jsonrpc":"2.0","id":1}' },
    });
    client.destroy();
    listener.close();
  });

  it("writes host data into the connected bridge", async () => {
    const listener = await createMcpListener("agent_2", { notify: () => {} });
    const client: Socket = connect(listener.port, "127.0.0.1");
    await once(client, "connect");
    client.setEncoding("utf8");
    listener.writeToBridge('{"jsonrpc":"2.0","result":{}}\n');
    const [chunk] = (await once(client, "data")) as [string];
    expect(chunk).toBe('{"jsonrpc":"2.0","result":{}}\n');
    client.destroy();
    listener.close();
  });

  it("emits mcp-close when the bridge disconnects", async () => {
    const notifications: Notification[] = [];
    const listener = await createMcpListener("agent_3", {
      notify: (method, params) => notifications.push({ method, params }),
    });
    const client: Socket = connect(listener.port, "127.0.0.1");
    await once(client, "connect");
    client.destroy();
    await waitFor(() => notifications.some((n) => n.method === "mcp-close"));
    expect(notifications).toContainEqual({ method: "mcp-close", params: { agentId: "agent_3" } });
    listener.close();
  });
});
