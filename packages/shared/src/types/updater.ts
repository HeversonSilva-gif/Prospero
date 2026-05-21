// M17 — auto-update status shared between the main-process electron-updater
// wrapper, the preload bridge, and the renderer store/banner.

export type UpdaterState =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

// Fields are always present (null when not applicable) to keep the object
// trivially serializable across IPC and avoid exactOptionalPropertyTypes churn.
export type UpdaterStatus = {
  state: UpdaterState;
  version: string | null;
  percent: number | null;
  error: string | null;
};
