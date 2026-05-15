import { encodeWireMessage } from "./codec.js";
import { WirePeer } from "./peer.js";
import type { WireError, WireMessage, WireRequest } from "../types/wire-protocol.js";

/** Thrown when a wire request receives an error response. */
export class WireRequestError extends Error {
  readonly code: number;
  constructor(error: WireError) {
    super(error.message);
    this.name = "WireRequestError";
    this.code = error.code;
  }
}

type Pending = { resolve: (value: unknown) => void; reject: (reason: Error) => void };

/**
 * The request-initiating half of the wire protocol (the orchestrator's adapter).
 * Sends requests and correlates responses by id; dispatches inbound notifications.
 */
export class WireClient extends WirePeer {
  private readonly pending = new Map<string, Pending>();
  private seq = 0;
  private closed = false;

  /** Send a request; resolve with its result, or reject on error / close. */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) return Promise.reject(new Error("wire: transport closed"));
    const id = `msg_${String(++this.seq)}`;
    const msg: WireRequest = {
      type: "request",
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      this.transport.send(encodeWireMessage(msg));
    });
  }

  protected handleMessage(msg: WireMessage): void {
    if (msg.type === "response") {
      const p = this.pending.get(msg.id);
      if (p === undefined) return;
      this.pending.delete(msg.id);
      if (msg.error !== undefined) p.reject(new WireRequestError(msg.error));
      else p.resolve(msg.result);
    } else if (msg.type === "notification") {
      this.dispatchNotification(msg.method, msg.params);
    }
    // inbound requests are not expected on the client; ignore
  }

  protected override handleClose(): void {
    this.closed = true;
    for (const p of this.pending.values()) p.reject(new Error("wire: transport closed"));
    this.pending.clear();
  }
}
