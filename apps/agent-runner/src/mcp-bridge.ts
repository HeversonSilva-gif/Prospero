import { connect } from "node:net";

// claude spawns this as its `dashboard` MCP server (see the mcp.json the runner
// writes). It is a dumb relay: claude's MCP stdio is piped to a loopback TCP
// socket the runner is listening on, and back. The runner muxes that traffic
// onto the wire protocol. This file is an entry point — it has no exports and
// is verified by the PR-E Docker smoke, not by unit tests.
const port = Number(process.env["PROSPERO_MCP_PORT"]);
if (!Number.isInteger(port) || port <= 0) {
  process.stderr.write("mcp-bridge: PROSPERO_MCP_PORT missing or invalid\n");
  process.exit(1);
}

const socket = connect(port, "127.0.0.1");
socket.on("connect", () => {
  process.stdin.pipe(socket);
  socket.pipe(process.stdout);
});
socket.on("close", () => process.exit(0));
socket.on("error", (err) => {
  process.stderr.write(`mcp-bridge: ${err.message}\n`);
  process.exit(1);
});
