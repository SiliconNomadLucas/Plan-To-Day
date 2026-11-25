import type { SyncDataFile } from "./SyncDataFile";

export type DataSyncReloadResult =
  | { status: "reloaded" | "unchanged"; retryFiles?: SyncDataFile[] }
  | { status: "missing" | "deferred"; retryFiles?: SyncDataFile[]; reason?: string };
