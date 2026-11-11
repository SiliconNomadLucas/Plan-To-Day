import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTask, type Task } from "../src/models/Task";
import { currentPeriodKey } from "../src/utils/period";
import { PlanGroupRenderer } from "../src/views/PlanGroupRenderer";
import { TestElement } from "./mocks/obsidian";

function byClass(root: TestElement, name: string): TestElement {
  const match = root.find((element) => element.className.split(/\s+/).includes(name));
  if (!match) throw new Error(`Missing ${name}`);
  return match;
}

describe("PlanGroupRenderer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 10, 12));
    vi.stubGlobal("HTMLElement", TestElement);
    vi.stubGlobal("document", { createElement: (tag: string) => new TestElement(tag) });
    vi.stubGlobal("window", { setTimeout: vi.fn() });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("renders period rows and creates a task without collapsing on the add control", async () => {
    const currentTask = createTask({
      id: "current",
      planKind: "quarter",
      planPeriodKey: "2026-Q4",
    });
    const oldTask = createTask({
      id: "old",
      planKind: "quarter",
      planPeriodKey: "2025-Q4",
    });
    const tasks = [currentTask, oldTask];
    const renderTaskRow = vi.fn();
    const onTaskCreated = vi.fn(async () => undefined);
    const create = vi.fn(async (fields: Partial<Task>) => createTask(fields));
    const renderer = new PlanGroupRenderer({
      getAll: () => tasks,
      getByPlanKindAndPeriod: (kind, periodKey) =>
        tasks.filter((task) => task.planKind === kind && task.planPeriodKey === periodKey),
      create,
    }, {
      renderTaskRow,
      isMobile: () => false,
      promptPlanCreate: async () => undefined,
      onTaskCreated,
    });
    const container = new TestElement();

    renderer.renderPlan(container as unknown as HTMLDivElement, "quarter");

    expect(renderTaskRow).toHaveBeenCalledTimes(2);
    const currentBody = container.find((element) => element.dataset.periodKey === "2026-Q4")!;
    const oldBody = container.find((element) => element.dataset.periodKey === "2025-Q4")!;
    expect(currentBody.classList.contains("todo-is-hidden")).toBe(false);
    expect(oldBody.classList.contains("todo-is-hidden")).toBe(true);

    const currentGroup = currentBody.closest(".todo-plan-group-body")!;
    expect(currentGroup).toBe(currentBody);
    const currentHeader = container.find((element) =>
      element.className.includes("todo-plan-group-header")
      && element.children.some((child) => child.textContent === "2026 Q4 计划"),
    )!;
    currentHeader.trigger("click");
    expect(currentBody.classList.contains("todo-is-hidden")).toBe(true);
    const addButton = currentHeader.find((element) => element.className.includes("todo-plan-add-btn"))!;
    currentHeader.trigger("click", { target: addButton });
    expect(currentBody.classList.contains("todo-is-hidden")).toBe(true);
    await addButton.triggerAsync("click", { target: addButton, stopPropagation: vi.fn() });
    expect(currentBody.classList.contains("todo-is-hidden")).toBe(false);
    const input = byClass(currentBody, "todo-plan-inline-input").find((element) => element.tag === "input")!;
    input.value = "New quarterly task";
    await input.triggerAsync("keydown", { key: "Enter", preventDefault: vi.fn() });
    expect(create).toHaveBeenCalledWith({
      title: "New quarterly task",
      planKind: "quarter",
      planPeriodKey: "2026-Q4",
    });
    expect(onTaskCreated).toHaveBeenCalledOnce();
  });

  it("renders dashboard list subgroups and expands the current week", () => {
    const currentWeek = currentPeriodKey("week");
    const task = createTask({
      id: "weekly-goal",
      planKind: "week",
      planPeriodKey: currentWeek,
    });
    const renderTaskRow = vi.fn();
    const renderer = new PlanGroupRenderer({
      getAll: () => [task],
      getByPlanKindAndPeriod: (kind, periodKey) =>
        kind === "week" && periodKey === currentWeek ? [task] : [],
      create: async (fields) => createTask(fields),
    }, {
      renderTaskRow,
      isMobile: () => false,
      promptPlanCreate: async () => undefined,
      onTaskCreated: async () => undefined,
    });
    const container = new TestElement();

    renderer.renderGoalList(container as unknown as HTMLElement, "month", "2026-11");

    const currentBody = container.find((element) => element.dataset.periodKey === currentWeek)!;
    expect(currentBody).toBeDefined();
    expect(currentBody.classList.contains("todo-is-hidden")).toBe(false);
    const rowCall = renderTaskRow.mock.calls.find((call) => call[0] === currentBody);
    expect(rowCall?.[1].id).toBe(task.id);
    const group = currentBody.parentElement!;
    expect(group.find((element) => element.className.includes("todo-plan-add-btn"))).toBeDefined();
  });
});
