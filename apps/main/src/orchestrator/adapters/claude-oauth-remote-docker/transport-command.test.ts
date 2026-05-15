import { describe, it, expect } from "vitest";
import { buildTransportCommand } from "./transport-command.js";
import { DEFAULT_LOCAL_DOCKER_CONFIG } from "./config.js";

describe("buildTransportCommand", () => {
  it("runs the image directly for local-docker mode", () => {
    expect(buildTransportCommand(DEFAULT_LOCAL_DOCKER_CONFIG)).toEqual({
      command: "docker",
      args: ["run", "--rm", "-i", "prospero/agent-runner:dev"],
    });
  });

  it("wraps docker run in ssh for remote-vps mode", () => {
    const cmd = buildTransportCommand({
      mode: "remote-vps",
      image: "prospero/agent-runner:dev",
      sshHost: "vps.example.com",
      sshUser: "agent",
      sshKeyPath: "/home/me/.ssh/id_ed25519",
    });
    expect(cmd).toEqual({
      command: "ssh",
      args: [
        "-i",
        "/home/me/.ssh/id_ed25519",
        "-o",
        "StrictHostKeyChecking=yes",
        "-o",
        "BatchMode=yes",
        "agent@vps.example.com",
        "--",
        "docker",
        "run",
        "--rm",
        "-i",
        "prospero/agent-runner:dev",
      ],
    });
  });
});
