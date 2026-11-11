import { describe, expect, it } from "vitest";
import { loadLegacySettings } from "../src/utils/legacy-settings";

describe("legacy plugin settings migration", () => {
  const path = ".obsidian/plugins/obsidian-todo/data.json";

  it("reads settings from the old plugin folder without modifying it", async () => {
    const adapter = {
      exists: async (candidate: string) => candidate === path,
      read: async (candidate: string) => {
        expect(candidate).toBe(path);
        return JSON.stringify({ todoFolder: "custom-tasks", language: "zh" });
      },
    };

    await expect(loadLegacySettings(adapter, ".obsidian")).resolves.toEqual({
      todoFolder: "custom-tasks",
      language: "zh",
    });
  });

  it("does not import anything when the old settings file is absent", async () => {
    const adapter = {
      exists: async () => false,
      read: async () => { throw new Error("unexpected read"); },
    };

    await expect(loadLegacySettings(adapter, ".obsidian")).resolves.toBeNull();
  });

  it("rejects invalid legacy settings instead of silently using defaults", async () => {
    const adapter = {
      exists: async () => true,
      read: async () => "[]",
    };

    await expect(loadLegacySettings(adapter, ".obsidian")).rejects.toThrow("Invalid legacy plugin settings");
  });
});
