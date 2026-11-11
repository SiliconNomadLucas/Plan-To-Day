import { describe, expect, it, vi } from "vitest";
import { AIRecommendationView } from "../src/views/AIRecommendationView";
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
});
