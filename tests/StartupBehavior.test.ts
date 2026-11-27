import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/settings";
import type ObsidianTodoPlugin from "../main";

describe("plugin startup behavior", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("prepares the mobile navigation without opening the main view when startup opening is disabled", async () => {
    const { default: PluginClass } = await vi.importActual<{ default: typeof ObsidianTodoPlugin }>("../main.ts");
    const navLeaf = { setViewState: vi.fn(async () => undefined) };
    const workspace = {
      getLeavesOfType: vi.fn(() => []),
      ensureSideLeaf: vi.fn(async () => navLeaf),
    };
    const plugin = new PluginClass({ workspace } as never, {} as never);
    Reflect.set(plugin, "settings", { ...DEFAULT_SETTINGS, autoOpenOnStartup: false });
    const activateView = vi.spyOn(plugin, "activateView").mockResolvedValue();
    vi.stubGlobal("window", { innerWidth: 400 });
    vi.stubGlobal("document", { body: { hasClass: vi.fn(() => false) } });

    await Reflect.get(plugin, "openStartupViews").call(plugin);

    expect(activateView).not.toHaveBeenCalled();
    expect(workspace.ensureSideLeaf).toHaveBeenCalledWith("plan-to-day-nav", "left", { active: false, reveal: false });
    expect(navLeaf.setViewState).toHaveBeenCalledWith({ type: "plan-to-day-nav", active: false });
  });

  it("opens the main view on startup when the option is enabled", async () => {
    const { default: PluginClass } = await vi.importActual<{ default: typeof ObsidianTodoPlugin }>("../main.ts");
    const workspace = { getLeavesOfType: vi.fn(() => []) };
    const plugin = new PluginClass({ workspace } as never, {} as never);
    Reflect.set(plugin, "settings", { ...DEFAULT_SETTINGS, autoOpenOnStartup: true });
    const activateView = vi.spyOn(plugin, "activateView").mockResolvedValue();
    vi.stubGlobal("window", { innerWidth: 1200 });
    vi.stubGlobal("document", { body: { hasClass: vi.fn(() => false) } });

    await Reflect.get(plugin, "openStartupViews").call(plugin);

    expect(activateView).toHaveBeenCalledOnce();
  });

  it("creates the mobile navigation without revealing it when startup opening is enabled", async () => {
    const { default: PluginClass } = await vi.importActual<{ default: typeof ObsidianTodoPlugin }>("../main.ts");
    const navLeaf = { setViewState: vi.fn(async () => undefined) };
    const workspace = {
      getLeavesOfType: vi.fn(() => []),
      ensureSideLeaf: vi.fn(async () => navLeaf),
    };
    const plugin = new PluginClass({ workspace } as never, {} as never);
    Reflect.set(plugin, "settings", { ...DEFAULT_SETTINGS, autoOpenOnStartup: true });
    const activateView = vi.spyOn(plugin, "activateView").mockResolvedValue();
    vi.stubGlobal("window", { innerWidth: 400 });
    vi.stubGlobal("document", { body: { hasClass: vi.fn(() => false) } });

    await Reflect.get(plugin, "openStartupViews").call(plugin);

    expect(workspace.ensureSideLeaf).toHaveBeenCalledWith("plan-to-day-nav", "left", { active: false, reveal: false });
    expect(navLeaf.setViewState).toHaveBeenCalledWith({ type: "plan-to-day-nav", active: false });
    expect(activateView).toHaveBeenCalledOnce();
  });
});
