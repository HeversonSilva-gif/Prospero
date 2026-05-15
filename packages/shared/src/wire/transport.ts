/**
 * A bidirectional line channel. The wire protocol runs over anything that can
 * ship strings: a child process's stdio (SSH / docker-run) in production, or an
 * in-memory pair in tests. The transport carries raw chunks; reassembly into
 * messages is the WirePeer's job.
 */
export type WireTransport = {
  /** Write an already-encoded message (its trailing newline included). */
  send(data: string): void;
  /** Register the handler for inbound raw chunks. Last registration wins. */
  onData(handler: (chunk: string) => void): void;
  /** Register the handler for transport close. */
  onClose(handler: () => void): void;
};
