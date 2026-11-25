export type StorageReadResult =
  | { status: "loaded"; data: unknown }
  | { status: "missing" };
