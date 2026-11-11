import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, ObsidianTodoSettingTab } from "../src/settings";
import { setLanguage } from "../src/i18n";
import { logger, LogLevel } from "../src/utils/logger";
import { Setting, TestElement } from "./mocks/obsidian";

function createTab() {
  const plugin = {
    settings: { ...DEFAULT_SETTINGS },
    saveSettings: vi.fn(async () => undefined),
    refreshLanguage: vi.fn(async () => undefined),
    taskService: { getStats: () => ({ total: 0, active: 0, completed: 0, deleted: 0 }) },
    tagService: { getAll: () => [] },
  };
  const tab = new ObsidianTodoSettingTab({} as never, plugin as never);
  return { tab, plugin };
}

describe("settings tab compatibility", () => {
  afterEach(() => {
    setLanguage("zh");
    logger.setLevel(LogLevel.ERROR);
    vi.restoreAllMocks();
  });

  it("indexes the real settings in the same order as the legacy tab", () => {
    setLanguage("zh");
    const { tab } = createTab();
    const definitions = tab.getSettingDefinitions();
    const groups = definitions.filter((item) => "items" in item);

    expect(groups.map((group) => "heading" in group ? group.heading : undefined))
      .toEqual(["基本设置", "显示设置", "标签管理", "高级设置", "数据管理"]);
    const basic = groups[0];
    if (!("items" in basic)) throw new Error("Missing basic settings");
    expect(basic.items?.map((item) => "name" in item ? item.name : undefined))
      .toEqual(["数据存储文件夹", "默认列表名称", "生日", "新手引导"]);
    const controls = groups.flatMap((group) => "items" in group ? group.items ?? [] : [])
      .filter((item) => "control" in item && item.control);
    for (const item of controls) {
      if ("control" in item && item.control) expect(tab.getControlValue(item.control.key)).not.toBeUndefined();
    }
  });

  it("persists declarative controls and refreshes after a language change", async () => {
    setLanguage("zh");
    const { tab, plugin } = createTab();
    const update = vi.spyOn(tab, "update").mockImplementation(() => undefined);

    expect(tab.getControlValue("todoFolder")).toBe("todo");
    await tab.setControlValue("showLunarCalendar", false);
    await tab.setControlValue("logLevel", "WARN");
    await tab.setControlValue("language", "en");

    expect(plugin.settings.showLunarCalendar).toBe(false);
    expect(plugin.settings.logLevel).toBe("WARN");
    expect(plugin.settings.language).toBe("en");
    expect(plugin.saveSettings).toHaveBeenCalledTimes(3);
    expect(plugin.refreshLanguage).toHaveBeenCalledOnce();
    expect(update).toHaveBeenCalledOnce();
    expect(tab.getSettingDefinitions()[0]).toMatchObject({ heading: "Basic Settings" });
  });

  it("refreshes the imperative fallback when update is unavailable", async () => {
    const { tab } = createTab();
    Object.defineProperty(tab, "update", { value: undefined });
    const display = vi.spyOn(tab, "display").mockImplementation(() => undefined);

    await tab.setControlValue("language", "en");

    expect(display).toHaveBeenCalledOnce();
  });

  it("uses the available destructive button style on each supported host", () => {
    const { tab } = createTab();
    const data = tab.getSettingDefinitions()[4];
    if (!("items" in data)) throw new Error("Missing data settings");
    const clear = data.items?.[1];
    if (!clear || !("render" in clear) || typeof clear.render !== "function") throw new Error("Missing clear action");

    const modern = {
      setDestructive: vi.fn().mockReturnThis(),
      setWarning: vi.fn().mockReturnThis(),
      setButtonText: vi.fn().mockReturnThis(),
      onClick: vi.fn().mockReturnThis(),
    };
    const legacy = {
      setWarning: vi.fn().mockReturnThis(),
      setButtonText: vi.fn().mockReturnThis(),
      onClick: vi.fn().mockReturnThis(),
    };
    const settingFor = (button: unknown) => ({ addButton: (configure: (candidate: unknown) => void) => configure(button) });

    clear.render(settingFor(modern) as never, {} as never);
    clear.render(settingFor(legacy) as never, {} as never);

    expect(modern.setDestructive).toHaveBeenCalledOnce();
    expect(modern.setWarning).not.toHaveBeenCalled();
    expect(legacy.setWarning).toHaveBeenCalledOnce();
  });

  it("renders searchable tag definitions as full-width custom groups", () => {
    const { tab } = createTab();
    const tags = tab.getSettingDefinitions()[2];
    if (!("items" in tags)) throw new Error("Missing tag settings");
    const quadrant = tags.items?.[0];
    if (!quadrant || !("render" in quadrant) || typeof quadrant.render !== "function") throw new Error("Missing tag renderer");
    const setting = new Setting(new TestElement());

    quadrant.render(setting as never, {} as never);

    expect(setting.settingEl.className).toContain("todo-declarative-tag-setting");
    expect(setting.settingEl.find((element) => element.className.includes("todo-setting-tag-group-title"))?.textContent)
      .toBe("四象限标签");
  });
});
