import type { RemoteExecutionConfig } from "./config.js";

/** A child-process launch spec: the program and its argv. */
export type TransportCommand = { command: string; args: string[] };

/**
 * Builds the command whose stdio carries the wire protocol. Local Docker runs
 * the runner image directly; a remote VPS wraps the identical `docker run` in
 * `ssh` — the only difference is the `ssh` prefix (design §3.1). The container
 * is `--rm` (ephemeral, design §11) and `-i` (stdin attached — stdio IS the
 * transport). SSH pins the host key (`StrictHostKeyChecking=yes`) and never
 * prompts interactively (`BatchMode=yes`) — design §8.
 */
export const buildTransportCommand = (config: RemoteExecutionConfig): TransportCommand => {
  const dockerRun = ["run", "--rm", "-i", config.image];
  if (config.mode === "local-docker") {
    return { command: "docker", args: dockerRun };
  }
  return {
    command: "ssh",
    args: [
      "-i",
      config.sshKeyPath,
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "BatchMode=yes",
      `${config.sshUser}@${config.sshHost}`,
      "--",
      "docker",
      ...dockerRun,
    ],
  };
};
