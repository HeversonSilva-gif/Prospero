import { createServer, type Socket } from "node:net";
import { LineFramer } from "@prospero/shared";

export type McpListener = {
  /** The 127.0.0.1 port the agent's mcp-bridge connects to. */
  readonly port: number;
  /** Write one MCP JSON-RPC line from the host into the bridge. */
  writeToBridge(line: string): void;
  /** Stop accepting connections and close the channel. */
  close(): void;
};

export type McpListenerDeps = {
  notify: (method: string, params: unknown) => void;
};

/**
 * Starts a loopback TCP server for one agent's mcp-bridge. On connect it emits
 * `mcp-open`; each line the bridge sends becomes an `mcp-data` notification;
 * disconnect emits `mcp-close`. The returned promise resolves once the server
 * is listening, so the caller has the port for the agent's mcp.json.
 */
export const createMcpListener = (agentId: string, deps: McpListenerDeps): Promise<McpListener> => {
  return new Promise((resolve) => {
    let bridge: Socket | null = null;
    const framer = new LineFramer();
    const server = createServer((socket) => {
      bridge = socket;
      deps.notify("mcp-open", { agentId });
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => {
        for (const line of framer.push(chunk)) deps.notify("mcp-data", { agentId, line });
      });
      socket.on("close", () => {
        bridge = null;
        deps.notify("mcp-close", { agentId });
      });
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        port,
        writeToBridge: (line) => {
          bridge?.write(line);
        },
        close: () => {
          bridge?.destroy();
          server.close();
        },
      });
    });
  });
};
