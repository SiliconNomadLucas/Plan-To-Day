export type ServiceReloadResult =
  | { status: "reloaded" | "unchanged" | "missing" }
  | { status: "deferred"; reason: "unsaved-changes" };
