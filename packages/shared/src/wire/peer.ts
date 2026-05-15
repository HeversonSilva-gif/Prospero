import { decodeWireMessage, encodeWireMessage, LineFramer } from "./codec.js";
import type { WireTransport } from "./transport.js";
import type { WireMessage, WireNotification } from "../types/wire-protocol.js";

type NotificationCallback = (params: unknown) => void;

/**
 * Shared base for WireClient and WireServer: owns the transport, reassembles
 * lines, decodes messages, and provides the notification pub/sub both peers
 * need. Subclasses implement handleMessage() for their request/response half.
 */
export abstract class WirePeer {
  protected readonly transport: WireTransport;
  private readonly framer = new LineFramer();
  private readonly notificationHandlers = new Map<string, Set<NotificationCallback>>();

  constructor(transport: WireTransport) {
    this.transport = transport;
    transport.onData((chunk) => {
      for (const line of this.framer.push(chunk)) {
        let msg: WireMessage;
        try {
          msg = decodeWireMessage(line);
        } catch {
          continue; // drop undecodable lines
        }
        this.handleMessage(msg);
      }
    });
    transport.onClose(() => this.handleClose());
  }

  /** Send a fire-and-forget notification to the peer. */
  notify(method: string, params?: unknown): void {
    const msg: WireNotification = {
      type: "notification",
      method,
      ...(params !== undefined ? { params } : {}),
    };
    this.transport.send(encodeWireMessage(msg));
  }

  /** Subscribe to inbound notifications of one method. Returns an unsubscribe fn. */
  onNotification(method: string, cb: NotificationCallback): () => void {
    const existing = this.notificationHandlers.get(method);
    // `const set` (never reassigned) so the unsubscribe closure captures a
    // non-undefined type without a strict-mode narrowing complaint.
    const set = existing ?? new Set<NotificationCallback>();
    if (existing === undefined) this.notificationHandlers.set(method, set);
    set.add(cb);
    return (): void => {
      set.delete(cb);
    };
  }

  protected dispatchNotification(method: string, params: unknown): void {
    const set = this.notificationHandlers.get(method);
    if (set === undefined) return;
    for (const cb of set) cb(params);
  }

  /** Each half routes inbound requests/responses differently. */
  protected abstract handleMessage(msg: WireMessage): void;

  /** Overridable; WireClient rejects pending requests here. */
  protected handleClose(): void {
    /* default: nothing */
  }
}
