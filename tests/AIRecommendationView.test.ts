import { describe, expect, it, vi } from "vitest";
import { AIRecommendationView } from "../src/views/AIRecommendationView";
import { logger } from "../src/utils/logger";
import { TestElement } from "./mocks/obsidian";

describe("AIRecommendationView", () => {
  it("replaces the current list with generated results when refreshed", async () => {
    const root = new TestElement();
    const nextItems = [{
      id: "next",
      title: "Refreshed task",
      note: "",
      listId: "",
      tags: [],
      isImportant: false,
      durationMinutes: 60,
    }];
    const onRefresh = vi.fn(async () => nextItems);
    const view = new AIRecommendationView({} as never, root as unknown as HTMLElement);

    view.open([], onRefresh, async () => undefined);
    const refreshButton = root.find((element) => element.className.includes("todo-ai-refresh-button"));
    expect(refreshButton).toBeDefined();

    await refreshButton!.triggerAsync("click");

    expect(onRefresh).toHaveBeenCalledOnce();
    expect(root.find((element) => element.className.includes("todo-ai-card-title"))?.textContent)
      .toBe("Refreshed task");
  });

  it("reports a failed accept and re-enables the card action", async () => {
    const root = new TestElement();
    const error = new Error("save failed");
    const log = vi.spyOn(logger, "error").mockImplementation(() => undefined);
    const view = new AIRecommendationView({} as never, root as unknown as HTMLElement);
    view.open([{
      id: "candidate",
      title: "Try again",
      note: "",
      listId: "",
      tags: [],
      isImportant: false,
      durationMinutes: 30,
    }], async () => [], async () => { throw error; });

    const accept = root.find((element) => element.title === "加入")!;
    accept.trigger("click");

    await vi.waitFor(() => expect(log).toHaveBeenCalledWith(
      "Failed to AIRecommendationView interaction:", error,
    ));
    expect(Reflect.get(accept, "disabled")).toBe(false);
    expect(root.find((element) => element.className.includes("todo-ai-card-title"))).toBeDefined();
  });
});
