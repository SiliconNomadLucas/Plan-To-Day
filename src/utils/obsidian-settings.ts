import type { App } from "obsidian";

interface ObsidianInternalSetting {
  open(): void;
  openTabById(id: string): void;
}

function isObsidianInternalSetting(value: unknown): value is ObsidianInternalSetting {
  if (typeof value !== "object" || value === null) return false;
  const setting = value as Partial<ObsidianInternalSetting>;
  return typeof setting.open === "function" && typeof setting.openTabById === "function";
}

export function openPluginSettings(app: App, pluginId: string): void {
  const setting: unknown = Reflect.get(app, "setting");
  if (!isObsidianInternalSetting(setting)) return;
  setting.open();
  setting.openTabById(pluginId);
}
