import type { WireCredentials } from "@prospero/shared";

/** Mutable state shared across the runner's wire handlers. */
export type RunnerState = {
  /** Epoch ms when the runner process started. */
  readonly startedAt: number;
  /** Credentials from the handshake; null until the handshake completes. */
  credentials: WireCredentials | null;
};

/** Create a fresh runner state. `now` is injectable for deterministic tests. */
export const createRunnerState = (now: number = Date.now()): RunnerState => ({
  startedAt: now,
  credentials: null,
});
