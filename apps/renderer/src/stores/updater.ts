import { create } from "zustand";
import type { UpdaterStatus } from "@prospero/shared";

type State = {
  status: UpdaterStatus;
  snoozed: boolean;
  /** Fetch the initial status and subscribe to updater:event. Returns the
   *  unsubscribe. Called once from the always-mounted UpdateBanner. */
  init: () => () => void;
  checkNow: () => Promise<void>;
  installNow: () => Promise<void>;
  snooze: () => void;
};

export const useUpdaterStore = create<State>((set) => ({
  status: { state: "idle", version: null, percent: null, error: null },
  snoozed: false,
  init: () => {
    void window.prospero.updater.status().then((status) => set({ status }));
    return window.prospero.updater.onEvent((status) => set({ status, snoozed: false }));
  },
  checkNow: async () => {
    await window.prospero.updater.checkNow();
  },
  installNow: async () => {
    await window.prospero.updater.installNow();
  },
  snooze: () => set({ snoozed: true }),
}));
