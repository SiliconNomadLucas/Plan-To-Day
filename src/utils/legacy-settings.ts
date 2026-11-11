import type { DataAdapter } from "obsidian";

const LEGACY_PLUGIN_ID = "obsidian-todo";

export async function loadLegacySettings(
  adapter: Pick<DataAdapter, "exists" | "read">,
  configDir: string,
): Promise<object | null> {
  const path = `${configDir}/plugins/${LEGACY_PLUGIN_ID}/data.json`;
  if (!(await adapter.exists(path))) return null;
  const data: unknown = JSON.parse(await adapter.read(path));
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`Invalid legacy plugin settings: ${path}`);
  }
  return data;
}
