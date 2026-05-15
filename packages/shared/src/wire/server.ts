import { encodeWireMessage } from "./codec.js";
import { WirePeer } from "./peer.js";
import { WireErrorCode } from "../types/wire-protocol.js";
import type { WireError, WireMessage, WireResponse } from "../types/wire-protocol.js";

/** Thrown by a method handler to return a specific wire error to the caller. */
export class WireHandlerError extends Error {
  readonly code: number;
  constructor(code: number, message: string) {
    super(message);
    this.name = "WireHandlerError";
    this.code = code;
  }
}

// Returns `unknown` — `await` unwraps a returned promise and passes a plain
// value straight through, so a handler may be sync or async.
type MethodHandler = (params: unknown) => unknown;

/**
 * The request-handling half of the wire protocol (the agent-runner). Dispatches
 * inbound requests to registered handlers; can send and receive notifications.
 */
export class WireServer extends WirePeer {
  private readonly handlers = new Map<string, MethodHandler>();

  /** Register the handler for one request method. */
  handle(method: string, handler: MethodHandler): void {
    this.handlers.set(method, handler);
  }

  protected handleMessage(msg: WireMessage): void {
    if (msg.type === "request") {
      void this.runHandler(msg.id, msg.method, msg.params);
    } else if (msg.type === "notification") {
      this.dispatchNotification(msg.method, msg.params);
    }
    // inbound responses are not expected on the server; ignore
  }

  private async runHandler(id: string, method: string, params: unknown): Promise<void> {
    const handler = this.handlers.get(method);
    if (handler === undefined) {
      this.sendError(id, {
        code: WireErrorCode.protocolMismatch,
        message: `unknown method: ${method}`,
      });
      return;
    }
    try {
      const result = await handler(params);
      const response: WireResponse = { type: "response", id, result };
      this.transport.send(encodeWireMessage(response));
    } catch (e) {
      if (e instanceof WireHandlerError) {
        this.sendError(id, { code: e.code, message: e.message });
      } else {
        this.sendError(id, {
          code: WireErrorCode.internalError,
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }
  }

  private sendError(id: string, error: WireError): void {
    const response: WireResponse = { type: "response", id, error };
    this.transport.send(encodeWireMessage(response));
  }
}
