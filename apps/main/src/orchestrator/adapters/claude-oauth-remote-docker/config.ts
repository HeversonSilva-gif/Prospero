import type { RemoteExecutionSettings } from "@prospero/shared";

/**
 * Where a remote agent's container is launched. M10 PR-D will let the user pick
 * this in Settings; PR-C ships only the local-Docker default — the M10
 * validation target (design §2).
 */
export type RemoteExecutionConfig =
  | { mode: "local-docker"; image: string }
  | {
      mode: "remote-vps";
      image: string;
      sshHost: string;
      sshUser: string;
      sshKeyPath: string;
    };

/** Local Docker, running the image the PR-B.4 Dockerfile/compose build produce. */
export const DEFAULT_LOCAL_DOCKER_CONFIG: RemoteExecutionConfig = {
  mode: "local-docker",
  image: "prospero/agent-runner:dev",
};

/** Fixed runner image tag — not user-configurable (design §7). */
const RUNNER_IMAGE = "prospero/agent-runner:dev";

/**
 * Maps the user-facing RemoteExecutionSettings (the `app-settings` blob) to the
 * RemoteExecutionConfig the transport layer consumes. Pure — unit-tested.
 */
export const toRemoteExecutionConfig = (s: RemoteExecutionSettings): RemoteExecutionConfig => {
  if (s.mode === "remote-vps") {
    return {
      mode: "remote-vps",
      image: RUNNER_IMAGE,
      sshHost: s.vpsHost,
      sshUser: s.vpsUser,
      sshKeyPath: s.vpsKeyPath,
    };
  }
  return { mode: "local-docker", image: RUNNER_IMAGE };
};
