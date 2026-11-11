import { describe, expect, it, vi } from "vitest";
import { OnboardingModal } from "../src/ui/OnboardingModal";
import { TestElement } from "./mocks/obsidian";

describe("OnboardingModal", () => {
  it("advances through the guide and saves completion once when skipped", () => {
    const onFinish = vi.fn();
    const modal = new OnboardingModal({} as never, onFinish);
    modal.open();
    const content = modal.contentEl as unknown as TestElement;

    expect(content.find((element) => element.className === "todo-onboarding-progress")?.textContent).toBe("步骤 1 / 6");
    content.find((element) => element.textContent === "下一步")!.trigger("click");
    expect(content.find((element) => element.className === "todo-onboarding-progress")?.textContent).toBe("步骤 2 / 6");

    content.find((element) => element.textContent === "跳过引导")!.trigger("click");
    expect(onFinish).toHaveBeenCalledOnce();
  });
});
