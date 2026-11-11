import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask } from "../src/models/Task";
import { DatePickerModal, RecurrencePickerModal } from "../src/ui/TaskDateModals";
import { ConfirmModal } from "../src/ui/TaskEditModals";
import { ParentPickerModal } from "../src/ui/TaskPickerModals";
import { TestElement } from "./mocks/obsidian";

function contentOf(modal: { contentEl: HTMLElement }): TestElement {
  return modal.contentEl as unknown as TestElement;
}

function findButton(root: TestElement, text: string): TestElement {
  const button = root.find((element) => element.tag === "button" && element.textContent === text);
  if (!button) throw new Error(`Missing button: ${text}`);
  return button;
}

describe("extracted task detail modals", () => {
  beforeEach(() => {
    vi.stubGlobal("window", { setTimeout: () => 0 });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves confirm, cancel, and window-close distinctly", async () => {
    const confirmed = new ConfirmModal({} as never, "Delete?");
    const confirmResult = confirmed.openAndConfirm();
    findButton(contentOf(confirmed), "确认").trigger("click");
    await expect(confirmResult).resolves.toBe(true);

    const cancelled = new ConfirmModal({} as never, "Delete?");
    const cancelResult = cancelled.openAndConfirm();
    findButton(contentOf(cancelled), "取消").trigger("click");
    await expect(cancelResult).resolves.toBe(false);

    const closed = new ConfirmModal({} as never, "Delete?");
    const closeResult = closed.openAndConfirm();
    closed.close();
    await expect(closeResult).resolves.toBeNull();
  });

  it("keeps date preset linked updates and explicit save selection", () => {
    const onSelect = vi.fn();
    const onLinkedUpdate = vi.fn();
    const modal = new DatePickerModal(
      {} as never,
      "2026-11-10T09:00:00",
      "start",
      onSelect,
      onLinkedUpdate,
      false,
    );
    modal.open();

    const allDay = contentOf(modal).find((element) =>
      element.className.includes("todo-dp-preset-btn")
      && element.children.some((child) => child.textContent === "全天"),
    );
    expect(allDay).toBeDefined();
    allDay!.trigger("click");
    expect(onLinkedUpdate).toHaveBeenCalledWith(
      "2026-11-10T07:00:00",
      "2026-11-10T23:30:00",
    );
    findButton(contentOf(modal), "保存").trigger("click");
    expect(onSelect).toHaveBeenCalledWith("2026-11-10T07:00:00");
  });

  it("selects an existing recurrence option and closes", () => {
    const onSelect = vi.fn();
    const modal = new RecurrencePickerModal({} as never, null, onSelect);
    modal.open();
    contentOf(modal).find((element) => element.textContent === "每天")!.trigger("click");
    expect(onSelect).toHaveBeenCalledWith("daily");
    expect(contentOf(modal).children).toHaveLength(0);
  });

  it("selects only the matching parent task", () => {
    const parent = createTask({
      id: "parent",
      title: "Year goal",
      planKind: "year",
      planPeriodKey: "2026",
    });
    const unrelated = createTask({
      id: "unrelated",
      title: "Other year",
      planKind: "year",
      planPeriodKey: "2025",
    });
    const selected = vi.fn();
    const task = createTask({ planKind: "quarter", planPeriodKey: "2026-Q4" });
    const modal = new ParentPickerModal(
      {} as never,
      { getAll: () => [parent, unrelated] },
      [],
      selected,
      "parent",
      task,
    );
    modal.open();
    expect(contentOf(modal).find((element) => element.textContent === "Year goal")).toBeDefined();
    expect(contentOf(modal).find((element) => element.textContent === "Other year")).toBeUndefined();
    contentOf(modal).find((element) => element.className.includes("todo-parent-picker-item"))!.trigger("click");
    expect(selected).toHaveBeenCalledWith("parent");
  });

  it("limits an ordinary task's parent candidates to its matching weekly goal", () => {
    const weeklyGoal = createTask({
      id: "weekly-goal",
      title: "This week's goal",
      planKind: "week",
      planPeriodKey: "2026-W46",
    });
    const otherWeekGoal = createTask({
      id: "other-week-goal",
      title: "Another week's goal",
      planKind: "week",
      planPeriodKey: "2026-W45",
    });
    const yearlyGoal = createTask({
      id: "yearly-goal",
      title: "Year goal",
      planKind: "year",
      planPeriodKey: "2026",
    });
    const ordinaryParent = createTask({
      id: "ordinary-parent",
      title: "Existing parent task",
    });
    const deleted = createTask({
      id: "deleted",
      title: "Deleted task",
      isDeleted: true,
    });
    const selected = vi.fn();
    const task = createTask({ dueDate: "2026-11-11T10:00:00" });
    const modal = new ParentPickerModal(
      {} as never,
      { getAll: () => [weeklyGoal, otherWeekGoal, yearlyGoal, ordinaryParent, deleted] },
      [],
      selected,
      "parent",
      task,
    );

    modal.open();

    expect(contentOf(modal).find((element) => element.textContent === "This week's goal")).toBeDefined();
    expect(contentOf(modal).find((element) => element.textContent === "Another week's goal")).toBeUndefined();
    expect(contentOf(modal).find((element) => element.textContent === "Year goal")).toBeUndefined();
    expect(contentOf(modal).find((element) => element.textContent === "Existing parent task")).toBeUndefined();
    expect(contentOf(modal).find((element) => element.textContent === "Deleted task")).toBeUndefined();
    contentOf(modal).find((element) => element.className.includes("todo-parent-picker-item"))!.trigger("click");
    expect(selected).toHaveBeenCalledWith("weekly-goal");
  });
});
