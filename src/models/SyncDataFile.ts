export const SYNC_DATA_FILES = [
  "database.json",
  "lists.json",
  "tags.json",
  "groups.json",
  "recurrence-series.json",
] as const;

export type SyncDataFile = typeof SYNC_DATA_FILES[number];
