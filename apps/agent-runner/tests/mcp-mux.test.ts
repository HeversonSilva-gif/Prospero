import { describe, expect, it } from "vitest";
import { connect, type Socket } from "node:net";
import { once } from "node:events";
import { createMcpListener } from "../src/mcp-mux.js";

type Notification = { method: string; params: unknown };

// Generous per-test timeout: these exercise REAL loopback TCP sockets, and a
// contended CI runner (notably macOS) can occasionally take seconds to deliver a
// loopback round-trip — well past vitest's 5s default. 15s absorbs that jitter
// without masking a real hang.
const SOCKET_TIMEOUT_MS = 15_000;

// Poll until a predicate holds — TCP socket events go through libuv I/O, so a
// single microtask/immediate tick is not enough to observe them. Budget ~10s so a
// slow CI runner has headroom (it returns as soon as the predicate holds).
const waitFor = async (predicate: () => boolean): Promise<void> => {
  for (let i = 0; i < 1000; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("waitFor: timed out");
};

describe("createMcpListener", () => {
  it(
    "emits mcp-open on connect and mcp-data per line from the bridge",
    async () => {
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
    },
    SOCKET_TIMEOUT_MS,
  );

  it(
    "writes host data into the connected bridge",
    async () => {
      let opened = false;
      const listener = await createMcpListener("agent_2", {
        notify: (method) => {
          if (method === "mcp-open") opened = true;
        },
      });
      const client: Socket = connect(listener.port, "127.0.0.1");
      await once(client, "connect");
      client.setEncoding("utf8");
      // Wait until the SERVER has accepted + registered the bridge socket (mcp-open)
      // before writing. The client-side "connect" event can fire before the server's
      // connection handler runs, which would leave writeToBridge with a null bridge —
      // the write is silently dropped and the client never receives "data". That race
      // is benign on Linux/Windows but hung the test on the macOS CI runner.
      await waitFor(() => opened);
      listener.writeToBridge('{"jsonrpc":"2.0","result":{}}\n');
      const [chunk] = (await once(client, "data")) as [string];
      expect(chunk).toBe('{"jsonrpc":"2.0","result":{}}\n');
      client.destroy();
      listener.close();
    },
    SOCKET_TIMEOUT_MS,
  );

  it(
    "emits mcp-close when the bridge disconnects",
    async () => {
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
    },
    SOCKET_TIMEOUT_MS,
  );
});
