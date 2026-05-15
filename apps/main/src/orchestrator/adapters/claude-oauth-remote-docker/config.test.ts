import { describe, expect, it } from "vitest";
import type { RemoteExecutionSettings } from "@prospero/shared";
import { toRemoteExecutionConfig } from "./config.js";

describe("toRemoteExecutionConfig", () => {
  it("maps local-docker settings to a local-docker config with the fixed image", () => {
    const settings: RemoteExecutionSettings = {
      enabled: true,
      mode: "local-docker",
      vpsHost: "",
      vpsUser: "",
      vpsKeyPath: "",
    };
    expect(toRemoteExecutionConfig(settings)).toEqual({
      mode: "local-docker",
      image: "prospero/agent-runner:dev",
    });
  });

  it("maps remote-vps settings to a remote-vps config carrying the SSH fields", () => {
    const settings: RemoteExecutionSettings = {
      enabled: true,
      mode: "remote-vps",
      vpsHost: "1.2.3.4",
      vpsUser: "deploy",
      vpsKeyPath: "/home/u/.ssh/id_ed25519",
    };
    expect(toRemoteExecutionConfig(settings)).toEqual({
      mode: "remote-vps",
      image: "prospero/agent-runner:dev",
      sshHost: "1.2.3.4",
      sshUser: "deploy",
      sshKeyPath: "/home/u/.ssh/id_ed25519",
    });
  });
});
