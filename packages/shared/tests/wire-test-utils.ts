import type { WireTransport } from "../src/wire/transport.js";

export type MemoryTransportPair = {
  a: WireTransport;
  b: WireTransport;
  /** Fire both ends' onClose handlers. */
  close(): void;
};

/**
 * A WireTransport pair cross-wired in memory: what A sends, B's onData receives,
 * and vice versa. Delivery is synchronous, which keeps request/response tests
 * free of tick juggling.
 */
export const createMemoryTransportPair = (): MemoryTransportPair => {
  let aData: ((chunk: string) => void) | undefined;
  let bData: ((chunk: string) => void) | undefined;
  let aClose: (() => void) | undefined;
  let bClose: (() => void) | undefined;
  const a: WireTransport = {
    send: (data) => {
      bData?.(data);
    },
    onData: (handler) => {
      aData = handler;
    },
    onClose: (handler) => {
      aClose = handler;
    },
  };
  const b: WireTransport = {
    send: (data) => {
      aData?.(data);
    },
    onData: (handler) => {
      bData = handler;
    },
    onClose: (handler) => {
      bClose = handler;
    },
  };
  return {
    a,
    b,
    close: () => {
      aClose?.();
      bClose?.();
    },
  };
};
