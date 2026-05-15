import { StdioWireTransport } from "./transport/stdio-transport.js";
import { createRunner } from "./runner.js";

// The runner speaks the wire protocol over stdin/stdout; its own diagnostics
// go to stderr. createRunner attaches the WireServer to the transport, which is
// live immediately — there is nothing else for the process to do but stay up.
createRunner(new StdioWireTransport());
process.stderr.write("agent-runner: ready (wire protocol v1)\n");
